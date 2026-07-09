#include "DevilangModelPass.h"

#include <algorithm>
#include <cctype>
#include <map>
#include <optional>
#include <set>
#include <cstdlib>
#include <string>
#include <sstream>
#include <utility>
#include <vector>

#include "llvm/ADT/SmallString.h"
#include "llvm/ADT/SmallPtrSet.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/ADT/ScopeExit.h"
#include "llvm/ADT/StringRef.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/BasicBlock.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/DebugInfoMetadata.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/InstrTypes.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/IntrinsicInst.h"
#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/ADT/SmallPtrSet.h"
#include "llvm/ADT/SmallVector.h"

namespace devilang {
namespace {

using llvm::BasicBlock;
using llvm::BranchInst;
using llvm::CallBase;
using llvm::ConstantInt;
using llvm::Function;
using llvm::GetElementPtrInst;
using llvm::Instruction;
using llvm::DbgValueInst;
using llvm::LoadInst;
using llvm::Module;
using llvm::PHINode;
using llvm::StoreInst;
using llvm::StringRef;
using llvm::Value;

struct TraceBlock {
  std::string label;
  std::vector<std::string> lines;
};

struct TraceModel {
  std::string name;
  bool entry = false;
  std::vector<TraceBlock> blocks;
};

struct MachineModel {
  std::string name;
  std::set<std::string> scratchVars;
  std::vector<TraceModel> traces;
  std::set<std::string> emittedFunctions;
};

std::string sanitizeToken(StringRef input) {
  std::string out;
  out.reserve(input.size());
  bool lastUnderscore = false;
  for (char ch : input) {
    if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_') {
      out.push_back(ch);
      lastUnderscore = false;
      continue;
    }
    if (!lastUnderscore) {
      out.push_back('_');
      lastUnderscore = true;
    }
  }
  if (out.empty()) {
    out = "unnamed";
  }
  if (std::isdigit(static_cast<unsigned char>(out.front()))) {
    out.insert(out.begin(), '_');
  }
  return out;
}

std::string sanitizeFunctionName(const Function &function) {
  return sanitizeToken(function.getName());
}

std::string traceNameFor(const Function &function) {
  return sanitizeFunctionName(function) + "_trace";
}

bool isReadLeaf(StringRef name) {
  return name.startswith("readb") || name.startswith("readw") ||
         name.startswith("readl") || name.startswith("readq") ||
         name.startswith("ioread8") || name.startswith("ioread16") ||
         name.startswith("ioread32") || name.startswith("ioread64") ||
         name.startswith("__raw_readb") || name.startswith("__raw_readw") ||
         name.startswith("__raw_readl") || name.startswith("__raw_readq");
}

bool isWriteLeaf(StringRef name) {
  return name.startswith("writeb") || name.startswith("writew") ||
         name.startswith("writel") || name.startswith("writeq") ||
         name.startswith("iowrite8") || name.startswith("iowrite16") ||
         name.startswith("iowrite32") || name.startswith("iowrite64") ||
         name.startswith("__raw_writeb") || name.startswith("__raw_writew") ||
         name.startswith("__raw_writel") || name.startswith("__raw_writeq");
}

bool isSgFunction(StringRef name) {
  return name == "sg_init_one" || name == "sg_init_table" || name == "sg_set_buf" ||
         name == "sg_next";
}

bool isPrunedHelper(StringRef name) {
  return name.startswith("kzalloc_noprof") ||
         name.startswith("kmalloc") ||
         name.startswith("__kmalloc") ||
         name.startswith("__kzalloc") ||
         name.startswith("kfree") ||
         name.startswith("memset") ||
         name.startswith("memcpy") ||
         name == "netdev_priv" ||
         name == "INIT_LIST_HEAD";
}

unsigned ioWidthFromName(StringRef name) {
  if (name.contains("64") || name.endswith("q")) {
    return 64;
  }
  if (name.contains("32") || name.endswith("l")) {
    return 32;
  }
  if (name.contains("16") || name.endswith("w")) {
    return 16;
  }
  return 8;
}

std::optional<unsigned> passthroughArgumentIndexForPrunedHelper(StringRef name) {
  if (name == "netdev_priv") {
    return 0;
  }
  if (name.startswith("memset") || name.startswith("memcpy")) {
    return 0;
  }
  return std::nullopt;
}

std::string trimPath(StringRef path) {
  return path.trim().str();
}

bool parseLocationToken(StringRef token, std::string &path, unsigned &line) {
  const size_t colon = token.rfind(':');
  if (colon == StringRef::npos) {
    return false;
  }
  StringRef pathPart = token.substr(0, colon).trim();
  StringRef linePart = token.substr(colon + 1).trim();
  unsigned parsed = 0;
  if (pathPart.empty() || linePart.getAsInteger(10, parsed)) {
    return false;
  }
  path = pathPart.str();
  line = parsed;
  return true;
}

class PhaseBuilder {
public:
  PhaseBuilder(
      Module &module,
      PhaseRequest request,
      const std::map<std::string, std::vector<std::string>> &indirectCalls)
      : module_(module),
        request_(std::move(request)),
        indirectCalls_(indirectCalls) {
    model_.name = request_.machineName;
  }

  std::string build() {
    for (const std::string &entryName : request_.entryFunctions) {
      if (Function *entry = module_.getFunction(entryName)) {
        buildTrace(*entry);
      }
    }
    return renderModel();
  }

private:
  enum class Relevance {
    Unknown,
    Visiting,
    Relevant,
    Irrelevant,
  };

  Module &module_;
  PhaseRequest request_;
  MachineModel model_;
  unsigned scratchCounter_ = 0;
  unsigned labelCounter_ = 0;
  const std::map<std::string, std::vector<std::string>> &indirectCalls_;
  std::map<const Function *, Relevance> relevanceCache_;
  std::map<const Value *, std::string> valueNames_;
  std::set<const Value *> renderingValues_;

  std::optional<std::vector<std::string>> resolveIndirectCallees(
      const CallBase &call) {
    if (llvm::dyn_cast<Function>(call.getCalledOperand()->stripPointerCasts())) {
      return std::nullopt;
    }

    const llvm::DebugLoc &debugLoc = call.getDebugLoc();
    if (!debugLoc) {
      return std::nullopt;
    }

    const llvm::DILocation *location = debugLoc.get();
    const llvm::DIScope *scope = location->getScope();
    const auto *file = scope ? scope->getFile() : nullptr;
    if (!file) {
      return std::nullopt;
    }

    const std::string filename = trimPath(file->getFilename());
    const std::string directory = trimPath(file->getDirectory());
    const unsigned line = location->getLine();
    if (filename.empty() || line == 0) {
      return std::nullopt;
    }

    std::string combined = filename;
    if (!directory.empty()) {
      combined = directory;
      if (!combined.empty() && combined.back() != '/') {
        combined += "/";
      }
      combined += filename;
    }

    std::vector<std::string> matches;
    for (const auto &kv : indirectCalls_) {
      std::string callsitePath;
      unsigned callsiteLine = 0;
      if (!parseLocationToken(kv.first, callsitePath, callsiteLine) ||
          callsiteLine != line) {
        continue;
      }
      if (callsitePath != combined &&
          callsitePath != filename &&
          !(callsitePath.size() > filename.size() &&
            StringRef(callsitePath).endswith(filename)) &&
          !(combined.size() > callsitePath.size() &&
            StringRef(combined).endswith(callsitePath))) {
        continue;
      }
      matches.insert(matches.end(), kv.second.begin(), kv.second.end());
    }
    if (matches.empty()) {
      return std::nullopt;
    }
    std::sort(matches.begin(), matches.end());
    matches.erase(std::unique(matches.begin(), matches.end()), matches.end());
    return matches;
  }

  const Value *findStoredValueForPointer(const Value *pointer,
                                         const Instruction *context) {
    llvm::SmallPtrSet<const Value *, 16> visited;
    const StoreInst *store = findUniqueStoreForPointer(pointer, context, visited);
    if (!store) {
      return nullptr;
    }
    return store->getValueOperand();
  }

  const StoreInst *findUniqueStoreForPointer(
      const Value *pointer,
      const Instruction *context,
      llvm::SmallPtrSetImpl<const Value *> &visited) {
    if (!pointer || !visited.insert(pointer).second) {
      return nullptr;
    }

    const StoreInst *matchingStore = nullptr;
    for (const llvm::User *user : pointer->users()) {
      if (const auto *store = llvm::dyn_cast<StoreInst>(user)) {
        if (store->getPointerOperand() != pointer) {
          continue;
        }
        if (!context || store->getFunction() != context->getFunction()) {
          continue;
        }
        if (matchingStore) {
          return nullptr;
        }
        matchingStore = store;
        continue;
      }

      const auto *instruction = llvm::dyn_cast<Instruction>(user);
      if (!instruction) {
        continue;
      }
      if (instruction->getOpcode() != llvm::Instruction::BitCast &&
          instruction->getOpcode() != llvm::Instruction::AddrSpaceCast) {
        continue;
      }
      const StoreInst *aliasStore =
          findUniqueStoreForPointer(instruction, context, visited);
      if (!aliasStore) {
        continue;
      }
      if (matchingStore && matchingStore != aliasStore) {
        return nullptr;
      }
      matchingStore = aliasStore;
    }

    return matchingStore;
  }

  bool isFunctionRelevant(const Function &function) {
    auto it = relevanceCache_.find(&function);
    if (it != relevanceCache_.end()) {
      if (it->second == Relevance::Relevant) {
        return true;
      }
      if (it->second == Relevance::Irrelevant) {
        return false;
      }
      if (it->second == Relevance::Visiting) {
        return false;
      }
    }

    if (function.isIntrinsic() || isPrunedHelper(function.getName())) {
      relevanceCache_[&function] = Relevance::Irrelevant;
      return false;
    }

    relevanceCache_[&function] = Relevance::Visiting;

    if (function.isDeclaration()) {
      const bool relevant =
          isReadLeaf(function.getName()) ||
          isWriteLeaf(function.getName()) ||
          isSgFunction(function.getName());
      relevanceCache_[&function] =
          relevant ? Relevance::Relevant : Relevance::Irrelevant;
      return relevant;
    }

    bool relevant = false;
    for (const BasicBlock &block : function) {
      for (const Instruction &instruction : block) {
        const auto *call = llvm::dyn_cast<CallBase>(&instruction);
        if (!call) {
          continue;
        }
        const Function *callee =
            llvm::dyn_cast<Function>(call->getCalledOperand()->stripPointerCasts());
        if (callee && callee->isIntrinsic()) {
          continue;
        }
        if (!callee) {
          if (const auto resolved = resolveIndirectCallees(*call)) {
            for (const std::string &calleeName : *resolved) {
              const Function *resolvedCallee = module_.getFunction(calleeName);
              if (!resolvedCallee || resolvedCallee->isIntrinsic()) {
                continue;
              }
              if (isReadLeaf(resolvedCallee->getName()) ||
                  isWriteLeaf(resolvedCallee->getName()) ||
                  isSgFunction(resolvedCallee->getName()) ||
                  isFunctionRelevant(*resolvedCallee)) {
                relevant = true;
                break;
              }
            }
          }
          if (relevant) {
            break;
          }
          continue;
        }
        if (isReadLeaf(callee->getName()) || isWriteLeaf(callee->getName()) ||
            isSgFunction(callee->getName())) {
          relevant = true;
          break;
        }
        if (isPrunedHelper(callee->getName())) {
          continue;
        }
        if (isFunctionRelevant(*callee)) {
          relevant = true;
          break;
        }
      }
      if (relevant) {
        break;
      }
    }

    relevanceCache_[&function] =
        relevant ? Relevance::Relevant : Relevance::Irrelevant;
    return relevant;
  }

  void buildTrace(Function &function) {
    if (function.isDeclaration() || !isFunctionRelevant(function)) {
      return;
    }
    std::string functionName = function.getName().str();
    if (!model_.emittedFunctions.insert(functionName).second) {
      return;
    }

    TraceModel trace;
    trace.name = traceNameFor(function);
    trace.entry =
        std::find(request_.entryFunctions.begin(), request_.entryFunctions.end(),
                  function.getName().str()) != request_.entryFunctions.end();

    collectDebugNames(function);

    std::map<const BasicBlock *, std::string> labels;
    bool entrySeen = false;
    for (const BasicBlock &block : function) {
      if (!entrySeen) {
        labels[&block] = "";
        entrySeen = true;
        continue;
      }
      labels[&block] = "bb_" + sanitizeFunctionName(function) + "_" +
                       std::to_string(labelCounter_++);
    }

    std::set<const BasicBlock *> emittedBlocks;
    emitBlock(function.getEntryBlock(), labels, trace, emittedBlocks);

    for (const BasicBlock &block : function) {
      if (emittedBlocks.find(&block) == emittedBlocks.end()) {
        emitBlock(block, labels, trace, emittedBlocks);
      }
    }

    model_.traces.push_back(std::move(trace));
  }

  void emitBlock(const BasicBlock &block,
                 const std::map<const BasicBlock *, std::string> &labels,
                 TraceModel &trace,
                 std::set<const BasicBlock *> &emittedBlocks) {
    if (!emittedBlocks.insert(&block).second) {
      return;
    }

    TraceBlock out;
    auto labelIt = labels.find(&block);
    if (labelIt != labels.end()) {
      out.label = labelIt->second;
    }

    for (const Instruction &instruction : block) {
      if (const auto *call = llvm::dyn_cast<CallBase>(&instruction)) {
        emitCall(*call, out.lines);
        continue;
      }

      if (const auto *branch = llvm::dyn_cast<BranchInst>(&instruction)) {
        emitBranch(*branch, labels, out.lines);
      }
    }

    if (out.lines.empty()) {
      out.lines.push_back("...");
    }

    trace.blocks.push_back(std::move(out));

    const BranchInst *branch = llvm::dyn_cast<BranchInst>(block.getTerminator());
    if (!branch) {
      return;
    }
    if (branch->isUnconditional()) {
      if (BasicBlock *successor = branch->getSuccessor(0)) {
        emitBlock(*successor, labels, trace, emittedBlocks);
      }
      return;
    }
    BasicBlock *trueBlock = branch->getSuccessor(0);
    BasicBlock *falseBlock = branch->getSuccessor(1);
    if (falseBlock) {
      emitBlock(*falseBlock, labels, trace, emittedBlocks);
    }
    if (trueBlock) {
      emitBlock(*trueBlock, labels, trace, emittedBlocks);
    }
  }

  void emitBranch(const BranchInst &branch,
                  const std::map<const BasicBlock *, std::string> &labels,
                  std::vector<std::string> &lines) {
    if (branch.isUnconditional()) {
      return;
    }
    const BasicBlock *trueBlock = branch.getSuccessor(0);
    const BasicBlock *falseBlock = branch.getSuccessor(1);
    if (const auto *icmp =
            llvm::dyn_cast<llvm::ICmpInst>(branch.getCondition())) {
      const std::string lhs = renderValue(icmp->getOperand(0));
      const std::string rhs = renderValue(icmp->getOperand(1));
      const auto predicate = icmp->getPredicate();

      if (predicate == llvm::ICmpInst::ICMP_NE) {
        const auto labelIt = labels.find(trueBlock);
        if (labelIt != labels.end() && !labelIt->second.empty()) {
          lines.push_back("neqj " + lhs + ", " + rhs + ", @" + labelIt->second);
          return;
        }
      }

      if (predicate == llvm::ICmpInst::ICMP_EQ && falseBlock) {
        const auto labelIt = labels.find(falseBlock);
        if (labelIt != labels.end() && !labelIt->second.empty()) {
          lines.push_back("neqj " + lhs + ", " + rhs + ", @" + labelIt->second);
          return;
        }
      }
    }

    const std::string condition = renderValue(branch.getCondition());
    const auto labelIt = labels.find(trueBlock);
    if (labelIt == labels.end() || labelIt->second.empty()) {
      return;
    }
    lines.push_back("neqj " + condition + ", 0, @" + labelIt->second);
  }

  void emitCall(const CallBase &call, std::vector<std::string> &lines) {
    const Function *callee =
        llvm::dyn_cast<Function>(call.getCalledOperand()->stripPointerCasts());
    if (callee && callee->isIntrinsic()) {
      if (const auto *dbgValue = llvm::dyn_cast<DbgValueInst>(&call)) {
        captureDebugValue(*dbgValue);
      }
      return;
    }
    if (!callee) {
      const auto resolved = resolveIndirectCallees(call);
      if (!resolved) {
        return;
      }
      for (const std::string &calleeName : *resolved) {
        const Function *resolvedCallee = module_.getFunction(calleeName);
        if (!resolvedCallee || resolvedCallee->isIntrinsic()) {
          continue;
        }
        emitResolvedCall(*resolvedCallee, call, lines);
      }
      return;
    }
    emitResolvedCall(*callee, call, lines);
  }

  void emitResolvedCall(const Function &callee,
                        const CallBase &call,
                        std::vector<std::string> &lines) {
    StringRef name = callee.getName();
    if (isPrunedHelper(name)) {
      return;
    }
    if (isReadLeaf(name)) {
      const unsigned width = ioWidthFromName(name);
      const std::string scratch = nameForValue(&call);
      valueNames_[&call] = scratch;
      const std::string address =
          call.arg_size() >= 1 ? renderValue(call.getArgOperand(call.arg_size() - 1))
                               : "unknown";
      lines.push_back(scratch + " = read" + std::to_string(width) + "(" + address +
                      ")");
      return;
    }

    if (isWriteLeaf(name)) {
      const unsigned width = ioWidthFromName(name);
      const std::string value =
          call.arg_size() >= 1 ? renderValue(call.getArgOperand(0)) : "unknown";
      const std::string address =
          call.arg_size() >= 2 ? renderValue(call.getArgOperand(1)) : "unknown";
      lines.push_back("write" + std::to_string(width) + "(" + value + ", " +
                      address + ")");
      return;
    }

    if (isSgFunction(name)) {
      lines.push_back("call " + sanitizeToken(name) + renderCallArgs(call));
      return;
    }

    if (!isFunctionRelevant(callee)) {
      return;
    }

    lines.push_back("call " + sanitizeToken(name) + renderCallArgs(call));

    if (!callee.isDeclaration()) {
      buildTrace(*const_cast<Function *>(&callee));
    }
  }

  std::string renderCallArgs(const CallBase &call) {
    std::string out = "(";
    for (unsigned index = 0; index < call.arg_size(); ++index) {
      if (index != 0) {
        out += ", ";
      }
      out += renderValue(call.getArgOperand(index));
    }
    out += ")";
    return out;
  }

  std::string renderValue(const Value *value) {
    if (!value) {
      return "unknown";
    }
    if (!renderingValues_.insert(value).second) {
      if (value->hasName()) {
        return sanitizeToken(value->getName());
      }
      return "unknown";
    }
    auto guard = llvm::make_scope_exit([&] { renderingValues_.erase(value); });
    if (const auto *constant = llvm::dyn_cast<ConstantInt>(value)) {
      llvm::SmallString<32> buffer;
      constant->getValue().toString(buffer, 10, false);
      return std::string(buffer.str());
    }
    if (const auto *argument = llvm::dyn_cast<llvm::Argument>(value)) {
      if (argument->hasName()) {
        return sanitizeToken(argument->getName());
      }
      return "unknown";
    }
    if (const auto *call = llvm::dyn_cast<CallBase>(value)) {
      if (auto it = valueNames_.find(call); it != valueNames_.end()) {
        return it->second;
      }
      if (const Function *callee =
              llvm::dyn_cast<Function>(call->getCalledOperand()->stripPointerCasts())) {
        if (isPrunedHelper(callee->getName())) {
          if (const auto passthrough =
                  passthroughArgumentIndexForPrunedHelper(callee->getName())) {
            if (*passthrough < call->arg_size()) {
              return renderValue(call->getArgOperand(*passthrough));
            }
          }
          return "unknown";
        }
        if (!isReadLeaf(callee->getName()) &&
            !isWriteLeaf(callee->getName()) &&
            !isSgFunction(callee->getName())) {
          if (call->getType()->isPointerTy()) {
            return sanitizeToken(callee->getName()) + renderCallExprArgs(*call);
          }
          return "unknown";
        }
        return sanitizeToken(callee->getName()) + renderCallExprArgs(*call);
      }
      return "unknown";
    }
    if (const auto *instruction = llvm::dyn_cast<Instruction>(value)) {
      if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(instruction)) {
        llvm::APInt offset(module_.getDataLayout().getPointerSizeInBits(
                               gep->getPointerAddressSpace()),
                           0, true);
        if (gep->accumulateConstantOffset(module_.getDataLayout(), offset)) {
          const std::string base = renderValue(gep->getPointerOperand());
          llvm::SmallString<32> buffer;
          offset.toString(buffer, 10, true);
          const std::string off = std::string(buffer.str());
          if (off == "0") {
            return base;
          }
          if (!off.empty() && off[0] == '-') {
            return base + " - " + off.substr(1);
          }
          return base + " + " + off;
        }
      }
      if (const auto *load = llvm::dyn_cast<LoadInst>(instruction)) {
        if (const Value *storedValue =
                findStoredValueForPointer(load->getPointerOperand(), load)) {
          return renderValue(storedValue);
        }
        return renderValue(load->getPointerOperand());
      }
      if (instruction->getOpcode() == llvm::Instruction::BitCast ||
          instruction->getOpcode() == llvm::Instruction::AddrSpaceCast ||
          instruction->getOpcode() == llvm::Instruction::PtrToInt ||
          instruction->getOpcode() == llvm::Instruction::IntToPtr ||
          instruction->getOpcode() == llvm::Instruction::ZExt ||
          instruction->getOpcode() == llvm::Instruction::SExt ||
          instruction->getOpcode() == llvm::Instruction::Trunc ||
          instruction->getOpcode() == llvm::Instruction::FPTrunc ||
          instruction->getOpcode() == llvm::Instruction::FPExt ||
          instruction->getOpcode() == llvm::Instruction::UIToFP ||
          instruction->getOpcode() == llvm::Instruction::SIToFP ||
          instruction->getOpcode() == llvm::Instruction::FPToUI ||
          instruction->getOpcode() == llvm::Instruction::FPToSI) {
        return renderValue(instruction->getOperand(0));
      }
      if (const auto *icmp = llvm::dyn_cast<llvm::ICmpInst>(instruction)) {
        return renderValue(icmp->getOperand(0)) + " " +
               std::string(
                   llvm::CmpInst::getPredicateName(icmp->getPredicate())) +
               " " +
               renderValue(icmp->getOperand(1));
      }
      if (const auto *fcmp = llvm::dyn_cast<llvm::FCmpInst>(instruction)) {
        return renderValue(fcmp->getOperand(0)) + " " +
               std::string(
                   llvm::CmpInst::getPredicateName(fcmp->getPredicate())) +
               " " +
               renderValue(fcmp->getOperand(1));
      }
      if (const auto *phi = llvm::dyn_cast<PHINode>(instruction)) {
        std::set<std::string> incomingValues;
        for (unsigned index = 0; index < phi->getNumIncomingValues(); ++index) {
          incomingValues.insert(renderValue(phi->getIncomingValue(index)));
        }
        if (incomingValues.empty()) {
          return "unknown";
        }
        if (incomingValues.size() == 1) {
          return *incomingValues.begin();
        }
        std::string out = "phi(";
        bool first = true;
        for (const std::string &incoming : incomingValues) {
          if (!first) {
            out += ", ";
          }
          out += incoming;
          first = false;
        }
        out += ")";
        return out;
      }
      if (const auto *select = llvm::dyn_cast<llvm::SelectInst>(instruction)) {
        return "select(" + renderValue(select->getCondition()) + ", " +
               renderValue(select->getTrueValue()) + ", " +
               renderValue(select->getFalseValue()) + ")";
      }
      if (instruction->hasName()) {
        return sanitizeToken(instruction->getName());
      }
      if (instruction->getOpcode() == llvm::Instruction::Add ||
          instruction->getOpcode() == llvm::Instruction::Sub ||
          instruction->getOpcode() == llvm::Instruction::And ||
          instruction->getOpcode() == llvm::Instruction::Or ||
          instruction->getOpcode() == llvm::Instruction::Shl ||
          instruction->getOpcode() == llvm::Instruction::LShr) {
        const char *op = "+";
        switch (instruction->getOpcode()) {
          case llvm::Instruction::Add:
            op = "+";
            break;
          case llvm::Instruction::Sub:
            op = "-";
            break;
          case llvm::Instruction::And:
            op = "&";
            break;
          case llvm::Instruction::Or:
            op = "|";
            break;
          case llvm::Instruction::Shl:
            op = "<<";
            break;
          case llvm::Instruction::LShr:
            op = ">>";
            break;
          default:
            break;
        }
        return renderValue(instruction->getOperand(0)) + " " + op + " " +
               renderValue(instruction->getOperand(1));
      }
      if (instruction->getNumOperands() >= 1) {
        return renderValue(instruction->getOperand(0));
      }
    }
    if (value->hasName()) {
      return sanitizeToken(value->getName());
    }
    return "unknown";
  }

  std::string renderCallExprArgs(const CallBase &call) {
    std::string out = "(";
    for (unsigned index = 0; index < call.arg_size(); ++index) {
      if (index != 0) {
        out += ", ";
      }
      out += renderValue(call.getArgOperand(index));
    }
    out += ")";
    return out;
  }

  std::string nextScratch() {
    const std::string name = "scratch.auto_" + std::to_string(scratchCounter_++);
    model_.scratchVars.insert(name);
    return name;
  }

  std::optional<std::string> inferSemanticName(const Value *value) {
    llvm::SmallVector<const Value *, 8> worklist;
    llvm::SmallPtrSet<const Value *, 16> visited;
    worklist.push_back(value);

    while (!worklist.empty()) {
      const Value *current = worklist.pop_back_val();
      if (!current || !visited.insert(current).second) {
        continue;
      }

      for (const llvm::User *user : current->users()) {
        if (const auto *store = llvm::dyn_cast<StoreInst>(user)) {
          if (store->getValueOperand() != current) {
            continue;
          }
          const Value *pointer = store->getPointerOperand();
          if (auto pointerName = inferPointerName(pointer)) {
            return pointerName;
          }
          continue;
        }

        const auto *instruction = llvm::dyn_cast<Instruction>(user);
        if (!instruction) {
          continue;
        }
        switch (instruction->getOpcode()) {
          case llvm::Instruction::BitCast:
          case llvm::Instruction::AddrSpaceCast:
          case llvm::Instruction::PtrToInt:
          case llvm::Instruction::IntToPtr:
          case llvm::Instruction::ZExt:
          case llvm::Instruction::SExt:
          case llvm::Instruction::Trunc:
            worklist.push_back(instruction);
            break;
          default:
            break;
        }
      }
    }

    return std::nullopt;
  }

  std::optional<std::string> inferPointerName(const Value *pointer) {
    const Value *current = pointer;
    llvm::SmallPtrSet<const Value *, 8> visited;

    while (current && visited.insert(current).second) {
      if (current->hasName()) {
        return sanitizeToken(current->getName());
      }
      if (const auto *instruction = llvm::dyn_cast<Instruction>(current)) {
        switch (instruction->getOpcode()) {
          case llvm::Instruction::BitCast:
          case llvm::Instruction::AddrSpaceCast:
          case llvm::Instruction::GetElementPtr:
            current = instruction->getOperand(0);
            continue;
          default:
            break;
        }
      }
      break;
    }

    return std::nullopt;
  }

  std::string nameForValue(const Value *value) {
    if (value) {
      if (auto it = valueNames_.find(value); it != valueNames_.end()) {
        model_.scratchVars.insert(it->second);
        return it->second;
      }
      if (auto inferred = inferSemanticName(value)) {
        model_.scratchVars.insert(*inferred);
        return *inferred;
      }
    }
    if (value && value->hasName()) {
      const std::string named = sanitizeToken(value->getName());
      model_.scratchVars.insert(named);
      return named;
    }
    return nextScratch();
  }

  void captureDebugValue(const DbgValueInst &dbgValue) {
    const Value *value = dbgValue.getValue();
    const auto *variable = dbgValue.getVariable();
    if (!value || !variable || llvm::isa<llvm::UndefValue>(value) ||
        llvm::isa<llvm::ConstantPointerNull>(value)) {
      return;
    }
    const std::string name = sanitizeToken(variable->getName());
    if (name.empty() || name == "unnamed") {
      return;
    }
    valueNames_[value] = name;
    model_.scratchVars.insert(name);
  }

  void collectDebugNames(Function &function) {
    for (const BasicBlock &block : function) {
      for (const Instruction &instruction : block) {
        if (const auto *dbgValue = llvm::dyn_cast<DbgValueInst>(&instruction)) {
          captureDebugValue(*dbgValue);
        }
      }
    }
  }

  std::string renderModel() {
    std::ostringstream out;
    out << "machine " << sanitizeToken(request_.machineName) << " {\n";
    out << "    initial start\n";
    out << "\n";
    if (!model_.scratchVars.empty()) {
      out << "    scratch {\n";
      for (const std::string &scratch : model_.scratchVars) {
        out << "        " << scratch << ";\n";
      }
      out << "    }\n\n";
    }
    for (const TraceModel &trace : model_.traces) {
      out << "    ";
      if (trace.entry) {
        out << "entry ";
      }
      out << "trace " << sanitizeToken(trace.name) << " {\n";
      bool first = true;
      for (const TraceBlock &block : trace.blocks) {
        if (!first) {
          out << "\n";
        }
        if (!block.label.empty()) {
          out << "        @" << block.label << ": sequence {\n";
        } else {
          out << "        sequence {\n";
        }
        for (const std::string &line : block.lines) {
          out << "            " << line << ";\n";
        }
        out << "        }\n";
        first = false;
      }
      out << "    }\n\n";
    }
    out << "    state start\n";
    out << "}\n";
    return out.str();
  }
};

}  // namespace

DevilangModelPass::DevilangModelPass(BuildRequest request)
    : request_(std::move(request)) {}

llvm::PreservedAnalyses DevilangModelPass::run(llvm::Module &module,
                                               llvm::ModuleAnalysisManager &) {
  outputs_.clear();
  for (const PhaseRequest &phase : request_.phases) {
    PhaseBuilder builder(module, phase, request_.indirectCalls);
    outputs_[phase.machineName] = builder.build();
  }
  return llvm::PreservedAnalyses::all();
}

llvm::PassPluginLibraryInfo getDevilangModelPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "devilang-model", LLVM_VERSION_STRING,
          [](llvm::PassBuilder &builder) {
            builder.registerPipelineParsingCallback(
                [](StringRef name, llvm::ModulePassManager &manager,
                   llvm::ArrayRef<llvm::PassBuilder::PipelineElement>) {
                  if (name != "devilang-model") {
                    return false;
                  }
                  manager.addPass(DevilangModelPass());
                  return true;
                });
          }};
}

}  // namespace devilang

extern "C" LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo() {
  return devilang::getDevilangModelPluginInfo();
}
