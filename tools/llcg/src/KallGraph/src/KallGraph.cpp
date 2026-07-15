#include "SVF-LLVM/SVFIRBuilder.h"
#include "SVF-LLVM/LLVMModule.h"
#include "Util/ExtAPI.h"
#include "WPA/Andersen.h"
#include "llvm/Bitcode/BitcodeWriter.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Support/FormatVariadic.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/PrettyStackTrace.h"
#include "llvm/Support/Signals.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/SystemUtils.h"

#include <cstdint>
#include <cstring>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <set>
#include <string>
#include <sys/resource.h>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <condition_variable>

#include "include/KallGraphAlgo.hpp"
#include "include/Util.hpp"

using namespace llvm;
using namespace SVF;

// Command line parameters.
cl::list<std::string> InputFilenames(cl::Positional, cl::OneOrMore,
                                     cl::desc("<input bitcode files>"));

cl::opt<unsigned>
    VerboseLevel("verbose-level",
                 cl::desc("Print information at which verbose level"),
                 cl::init(0));

static llvm::cl::opt<std::string>
    OutputDir("OutputDir", llvm::cl::desc("OutputDir"), llvm::cl::init(""));

static llvm::cl::opt<std::string> CallGraphPath("CallGraphPath",
                                                llvm::cl::desc("CallGraphPath"),
                                                llvm::cl::init(""));

static llvm::cl::opt<std::string>
    PointsToPath("PointsToPath", llvm::cl::desc("PointsToPath"),
                 llvm::cl::init(""));

static llvm::cl::opt<size_t> ThreadNum("ThreadNum", llvm::cl::desc("ThreadNum"),
                                       llvm::cl::init(1));

static llvm::cl::opt<std::string>
    ExtAPIPath("ExtAPIPath", llvm::cl::desc("Path to upstream SVF extapi.bc"),
               llvm::cl::init(""));

struct LocalMaps {
  unordered_map<const CallInst *, unordered_set<const Function *>>
      localcallgraph;
  unordered_map<const Function *, unordered_set<CallInst *>> localDepFuncs;
  unordered_map<CallInst *, unordered_set<CallInst *>> localDepiCalls;
  unordered_set<const Function *> localnewtargets;
  unordered_set<CallInst *> localnewicalls;
};

struct TaskContext {
  CallInst *icall;
  LocalMaps &local;
};

static void collectFunctionValuesFromNode(
    PAGNode *node,
    unordered_set<PAGNode *> &visitedNodes,
    unordered_set<const Function *> &targets) {
  if (!node || !visitedNodes.insert(node).second) {
    return;
  }

  if (const auto *value = getLLVMValue(node); value) {
    if (const auto *func = dyn_cast<Function>(value)) {
      targets.insert(func);
    }
  }

  for (auto edge : node->getIncomingEdges(PAGEdge::Addr)) {
    if (const auto *value = getLLVMValue(edge->getSrcNode());
        isa<Function>(value)) {
      targets.insert(dyn_cast<Function>(value));
    }
  }

  for (auto edge : node->getIncomingEdges(PAGEdge::Copy)) {
    collectFunctionValuesFromNode(edge->getSrcNode(), visitedNodes, targets);
  }
}

static void collectStoredFunctionTargets(
    PAGNode *node,
    unordered_set<PAGNode *> &visitedAliasNodes,
    unordered_set<const Function *> &targets) {
  if (!node || !visitedAliasNodes.insert(node).second) {
    return;
  }

  for (auto edge : node->getIncomingEdges(PAGEdge::Store)) {
    unordered_set<PAGNode *> visitedValueNodes;
    collectFunctionValuesFromNode(edge->getSrcNode(), visitedValueNodes,
                                  targets);
  }

  for (auto edge : node->getIncomingEdges(PAGEdge::Copy)) {
    collectStoredFunctionTargets(edge->getSrcNode(), visitedAliasNodes, targets);
  }

  for (auto edge : node->getOutgoingEdges(PAGEdge::Copy)) {
    collectStoredFunctionTargets(edge->getDstNode(), visitedAliasNodes, targets);
  }

  for (auto edge : node->getIncomingEdges(PAGEdge::Addr)) {
    collectStoredFunctionTargets(edge->getSrcNode(), visitedAliasNodes, targets);
  }

  for (auto edge : node->getOutgoingEdges(PAGEdge::Addr)) {
    collectStoredFunctionTargets(edge->getDstNode(), visitedAliasNodes, targets);
  }

  for (auto edge : node->getIncomingEdges(PAGEdge::Gep)) {
    collectStoredFunctionTargets(edge->getSrcNode(), visitedAliasNodes, targets);
  }

  for (auto edge : node->getOutgoingEdges(PAGEdge::Gep)) {
    collectStoredFunctionTargets(edge->getDstNode(), visitedAliasNodes, targets);
  }
}

static bool isDstOutputDebugCallsite(const CallInst *icall) {
  if (!icall) {
    return false;
  }
  if (const auto dbginfo = icall->getDebugLoc()) {
    return dbginfo->getLine() == 464 &&
           dbginfo->getFilename().str().find("include/net/dst.h") != string::npos;
  }
  return false;
}

Algo *performAnalysis(Value *gv, SVFIR *pag);

static std::string normalizeTypeToken(std::string raw) {
  for (const char *prefix : {"struct.", "union.", "class."}) {
    if (raw.rfind(prefix, 0) == 0) {
      raw.erase(0, strlen(prefix));
      break;
    }
  }
  return raw;
}

static std::string callsiteKey(const Instruction *inst) {
  if (!inst) {
    return "";
  }
  if (const auto dbginfo = inst->getDebugLoc()) {
    std::string filename = dbginfo->getFilename().str();
    std::string directory = dbginfo->getDirectory().str();
    if (!directory.empty()) {
      return directory + "/" + filename + ":" + to_string(dbginfo->getLine());
    }
    return filename + ":" + to_string(dbginfo->getLine());
  }
  return "";
}

static void collectTypeHintsFromNode(PAGNode *node,
                                     unordered_set<PAGNode *> &visited,
                                     std::set<std::string> &typeNames,
                                     std::set<std::string> &valueNames) {
  if (!node || !visited.insert(node).second) {
    return;
  }

  if (const auto *value = getLLVMValue(node)) {
    valueNames.insert(printVal(value));
    if (auto *st = ifPointToStruct(value->getType())) {
      std::string name = normalizeTypeToken(getStructName(st));
      if (!name.empty()) {
        typeNames.insert(name);
      }
    }
  }
  if (node->getType()) {
    if (auto *st = ifPointToStruct(node->getType())) {
      std::string name = normalizeTypeToken(getStructName(st));
      if (!name.empty()) {
        typeNames.insert(name);
      }
    }
  }

  for (auto edge : node->getIncomingEdges(PAGEdge::Copy)) {
    collectTypeHintsFromNode(edge->getSrcNode(), visited, typeNames, valueNames);
  }
  for (auto edge : node->getOutgoingEdges(PAGEdge::Copy)) {
    collectTypeHintsFromNode(edge->getDstNode(), visited, typeNames, valueNames);
  }
  for (auto edge : node->getIncomingEdges(PAGEdge::Addr)) {
    collectTypeHintsFromNode(edge->getSrcNode(), visited, typeNames, valueNames);
  }
  for (auto edge : node->getOutgoingEdges(PAGEdge::Addr)) {
    collectTypeHintsFromNode(edge->getDstNode(), visited, typeNames, valueNames);
  }
  for (auto edge : node->getIncomingEdges(PAGEdge::Gep)) {
    collectTypeHintsFromNode(edge->getSrcNode(), visited, typeNames, valueNames);
  }
  for (auto edge : node->getOutgoingEdges(PAGEdge::Gep)) {
    collectTypeHintsFromNode(edge->getDstNode(), visited, typeNames, valueNames);
  }
}

static void appendStringArray(llvm::json::Object &obj, const char *key,
                              const std::set<std::string> &values) {
  llvm::json::Array arr;
  for (const auto &value : values) {
    arr.push_back(value);
  }
  obj[key] = std::move(arr);
}

static std::vector<llvm::json::Object> collectDmaPointsToQueries(SVFModule *svfModule,
                                                                 SVFIR *pag) {
  static const std::map<std::string, unsigned> queryTargets = {
      {"sg_set_buf", 1u},
      {"sg_init_one", 1u},
      {"vring_map_single", 1u},
  };

  std::vector<llvm::json::Object> queries;
  for (auto func : svfModule->getFunctionSet()) {
    for (auto &bb : *func) {
      for (auto &inst : bb) {
        auto *call = dyn_cast<CallInst>(&inst);
        if (!call) {
          continue;
        }
        const Function *callee = call->getCalledFunction();
        if (!callee) {
          continue;
        }
        auto it = queryTargets.find(callee->getName().str());
        if (it == queryTargets.end()) {
          continue;
        }
        const unsigned argIndex = it->second;
        if (call->arg_size() <= argIndex) {
          continue;
        }
        Value *argValue = call->getArgOperand(argIndex)->stripPointerCasts();
        if (!argValue || !argValue->getType()->isPointerTy()) {
          continue;
        }
        std::unique_ptr<Algo> res(performAnalysis(argValue, pag));
        std::set<std::string> typeNames;
        std::set<std::string> valueNames;
        for (const auto &aliasBucket : res->Aliases) {
          for (auto alias : aliasBucket.second) {
            unordered_set<PAGNode *> visitedAliasNodes;
            collectTypeHintsFromNode(alias, visitedAliasNodes, typeNames, valueNames);
          }
        }
        llvm::json::Object record;
        record["callsite"] = callsiteKey(call);
        record["caller"] = func->getName().str();
        record["callee"] = callee->getName().str();
        record["arg_index"] = static_cast<int64_t>(argIndex);
        record["arg_value"] = printVal(argValue);
        appendStringArray(record, "points_to_types", typeNames);
        appendStringArray(record, "points_to_values", valueNames);
        queries.push_back(std::move(record));
      }
    }
  }
  return queries;
}

static void writePointsToQueriesJson(const std::string &path, SVFModule *svfModule,
                                     SVFIR *pag) {
  llvm::json::Array queries;
  for (auto &record : collectDmaPointsToQueries(svfModule, pag)) {
    queries.push_back(std::move(record));
  }
  llvm::json::Object root;
  root["version"] = 1;
  root["queries"] = std::move(queries);

  std::error_code ec;
  llvm::raw_fd_ostream out(path, ec);
  if (ec) {
    errs() << "failed to write points-to json " << path << ": "
           << ec.message() << "\n";
    return;
  }
  out << llvm::formatv("{0:2}", llvm::json::Value(std::move(root)));
  out << "\n";
}

static void debugAliasBucketsForCallsite(const CallInst *icall, Algo *res) {
  if (!isDstOutputDebugCallsite(icall) || !res) {
    return;
  }

  errs() << "[kallgraph-debug] dst_output callsite buckets begin\n";
  for (const auto &aliasBucket : res->Aliases) {
    errs() << "[kallgraph-debug] offset=" << aliasBucket.first
           << " size=" << aliasBucket.second.size() << "\n";
    for (auto alias : aliasBucket.second) {
      errs() << "  alias-node id=" << alias->getId();
      if (const auto *value = getLLVMValue(alias)) {
        errs() << " value=" << printVal(value);
      }
      errs() << "\n";
      for (auto edge : alias->getIncomingEdges(PAGEdge::Store)) {
        errs() << "    store-src id=" << edge->getSrcNode()->getId();
        if (const auto *value = getLLVMValue(edge->getSrcNode())) {
          errs() << " value=" << printVal(value);
        }
        errs() << "\n";
      }
    }
  }
  errs() << "[kallgraph-debug] dst_output callsite buckets end\n";
}

void createOutputFolder() {
  if (OutputDir.empty()) {
    perror("Please specify -OutputDir=/path/to/your/output/folder !\n");
    exit(1);
  }
  auto now = std::chrono::system_clock::now();
  std::time_t now_time = std::chrono::system_clock::to_time_t(now);
  std::ostringstream oss;
  oss << std::put_time(std::localtime(&now_time), "%Y%m%d_%H%M%S");
  std::filesystem::path outputPath =
      std::filesystem::path(OutputDir.getValue()) / oss.str();
  try {
    std::filesystem::create_directories(outputPath);
    std::cout << "Created output folder: " << outputPath << std::endl;
  } catch (const std::filesystem::filesystem_error &e) {
    std::cerr << "Error creating folder: " << e.what() << std::endl;
  }
  OutputDir = outputPath.string();
}

unordered_set<CallInst *> callinsts;
void getAllicalls(SVFModule *M) {
  for (auto func : M->getFunctionSet()) {
    for (auto &bb : *func) {
      for (auto &inst : bb) {
        if (auto callins = dyn_cast<CallInst>(&inst)) {
          if (callins->isIndirectCall()) {
            callinsts.insert(const_cast<CallInst *>(callins));
          }
        }
      }
    }
  }
}

set<const CallInst *> *getiCallOperands(string filename) {
  auto ops = new set<const CallInst *>();
  for (auto callinst : callinsts) {
    if (auto dbginfo = callinst->getDebugLoc()) {
      if ((dbginfo->getFilename().str() + ":" +
           to_string(dbginfo->getLine())) == filename) {
        ops->insert(callinst);
      }
    }
  }
  return ops;
}

void processTraces(SVFIR *pag) {
  if (typebasedShortcuts.find("struct.tracepoint_func") !=
      typebasedShortcuts.end()) {
    for (auto edge : typebasedShortcuts["struct.tracepoint_func"][0]) {
      for (auto loadout : edge->getDstNode()->getOutgoingEdges(PAGEdge::Load)) {
        for (auto copyout :
             loadout->getDstNode()->getOutgoingEdges(PAGEdge::Copy)) {
          traceNodes.insert(copyout->getDstID());
        }
      }
    }
    for (auto icall : callinsts) {
      if (traceNodes.find(getValueNode(icall->getCalledOperand())) !=
          traceNodes.end()) {
        traceiCalls.insert(icall);
      }
    }
  }
}

void processTraceIcalls(const CallInst *icall, LocalMaps &maps) {
  if (type2funcs.find(printType(icall->getCalledOperand()->getType())) !=
      type2funcs.end()) {
    for (auto func :
         type2funcs[printType(icall->getCalledOperand()->getType())]) {
      maps.localcallgraph[icall].insert(func);
    }
  }
}

void processSELinuxhooks(SVFIR *pag, SVFModule *svfmod) {
  GlobalVariable *selinuxhooks = nullptr;
  for (auto &moduleRef : svfmod->getLLVMModules()) {
    for (auto &global : moduleRef.get().globals()) {
      if (global.getName().str() == "selinux_hooks") {
        selinuxhooks = &global;
      }
    }
  }
  if (selinuxhooks == nullptr) {
    return;
  }
  for (auto edge : typebasedShortcuts["struct.security_hook_list"][24]) {
    for (auto castout : edge->getDstNode()->getOutgoingEdges(PAGEdge::Copy)) {
      for (auto loadout :
           castout->getDstNode()->getOutgoingEdges(PAGEdge::Load)) {
        SELinuxNodes.insert(loadout->getDstID());
      }
    }
  }
  for (auto icall : callinsts) {
    if (SELinuxNodes.find(getValueNode(icall->getCalledOperand())) !=
        SELinuxNodes.end()) {
      SELinuxicalls.insert(icall);
    }
  }
  for (auto edge : pag->getGNode(getValueNode(selinuxhooks))
                       ->getOutgoingEdges(PAGEdge::Gep)) {
    for (auto storein : edge->getDstNode()->getIncomingEdges(PAGEdge::Store)) {
      if (const auto *value = getLLVMValue(storein->getSrcNode());
          isa<Function>(value)) {
        SELinuxfuncs.insert(dyn_cast<Function>(value));
      }
    }
  }
}

void processSELinuxIcalls(const CallInst *icall, LocalMaps &maps) {
  if (type2funcs.find(printType(icall->getCalledOperand()->getType())) !=
      type2funcs.end()) {
    for (auto func :
         type2funcs[printType(icall->getCalledOperand()->getType())]) {
      if (SELinuxfuncs.find(func) != SELinuxfuncs.end()) {
        maps.localcallgraph[icall].insert(func);
      }
    }
  }
}

unordered_set<CallInst *> *getSpecifyInput(SVFModule *svfmod) {
  if (SpecifyInput == "") {
    return nullptr;
  }
  unordered_set<string> icalls;
  unordered_set<string> found_icalls;
  string tmp;
  ifstream fin(SpecifyInput);
  while (!fin.eof()) {
    fin >> tmp;
    icalls.insert(tmp);
  }
  auto ret = new unordered_set<CallInst *>();
  for (auto func : svfmod->getFunctionSet()) {
    for (auto &bb : *func) {
      for (auto &inst : bb) {
        if (auto icall = dyn_cast<CallInst>(&inst)) {
          if (icall->isIndirectCall()) {
            if (auto dbginfo = icall->getDebugLoc()) {
              auto path = dbginfo->getFilename().str() + ":" +
                          to_string(dbginfo->getLine());
              if (icalls.find(path) != icalls.end()) {
                ret->insert(const_cast<CallInst *>(icall));
                found_icalls.insert(path);
              }
            }
          }
        }
      }
    }
  }
  for (auto icall : icalls) {
    if (found_icalls.find(icall) == found_icalls.end()) {
      errs() << icall << " not found\n";
    }
  }
  return ret;
}

Algo *performAnalysis(Value *gv, SVFIR *pag) {
  auto *unias = new Algo();
  unias->pag = pag;
  for (auto node : BlockedNodes) {
    unias->BlockedNodes.insert(node);
  }
  PNwithOffset firstLayer(0, true);
  unias->HistoryAwareStack.push(&firstLayer);
  auto pgnode = pag->getGNode(getValueNode(gv));
  unias->taskNode = pgnode;
  unias->ComputeAlias(pgnode, true);
  return unias;
}

void eachThread(SVFIR *pag, TaskContext &task) {
  string path;
  auto icall = task.icall;
  if (auto dbginfo = icall->getDebugLoc()) {
    path = dbginfo->getFilename().str() + ":" + to_string(dbginfo->getLine());
  }
  cout << getValueNode(icall->getCalledOperand()->stripPointerCasts())
       << " " << path << "\n";
  if (traceiCalls.find(icall) != traceiCalls.end()) {
    processTraceIcalls(icall, task.local);
  } else if (SELinuxicalls.find(icall) != SELinuxicalls.end()) {
    processSELinuxIcalls(icall, task.local);
  } else {
    auto res =
        performAnalysis(icall->getCalledOperand()->stripPointerCasts(), pag);
    debugAliasBucketsForCallsite(icall, res);
    unordered_set<const Function *> candidateFuncs;
    for (const auto &aliasBucket : res->Aliases) {
      for (auto alias : aliasBucket.second) {
        if (aliasBucket.first == 0) {
          if (const auto *value = getLLVMValue(alias)) {
            if (auto func = dyn_cast<Function>(value)) {
              if (alias->getId() == getValueNode(func)) {
                candidateFuncs.insert(func);
              }
            }
          }
        }
        unordered_set<PAGNode *> visitedAliasNodes;
        collectStoredFunctionTargets(alias, visitedAliasNodes, candidateFuncs);
      }
    }
    for (auto func : candidateFuncs) {
      if (icall->arg_size() == func->arg_size() && checkIfMatch(icall, func)) {
        if (task.local.localcallgraph.find(icall) ==
            task.local.localcallgraph.end()) {
          task.local.localnewicalls.insert(icall);
        } else if (task.local.localcallgraph[icall].find(func) ==
                   task.local.localcallgraph[icall].end()) {
          task.local.localnewtargets.insert(func);
        }
        task.local.localcallgraph[icall].insert(func);
      }
    }
    for (auto func : res->depFuncs) {
      task.local.localDepFuncs[func].insert(icall);
    }
    for (auto iicall : res->depiCalls) {
      task.local.localDepiCalls[iicall].insert(icall);
    }
    delete res;
  }
}

size_t getCallGraphSizeSum() {
  size_t total = 0;
  for (const auto &pair : callgraph) {
    total += pair.second.size();
  }
  return total;
}

class ThreadPool {
public:
  ThreadPool(size_t thread_count, SVFIR *pag, std::deque<CallInst *> &tasks)
      : tasks_(tasks), stop_(false), thread_data_(thread_count), pag_(pag) {
    for (size_t i = 0; i < thread_count; ++i) {
      workers_.emplace_back(&ThreadPool::worker_thread, this, i);
    }
  }

  ~ThreadPool() {
    {
      std::unique_lock<std::mutex> lock(mutex_);
      stop_ = true;
      cond_var_.notify_all();
    }
    for (std::thread &worker : workers_) {
      if (worker.joinable()) {
        worker.join();
      }
    }
    for (auto &data : thread_data_) {
      for (auto &p : data.localcallgraph)
        callgraph[p.first].insert(p.second.begin(), p.second.end());
      for (auto &p : data.localDepFuncs)
        GlobalDepFuncs[p.first].insert(p.second.begin(), p.second.end());
      for (auto &p : data.localDepiCalls)
        GlobalDepiCalls[p.first].insert(p.second.begin(), p.second.end());
      newiCalls.insert(data.localnewicalls.begin(), data.localnewicalls.end());
      newTargets.insert(data.localnewtargets.begin(),
                        data.localnewtargets.end());
    }
  }

private:
  void worker_thread(size_t index) {
    while (true) {
      CallInst *icall = nullptr;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        cond_var_.wait(lock, [this]() { return stop_ || !tasks_.empty(); });
        if (stop_ && tasks_.empty()) {
          return;
        }
        icall = tasks_.front();
        tasks_.pop_front();
      }
      TaskContext ctx{icall, thread_data_[index]};
      eachThread(pag_, ctx);
    }
  }

  std::vector<std::thread> workers_;
  std::deque<CallInst *> &tasks_;
  std::mutex mutex_;
  std::condition_variable cond_var_;
  std::atomic<bool> stop_;
  std::vector<LocalMaps> thread_data_;
  SVFIR *pag_;
};

void analysis(SVFModule *M, SVFIR *pag, std::deque<CallInst *> &tasks) {
  errs() << "task size: " << tasks.size() << "\n";
  ThreadPool pool(ThreadNum, pag, tasks);
}

void initialize(SVFIR *pag, SVFModule *svfModule) {
  getBlockedNodes(pag);
  setupPhiEdges(pag);
  setupSelectEdges(pag);
  handleAnonymousStruct(svfModule, pag);
  addSVFAddrFuncs(svfModule, pag);
  collectByteoffset(pag);
  setupStores(pag);
  processCastSites(pag, svfModule);
  setupDependence(pag, svfModule);
  getAllicalls(svfModule);
  processTraces(pag);
  processSELinuxhooks(pag, svfModule);
  processCastMap(pag);
  errs() << "shortcuts setup! " << "\n";
}

unordered_map<u32_t, unordered_map<string, unordered_set<u32_t>>> sizeMaps;

void sortSizeMap(
    std::vector<pair<u32_t, unordered_map<string, unordered_set<u32_t>>>>
        &sorted,
    unordered_map<u32_t, unordered_map<string, unordered_set<u32_t>>> &before) {
  sorted.reserve(before.size());
  for (const auto &kv : before) {
    sorted.emplace_back(kv.first, kv.second);
  }
  std::stable_sort(
      std::begin(sorted), std::end(sorted),
      [](const pair<u32_t, unordered_map<string, unordered_set<u32_t>>> &a,
         const pair<u32_t, unordered_map<string, unordered_set<u32_t>>> &b) {
        return a.first > b.first;
      });
}

void checkShortcuts() {
  ofstream fout(OutputDir + "/stats");
  for (auto st : typebasedShortcuts) {
    for (auto idx : st.second) {
      sizeMaps[idx.second.size()][st.first].insert(idx.first);
    }
  }
  std::vector<pair<u32_t, unordered_map<string, unordered_set<u32_t>>>> sorted;
  sortSizeMap(sorted, sizeMaps);
  for (auto elem : sorted) {
    fout << elem.first << "\n";
    for (auto st : elem.second) {
      for (auto fd : st.second) {
        fout << st.first << "\t" << fd << "\n";
      }
    }
    fout << "\n\n\n";
  }
  fout.close();
}

auto program_start = std::chrono::steady_clock::now();

void log_time(const std::string &stage_name, ofstream &fout) {
  auto now = std::chrono::steady_clock::now();
  auto elapsed = std::chrono::duration<double>(now - program_start).count();
  fout << "[" << stage_name << "] Time since start: " << elapsed << "s"
       << std::endl;
}

void printCallGraph(string filename) {
  ofstream fout(filename);
  for (auto icall : callgraph) {
    auto dbginfo = icall.first->getDebugLoc();
    string output = dbginfo->getFilename().str() + ":" +
                    to_string(dbginfo->getLine()) + "\n" +
                    to_string(icall.second.size()) + "\n";
    for (auto func : icall.second) {
      output += func->getName().str() + "\n";
    }
    fout << output << endl;
    fout << endl << flush;
  }
}

int main(int argc, char **argv) {
  int arg_num = 0;
  char **arg_value = new char *[argc];
  std::vector<std::string> moduleNameVec;
  processArguments(argc, argv, arg_num, arg_value, moduleNameVec);
  cl::ParseCommandLineOptions(arg_num, arg_value,
                              "Whole Program Points-to Analysis\n");
  delete[] arg_value;
  createOutputFolder();

  if (!ExtAPIPath.empty()) {
    SVF::ExtAPI::setExtBcPath(ExtAPIPath);
  }

  LLVMModuleSet::buildSVFModule(moduleNameVec);
  SVFModule *svfModule = LLVMModuleSet::getLLVMModuleSet();

  ofstream fout(OutputDir + "/log");
  SVFIRBuilder builder;
  SVFIR *pag = builder.build();
  errs() << "pag built!\n";
  log_time("pag built", fout);
  baseNum = (moduleNameVec.size() > THRESHOLD) ? ALLYESCONFIG : DEFCONFIG;
  initialize(pag, svfModule);

  std::deque<CallInst *> tasks;
  if (auto input = getSpecifyInput(svfModule)) {
    tasks = std::deque<CallInst *>(input->begin(), input->end());
  } else {
    tasks = std::deque<CallInst *>(callinsts.begin(), callinsts.end());
  }
  log_time("starting round 0", fout);
  analysis(svfModule, pag, tasks);
  printCallGraph(OutputDir + "/callgraph0");
  size_t new_callgraph_size = getCallGraphSizeSum();
  while (SpecifyInput == "" && new_callgraph_size != callgraph_size) {
    static int i = 0;
    log_time("starting round " + to_string(i++), fout);
    fout << "new callgraph size: " << new_callgraph_size << "\n";
    callgraph_size = new_callgraph_size;
    setupCallGraph(pag);
    unordered_set<CallInst *> task_set;
    for (auto new_func : newTargets) {
      for (auto nxt_task : GlobalDepFuncs[new_func]) {
        if (fixediCalls.find(nxt_task) == fixediCalls.end()) {
          fixediCalls.insert(nxt_task);
          task_set.insert(nxt_task);
        }
      }
    }
    newTargets.clear();
    for (auto new_icall : newiCalls) {
      for (auto nxt_task : GlobalDepiCalls[new_icall]) {
        if (fixediCalls.find(nxt_task) == fixediCalls.end()) {
          fixediCalls.insert(nxt_task);
          task_set.insert(nxt_task);
        }
      }
    }
    newiCalls.clear();
    for (auto task : task_set) {
      tasks.push_back(task);
    }
    fout << "new task size: " << tasks.size() << "\n";
    fout.flush();
    analysis(svfModule, pag, tasks);
    new_callgraph_size = getCallGraphSizeSum();
    printCallGraph(OutputDir + "/callgraph" + to_string(i));
  }
  log_time("analysis done", fout);
  std::string pointsToOutput = PointsToPath.empty()
      ? (OutputDir + "/points-to.json")
      : PointsToPath.getValue();
  writePointsToQueriesJson(pointsToOutput, svfModule, pag);
  fout.close();
  return 0;
}
