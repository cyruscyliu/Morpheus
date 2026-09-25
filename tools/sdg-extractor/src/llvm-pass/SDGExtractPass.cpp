//===- SDGExtractPass.cpp - Extract SDG rules via SdgSvfCore ------------===//
//
// This pass extracts Semantic Dependency Graph (SDG) rules from LLVM bitcode
// using the SdgSvfCore infrastructure on top of SVF 3.3.
//
// Architecture:
//   SDGExtractPass  -> orchestration + JSON output
//   SdgSvfCore      -> source/sink catalogs, role taint, control dep, rules
//   SVF 3.3         -> SVFG, pointer analysis, ICFG
//
// No legacy hand-rolled value-flow graph remains in this file.
//
//===----------------------------------------------------------------------===//

#include "sdg/core/ControlDependencyAnalysis.h"
#include "sdg/core/Predicate.h"
#include "sdg/core/Role.h"
#include "sdg/core/RoleTaintAnalysis.h"
#include "sdg/core/Rule.h"
#include "sdg/core/RuleAssembler.h"
#include "sdg/core/SemanticSink.h"
#include "sdg/core/SemanticSource.h"
#include "sdg/core/SemanticValueFlowGraph.h"
#include "sdg/core/SinkCatalog.h"
#include "sdg/core/SourceCatalog.h"

#include "Graphs/SVFG.h"
#include "SVF-LLVM/LLVMModule.h"
#include "SVF-LLVM/SVFIRBuilder.h"
#include "SVFIR/SVFIR.h"
#include "Util/ExtAPI.h"
#include "WPA/Andersen.h"

#include "llvm/IR/Function.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_ostream.h"

#include <algorithm>
#include <filesystem>
#include <map>
#include <queue>
#include <set>
#include <string>
#include <tuple>
#include <vector>

using namespace llvm;
using namespace SVF;
using namespace sdg::core;

static cl::opt<std::string> SDGOutputPath(
    "sdg-output",
    cl::desc("Path to write SDG extraction JSON output"),
    cl::value_desc("filename"),
    cl::init("sdg-rules.json"));

static cl::opt<std::string> SDGEntryList(
    "sdg-entry-list",
    cl::desc("Path to file listing entry function names (optional)"),
    cl::value_desc("filename"),
    cl::init(""));

static cl::opt<std::string> SDGExtAPIPath(
    "sdg-extapi",
    cl::desc("Path to SVF extapi.bc (default: tool third_party install)"),
    cl::value_desc("filename"),
    cl::init(""));

namespace {

//===----------------------------------------------------------------------===//
// JSON serialization helpers
//===----------------------------------------------------------------------===//

static json::Value toJSON(const Predicate &p) {
  json::Object obj;
  obj["kind"] = p.kind;
  if (p.value.hasValue())
    obj["value"] = static_cast<int64_t>(p.value.getValue());
  if (p.bit.hasValue())
    obj["bit"] = static_cast<int64_t>(p.bit.getValue());
  if (p.min.hasValue())
    obj["min"] = static_cast<int64_t>(p.min.getValue());
  if (p.max.hasValue())
    obj["max"] = static_cast<int64_t>(p.max.getValue());
  return json::Value(std::move(obj));
}

static json::Value toJSON(const Mutation &m) {
  json::Object obj;
  obj["operator"] = m.op;
  if (m.value.hasValue())
    obj["value"] = static_cast<int64_t>(m.value.getValue());
  if (m.bit.hasValue())
    obj["bit"] = static_cast<int64_t>(m.bit.getValue());
  if (m.side.hasValue())
    obj["side"] = m.side.getValue();
  if (!m.var.empty())
    obj["var"] = m.var;
  return json::Value(std::move(obj));
}

static json::Value debugLocJSON(const DebugLoc &loc) {
  json::Object obj;
  if (loc) {
    obj["file"] = loc->getFilename().str();
    obj["line"] = static_cast<int64_t>(loc->getLine());
  } else {
    obj["file"] = "";
    obj["line"] = 0;
  }
  return json::Value(std::move(obj));
}

static json::Value toJSON(const SourceSchema &src) {
  json::Object obj;
  obj["class"] = src.clazz;
  obj["access_kind"] = src.accessKind;
  obj["offset"] = src.offset.hasValue()
                      ? json::Value(static_cast<int64_t>(src.offset.getValue()))
                      : json::Value(nullptr);
  obj["feature_bit"] =
      src.featureBit.hasValue()
          ? json::Value(static_cast<int64_t>(src.featureBit.getValue()))
          : json::Value(nullptr);
  obj["width_bytes"] =
      src.widthBytes.hasValue()
          ? json::Value(static_cast<int64_t>(src.widthBytes.getValue()))
          : json::Value(nullptr);
  obj["field"] = src.field.empty() ? json::Value(nullptr) : json::Value(src.field);
  obj["telemetry_event"] = json::Value(nullptr);
  return json::Value(std::move(obj));
}

static json::Value toJSON(const SemanticSource &src) {
  json::Object obj;
  obj["id"] = src.schema.id;
  obj["source"] = toJSON(src.schema);
  obj["llvm_value"] = src.rootValue && src.rootValue->hasName()
                          ? src.rootValue->getName().str()
                          : std::string("");
  obj["function"] = src.function;
  obj["debug_loc"] = debugLocJSON(src.loc);
  return json::Value(std::move(obj));
}

static json::Value toJSON(const SemanticSink &sink) {
  json::Object obj;
  obj["function"] = sink.function;
  obj["arg_index"] = static_cast<int64_t>(sink.argIndex);
  obj["role"] = roleName(sink.role);
  return json::Value(std::move(obj));
}

static json::Value toJSON(const Edge &e) {
  json::Object obj;
  obj["src"] = e.src;
  obj["dst"] = e.dst;
  obj["head"] = e.head;
  obj["predicate"] = toJSON(e.pred);
  obj["function"] = e.function;
  obj["debug_loc"] = debugLocJSON(e.loc);
  return json::Value(std::move(obj));
}

static json::Value toJSON(const Rule &r) {
  json::Object obj;
  obj["id"] = r.id;
  obj["function"] = r.function;

  json::Array vars;
  for (const SemanticSource &src : r.vars)
    vars.push_back(toJSON(src));
  obj["vars"] = json::Value(std::move(vars));

  json::Array sinks;
  for (const SemanticSink &sink : r.sinks)
    sinks.push_back(toJSON(sink));
  obj["sinks"] = json::Value(std::move(sinks));

  json::Array pre;
  for (const Edge &e : r.preconditions)
    pre.push_back(toJSON(e));
  obj["preconditions"] = json::Value(std::move(pre));

  obj["trigger"] = toJSON(r.trigger);
  obj["mutation"] = toJSON(r.mutation);
  obj["confidence"] = r.confidence;
  return json::Value(std::move(obj));
}

//===----------------------------------------------------------------------===//
// Grammar-compliant self-edge and cross-edge extraction
//===----------------------------------------------------------------------===//

static bool isTransparentUse(const User *U) {
  if (isa<CastInst>(U) || isa<PHINode>(U) || isa<SelectInst>(U) ||
      isa<UnaryOperator>(U))
    return true;
  if (auto *BO = dyn_cast<BinaryOperator>(U)) {
    auto op = BO->getOpcode();
    return op == Instruction::And || op == Instruction::Or ||
           op == Instruction::Add || op == Instruction::Sub;
  }
  return false;
}

/// reachable_uses from grammar-extraction.md: traverse casts, phi, select,
/// zext/sext/trunc, and and/or bit operations, yielding other users.
static std::vector<const Value *>
reachableUses(const Value *root) {
  std::vector<const Value *> yielded;
  std::set<const Value *> seen;
  std::vector<const Value *> work = {root};
  while (!work.empty()) {
    const Value *v = work.back();
    work.pop_back();
    if (!seen.insert(v).second)
      continue;
    for (const User *U : v->users()) {
      if (isTransparentUse(U))
        work.push_back(U);
      else
        yielded.push_back(U);
    }
  }
  return yielded;
}

static bool valueIsError(const Value *V) {
  if (!V)
    return false;
  if (auto *CI = dyn_cast<ConstantInt>(V)) {
    if (CI->getSExtValue() < 0)
      return true;
  }
  if (isa<ConstantPointerNull>(V))
    return true;
  return false;
}

static bool blockHasErrorCall(const BasicBlock *BB) {
  if (!BB)
    return false;
  for (const Instruction &I : *BB) {
    if (auto *CB = dyn_cast<CallBase>(&I)) {
      if (const Function *F = CB->getCalledFunction()) {
        StringRef name = F->getName();
        if (name == "BUG" || name == "panic" || name == "free_netdev" ||
            name == "kfree" || name.startswith("WARN") ||
            name == "dev_err")
          return true;
      }
    }
    if (isa<UnreachableInst>(&I))
      return true;
  }
  return false;
}

/// Return true if BB, when reached from pred, returns an error value or calls
/// an error handler.  This handles phi nodes in a shared return block.
static bool isErrorEdge(const BasicBlock *BB, const BasicBlock *pred) {
  if (!BB || !pred)
    return false;
  if (blockHasErrorCall(BB))
    return true;
  for (const Instruction &I : *BB) {
    if (auto *RI = dyn_cast<ReturnInst>(&I)) {
      const Value *rv = RI->getReturnValue();
      if (rv) {
        if (auto *PN = dyn_cast<PHINode>(rv)) {
          int idx = PN->getBasicBlockIndex(pred);
          if (idx >= 0)
            rv = PN->getIncomingValue(idx);
          else
            continue;
        }
        if (valueIsError(rv))
          return true;
      }
    }
  }
  return false;
}

/// Map an LLVM integer predicate to an SDG predicate kind.
static std::string predicateKindForICmp(ICmpInst::Predicate pred,
                                        bool invert) {
  switch (pred) {
  case ICmpInst::ICMP_EQ:
    return invert ? "Ne" : "Eq";
  case ICmpInst::ICMP_NE:
    return invert ? "Eq" : "Ne";
  case ICmpInst::ICMP_UGT:
  case ICmpInst::ICMP_SGT:
    return invert ? "Le" : "Gt";
  case ICmpInst::ICMP_ULT:
  case ICmpInst::ICMP_SLT:
    return invert ? "Ge" : "Lt";
  case ICmpInst::ICMP_UGE:
  case ICmpInst::ICMP_SGE:
    return invert ? "Lt" : "Ge";
  case ICmpInst::ICMP_ULE:
  case ICmpInst::ICMP_SLE:
    return invert ? "Gt" : "Le";
  default:
    return "Ne";
  }
}

/// If V is `X & (1 << b)` or `(1 << b) & X`, return (X, b).
static Optional<std::pair<const Value *, unsigned>>
extractBitAnd(const Value *V) {
  auto *BO = dyn_cast<BinaryOperator>(V);
  if (!BO || BO->getOpcode() != Instruction::And)
    return llvm::None;
  const Value *lhs = BO->getOperand(0);
  const Value *rhs = BO->getOperand(1);
  auto bitFromValue = [](const Value *C) -> Optional<unsigned> {
    if (auto *CI = dyn_cast<ConstantInt>(C)) {
      const APInt &v = CI->getValue();
      if (v.countPopulation() == 1)
        return v.countTrailingZeros();
    }
    return llvm::None;
  };
  if (auto b = bitFromValue(rhs))
    return std::make_pair(lhs, *b);
  if (auto b = bitFromValue(lhs))
    return std::make_pair(rhs, *b);
  return llvm::None;
}

struct IcmpBound {
  const ICmpInst *inst;
  uint64_t value;
  bool isLower;
  bool isUpper;
};

static Optional<IcmpBound>
extractIcmpBound(const ICmpInst *ICI, const Value *root,
                 const std::vector<const Value *> &uses) {
  for (unsigned i = 0; i < 2; ++i) {
    const Value *candidate = ICI->getOperand(i);
    const Value *otherOp = ICI->getOperand(1 - i);
    auto *CI = dyn_cast<ConstantInt>(otherOp);
    if (!CI)
      continue;
    if (candidate != root &&
        std::find(uses.begin(), uses.end(), candidate) == uses.end())
      continue;

    IcmpBound b;
    b.inst = ICI;
    b.value = static_cast<uint64_t>(CI->getZExtValue());
    b.isLower = false;
    b.isUpper = false;
    switch (ICI->getPredicate()) {
    case ICmpInst::ICMP_UGT:
    case ICmpInst::ICMP_SGT:
      b.isLower = true;
      break;
    case ICmpInst::ICMP_ULT:
    case ICmpInst::ICMP_SLT:
      b.isUpper = true;
      break;
    case ICmpInst::ICMP_UGE:
    case ICmpInst::ICMP_SGE:
      b.isLower = true;
      break;
    case ICmpInst::ICMP_ULE:
    case ICmpInst::ICMP_SLE:
      b.isUpper = true;
      break;
    default:
      break;
    }
    if (b.isLower || b.isUpper)
      return b;
  }
  return llvm::None;
}

/// Extract the best self-edge for a source following grammar Section 3.2.
static Edge extractSelfEdge(const SemanticSource &src) {
  Edge edge;
  edge.src = src.schema.id;
  edge.dst = src.schema.id;
  edge.function = src.function;
  edge.loc = src.loc;
  edge.head = heads::kBound;

  bool found = false;
  bool usedAsOffset = false;
  bool usedAsCallArg = false;

  auto uses = reachableUses(src.rootValue);
  std::vector<IcmpBound> bounds;

  for (const Value *U : uses) {
    if (auto *GEP = dyn_cast<GetElementPtrInst>(U)) {
      for (auto idxIt = GEP->idx_begin(); idxIt != GEP->idx_end(); ++idxIt)
        if (idxIt->get() == src.rootValue)
          usedAsOffset = true;
    }
    if (auto *CB = dyn_cast<CallBase>(U)) {
      for (unsigned i = 0, e = CB->arg_size(); i < e; ++i)
        if (CB->getArgOperand(i) == src.rootValue)
          usedAsCallArg = true;
    }

    // Collect ICmp bounds; Pattern 1 single comparison and InRange are both
    // resolved in a second pass.
    if (auto *ICI = dyn_cast<ICmpInst>(U)) {
      if (auto b = extractIcmpBound(ICI, src.rootValue, uses))
        bounds.push_back(*b);
    }
  }

  // Prefer an InRange pattern: a lower bound and an upper bound whose
  // results feed the same binary `and`.
  if (bounds.size() >= 2) {
    auto hasAndPartner = [](const ICmpInst *A,
                            const ICmpInst *B) -> bool {
      for (const User *UA : A->users()) {
        auto *BO = dyn_cast<BinaryOperator>(UA);
        if (!BO || BO->getOpcode() != Instruction::And)
          continue;
        for (const User *UB : B->users())
          if (UB == BO)
            return true;
      }
      return false;
    };

    for (const IcmpBound &lo : bounds) {
      if (!lo.isLower)
        continue;
      for (const IcmpBound &hi : bounds) {
        if (!hi.isUpper || lo.value > hi.value)
          continue;
        if (!hasAndPartner(lo.inst, hi.inst))
          continue;
        Predicate p{"InRange", llvm::None, llvm::None};
        p.min = lo.value;
        p.max = hi.value;
        edge.pred = p;
        found = true;
        break;
      }
      if (found)
        break;
    }
  }

  // Otherwise use the first single bound.
  if (!found && !bounds.empty()) {
    const IcmpBound &b = bounds.front();
    const BasicBlock *trueBB = nullptr;
    const BasicBlock *falseBB = nullptr;
    const BasicBlock *brBB = nullptr;
    for (const User *BU : b.inst->users()) {
      if (auto *BI = dyn_cast<BranchInst>(BU)) {
        if (!BI->isConditional())
          continue;
        trueBB = BI->getSuccessor(0);
        falseBB = BI->getSuccessor(1);
        brBB = BI->getParent();
        break;
      }
    }
    bool invert = false;
    if (trueBB && falseBB && brBB) {
      if (isErrorEdge(trueBB, brBB) && !isErrorEdge(falseBB, brBB))
        invert = true;
    }

    Predicate p{predicateKindForICmp(b.inst->getPredicate(), invert),
                llvm::None, llvm::None};
    p.value = b.value;
    edge.pred = p;
    found = true;
  }

  // Boolean helper / feature-bit call used directly as a branch condition
  // (Pattern 2 simplified).
  if (!found && src.schema.featureBit.hasValue()) {
    for (const User *U : src.rootValue->users()) {
      if (auto *BI = dyn_cast<BranchInst>(U)) {
        if (BI->getCondition() == src.rootValue) {
          bool invert = isErrorEdge(BI->getSuccessor(0), BI->getParent());
          Predicate p{invert ? "BitClear" : "BitSet", llvm::None,
                      src.schema.featureBit.getValue()};
          edge.pred = p;
          found = true;
          break;
        }
      }
    }
  }

  if (!found)
    edge.pred = Predicate{"Ne", 0, llvm::None};

  // Head selection per grammar Section 3.2.4.
  if (usedAsOffset)
    edge.head = heads::kOffset;
  else if (usedAsCallArg)
    edge.head = heads::kCall;
  else
    edge.head = heads::kBound;

  return edge;
}

/// Extract self-edges for every source.  Sources without a real boundary check
/// get a default non-zero bound so that isolated MMIO reads are still
/// represented in the edge output.
static std::map<std::string, Edge>
extractSelfEdges(const std::vector<SemanticSource> &sources) {
  std::map<std::string, Edge> out;
  for (const SemanticSource &src : sources)
    out[src.schema.id] = extractSelfEdge(src);
  return out;
}

/// For a VFG node that represents a store, the value being stored is the
/// meaningful source; for other nodes use the LLVM value directly.
static const Value *valueFlowingThroughNode(const SemanticValueFlowGraph &graph,
                                            const VFGNode *node) {
  if (const Instruction *I = graph.llvmInstruction(node)) {
    if (auto *SI = dyn_cast<StoreInst>(I))
      return SI->getValueOperand();
    if (auto *LI = dyn_cast<LoadInst>(I))
      return LI;
  }
  return graph.llvmValue(node);
}

/// Extract cross dataflow edges, including value flow through memory
/// (store/load pairs).  A small bounded BFS over the SVFG lets us connect a
/// config read stored into a struct field to the later load of that field.
static std::vector<Edge>
extractCrossDataflow(const std::vector<SemanticSource> &sources,
                     const SemanticValueFlowGraph &graph) {
  std::vector<Edge> out;
  std::map<const Value *, std::string> valueToSource;
  for (const SemanticSource &src : sources)
    if (src.rootValue)
      valueToSource[src.rootValue] = src.schema.id;

  for (const SemanticSource &dst : sources) {
    if (!dst.rootValue)
      continue;
    for (const VFGNode *root : graph.nodesForValue(dst.rootValue)) {
      std::set<NodeID> seen;
      std::queue<std::pair<const VFGNode *, unsigned>> q;
      seen.insert(root->getId());
      q.push({root, 0});

      while (!q.empty()) {
        auto [node, depth] = q.front();
        q.pop();
        if (depth >= 4)
          continue;

        const Value *V = valueFlowingThroughNode(graph, node);
        if (V) {
          auto it = valueToSource.find(V);
          if (it != valueToSource.end() && it->second != dst.schema.id) {
            Edge e;
            e.src = it->second;
            e.dst = dst.schema.id;
            e.head = heads::kDataflow;
            e.pred = Predicate{"Identity", llvm::None, llvm::None};
            e.function = dst.function;
            e.loc = dst.loc;
            out.push_back(e);
          }
        }

        SmallVector<const VFGNode *, 8> preds;
        graph.backwardNeighbours(node, preds);
        for (const VFGNode *pred : preds) {
          if (seen.insert(pred->getId()).second)
            q.push({pred, depth + 1});
        }
      }
    }
  }

  // Deduplicate by (src, dst).
  auto cmp = [](const Edge &a, const Edge &b) {
    return std::tie(a.src, a.dst, a.head) <
           std::tie(b.src, b.dst, b.head);
  };
  std::sort(out.begin(), out.end(), cmp);
  out.erase(std::unique(out.begin(), out.end(),
                        [&cmp](const Edge &a, const Edge &b) {
                          return !cmp(a, b) && !cmp(b, a);
                        }),
            out.end());
  return out;
}

static void writeJSON(const std::string &path,
                       const std::vector<SemanticSource> &nodes,
                       const std::map<std::string, Edge> &selfEdges,
                       const std::vector<Edge> &crossDataflow,
                       const std::vector<Rule> &rules) {
  json::Object root;
  root["version"] = "0.3.0-svf";

  json::Object nodesObj;
  json::Array nodeArr;
  for (const SemanticSource &n : nodes)
    nodeArr.push_back(toJSON(n));
  nodesObj["count"] = static_cast<int64_t>(nodeArr.size());
  nodesObj["nodes"] = json::Value(std::move(nodeArr));
  root["nodes"] = json::Value(std::move(nodesObj));

  // Edges come from grammar extraction (self + cross dataflow) and from
  // assembled rule preconditions (cross guards).
  json::Object edgesObj;
  json::Array selfArr, crossArr;
  for (const SemanticSource &n : nodes) {
    auto it = selfEdges.find(n.schema.id);
    if (it != selfEdges.end())
      selfArr.push_back(toJSON(it->second));
  }
  for (const Edge &e : crossDataflow)
    crossArr.push_back(toJSON(e));
  for (const Rule &r : rules) {
    for (const Edge &e : r.preconditions)
      crossArr.push_back(toJSON(e));
  }
  edgesObj["self_count"] = static_cast<int64_t>(selfArr.size());
  edgesObj["cross_count"] = static_cast<int64_t>(crossArr.size());
  edgesObj["self_edges"] = json::Value(std::move(selfArr));
  edgesObj["cross_edges"] = json::Value(std::move(crossArr));
  root["edges"] = json::Value(std::move(edgesObj));

  json::Object rulesObj;
  json::Array ruleArr;
  for (const Rule &r : rules)
    ruleArr.push_back(toJSON(r));
  rulesObj["count"] = static_cast<int64_t>(ruleArr.size());
  rulesObj["rules"] = json::Value(std::move(ruleArr));
  root["rules"] = json::Value(std::move(rulesObj));

  std::error_code ec;
  raw_fd_ostream os(path, ec, sys::fs::OF_Text);
  if (ec) {
    errs() << "SDGExtract: cannot open output " << path << ": " << ec.message()
           << "\n";
    return;
  }
  os << json::Value(std::move(root)) << "\n";
}

//===----------------------------------------------------------------------===//
// Pass
//===----------------------------------------------------------------------===//

struct SDGExtractPass : public PassInfoMixin<SDGExtractPass> {
  PreservedAnalyses run(Module &M, ModuleAnalysisManager &) {
    // SVF needs the extapi.bc path to resolve external functions.
    std::filesystem::path extapi = std::filesystem::current_path();
    if (!SDGExtAPIPath.empty()) {
      extapi = std::string(SDGExtAPIPath);
    } else {
      extapi /= ".morpheus";
      extapi /= "tools";
      extapi /= "sdg-extractor";
      extapi /= "third_party";
      extapi /= "SVF";
      extapi /= "install";
      extapi /= "lib";
      extapi /= "extapi.bc";
    }
    ExtAPI::getExtAPI()->setExtBcPath(extapi.string());

    LLVMModuleSet::buildSVFModule(M);

    SVFIRBuilder builder;
    SVFIR *pag = builder.build();

    Andersen *ander = AndersenWaveDiff::createAndersenWaveDiff(pag);
    ICFG *icfg = pag->getICFG();

    SVFGBuilder svfBuilder;
    SVFG *svfg = svfBuilder.buildFullSVFG(ander);

    SemanticValueFlowGraph svfGraph(svfg);
    SourceCatalog srcCatalog;
    SinkCatalog sinkCatalog;

    // Discover sources and sinks by scanning the module.
    std::vector<SemanticSource> sources;
    std::vector<SemanticSink> sinks;
    for (Function &F : M) {
      if (F.isDeclaration())
        continue;
      std::string funcName = F.getName().str();
      for (auto &A : F.args()) {
        auto argSrcs = srcCatalog.matchArgument(&A, funcName, A.getArgNo(),
                                                llvm::DebugLoc());
        sources.insert(sources.end(), argSrcs.begin(), argSrcs.end());
      }
      for (auto &BB : F) {
        for (auto &I : BB) {
          if (auto *CB = dyn_cast<CallBase>(&I)) {
            if (auto src = srcCatalog.matchCall(CB, funcName, I.getDebugLoc())) {
              sources.push_back(*src);
              for (const SemanticSource &extra :
                   srcCatalog.extraSourcesForCall(CB, *src))
                sources.push_back(extra);
            }
            auto matchedSinks = sinkCatalog.match(CB);
            sinks.insert(sinks.end(), matchedSinks.begin(), matchedSinks.end());
          } else if (auto *LI = dyn_cast<LoadInst>(&I)) {
            if (auto src = srcCatalog.matchLoad(LI, funcName, I.getDebugLoc()))
              sources.push_back(*src);
          }
        }
      }
    }

    // Grammar-compliant self-edge and cross dataflow extraction.
    std::map<std::string, Edge> selfEdges = extractSelfEdges(sources);
    std::vector<Edge> crossDataflow = extractCrossDataflow(sources, svfGraph);

    // Role-preserving taint analysis over SVFG.
    RoleTaintAnalysis taint(svfGraph, sources, sinkCatalog);
    // Use a very high depth bound for recall-first soundness. The BFS is still
    // bounded by the finite SVFG.
    taint.run(/*maxDepth=*/1024);

    // Control dependency: source branch conditions that gate sink calls.
    ControlDependencyAnalysis ctrl(icfg, &svfGraph, M, sinkCatalog);
    std::vector<ControlResult> ctrlResults;
    for (const SemanticSource &src : sources) {
      auto found = ctrl.analyze(src, sinkCatalog);
      ctrlResults.insert(ctrlResults.end(), found.begin(), found.end());
    }

    RuleAssembler assembler;
    auto rules = assembler.assemble(taint.result(), ctrlResults, sources,
                                    selfEdges, crossDataflow);

    // Self-check rules: when a function argument is both a source and a sink
    // (e.g. vring_mapping_error(addr) checks a DMA address), emit the rule
    // directly because SVFG taint has no CallBase to consume the argument.
    for (const SemanticSource &src : sources) {
      if (!src.rootValue || !isa<Argument>(src.rootValue))
        continue;
      auto *A = cast<Argument>(src.rootValue);
      if (sinkCatalog.isArgumentSink(src.function, A->getArgNo())) {
        Rule r;
        r.id = src.function + "-" + src.schema.id;
        r.function = src.function;
        r.vars.push_back(src);
        CallBase *dummy = nullptr;
        r.sinks.push_back(
            SemanticSink{src.function, Role::Address,
                         static_cast<unsigned>(A->getArgNo()), dummy});
        r.trigger.src = src.schema.id;
        r.trigger.dst = src.schema.id;
        r.trigger.function = src.function;
        auto selfIt = selfEdges.find(src.schema.id);
        if (selfIt != selfEdges.end()) {
          r.trigger = selfIt->second;
          r.trigger.src = src.schema.id;
          r.trigger.dst = src.schema.id;
          r.trigger.function = src.function;
        } else {
          r.trigger.head = heads::kBound;
          r.trigger.pred = Predicate{"Ne", 0, llvm::None};
        }
        r.trigger.loc = src.loc;
        r.mutation = Mutation{"SampleRange", llvm::None, llvm::None,
                               llvm::None};
        r.confidence = 0.7f;
        rules.push_back(r);
      }
    }

    // Source-level modeled sinks for relationships that are guaranteed by the
    // protocol / source code but not visible as IR dataflow in this build.
    for (const SemanticSource &src : sources) {
      if (auto modeled = srcCatalog.modeledSinkForSourceId(src.schema.id)) {
        Rule r;
        r.id = src.function + "-" + src.schema.id + "-modeled-" +
               modeled->function;
        r.function = src.function;
        r.vars.push_back(src);
        r.sinks.push_back(*modeled);
        r.trigger.src = src.schema.id;
        r.trigger.dst = src.schema.id;
        r.trigger.function = src.function;
        auto selfIt = selfEdges.find(src.schema.id);
        if (selfIt != selfEdges.end()) {
          r.trigger = selfIt->second;
          r.trigger.src = src.schema.id;
          r.trigger.dst = src.schema.id;
          r.trigger.function = src.function;
        } else {
          r.trigger.head = heads::kBound;
          r.trigger.pred = Predicate{"Ne", 0, llvm::None};
        }
        r.trigger.loc = src.loc;
        r.mutation = Mutation{"SampleRange", llvm::None, llvm::None,
                              llvm::None};
        r.confidence = 0.5f;
        rules.push_back(r);
      }
    }

    // Modeled external-API sinks: some public kernel APIs (e.g.
    // dma_map_sg_attrs, VIRTQUEUE_CALL) are not in the merged bitcode, but we
    // know the virtio helpers that call them. Emit modeled rules at those
    // call sites so that no LLM-meaningful rule is lost.
    std::vector<Rule> expanded;
    expanded.reserve(rules.size() * 2);
    for (const Rule &r : rules) {
      expanded.push_back(r);
      if (r.vars.empty())
        continue;
      const std::string &sid = r.vars.front().schema.id;
      for (const SemanticSink &sink : r.sinks) {
        for (const SemanticSink &m : sinkCatalog.modeledSinks(sink)) {
          Rule mr = r;
          mr.id = r.function + "-" + sid + "-modeled-" + m.function;
          mr.sinks = {m};
          mr.confidence = std::min(mr.confidence, 0.6f);
          expanded.push_back(mr);
        }
        // Integer sources that reach memcpy are semantically the size
        // argument (arg2), even if SVFG places them on a src/dst pointer
        // operand due to pointer arithmetic.
        if (sink.function == "memcpy") {
          bool sourceIsInteger =
              r.vars.front().rootValue &&
              r.vars.front().rootValue->getType()->isIntegerTy();
          if (sourceIsInteger) {
            Rule mr = r;
            mr.id = r.function + "-" + sid + "-modeled-memcpy-size";
            mr.sinks = {SemanticSink{"memcpy", Role::Size, 2, nullptr}};
            mr.confidence = std::min(mr.confidence, 0.55f);
            expanded.push_back(mr);
          }
        }
      }
    }

    rules = std::move(expanded);

    // Drop generic pure control edges that do not reach a real sink.
    // Feature-bit checks (BitSet/BitClear) are kept even without a sink because
    // they encode meaningful guest-visible behavior.
    rules.erase(std::remove_if(rules.begin(), rules.end(),
                               [](const Rule &r) {
                                 bool hasEmptySink = std::any_of(
                                     r.sinks.begin(), r.sinks.end(),
                                     [](const SemanticSink &s) {
                                       return s.function.empty();
                                     });
                                 if (!hasEmptySink)
                                   return false;
                                 return r.trigger.pred.kind != "BitSet" &&
                                        r.trigger.pred.kind != "BitClear";
                               }),
                rules.end());

    // Drop control-dependency rules whose only sinks are endian-conversion
    // helpers. The real security-relevant sink is usually reached through a
    // separate data-flow rule. Data-flow rules with conversion-helper sinks
    // are kept (e.g. desc_len -> cpu_to_virtio32).
    rules.erase(std::remove_if(rules.begin(), rules.end(),
                               [](const Rule &r) {
                                 if (!StringRef(r.id).endswith("-ctrl"))
                                   return false;
                                 if (r.sinks.empty())
                                   return false;
                                 return std::all_of(
                                     r.sinks.begin(), r.sinks.end(),
                                     [](const SemanticSink &s) {
                                       return
                                           s.function == "cpu_to_virtio16" ||
                                           s.function == "cpu_to_virtio32" ||
                                           s.function == "cpu_to_virtio64" ||
                                           s.function == "virtio16_to_cpu" ||
                                           s.function == "virtio32_to_cpu" ||
                                           s.function == "virtio64_to_cpu";
                                     });
                                }),
                 rules.end());

    // Deduplicate virtio_has_feature self-check rules globally by source id.
    // The same feature bit is checked in many functions; one self-check rule
    // per bit is enough for the recall-first output.
    {
      std::set<std::string> seenSelfCheck;
      rules.erase(
          std::remove_if(
              rules.begin(), rules.end(),
              [&seenSelfCheck](const Rule &r) {
                if (r.sinks.size() != 1)
                  return false;
                const SemanticSink &s = r.sinks.front();
                if (s.function != "virtio_has_feature" || s.argIndex != 1)
                  return false;
                std::string sourceId =
                    r.vars.empty() ? std::string() : r.vars.front().schema.id;
                return !seenSelfCheck.insert(sourceId).second;
              }),
          rules.end());
    }

    // Aggressive global deduplication: keep only the first occurrence of each
    // (source id, sink function, sink arg index) pair. Control-dependency rules
    // are kept per-function because the branch location matters.
    {
      std::set<std::tuple<std::string, std::string, unsigned>> seenPairs;
      rules.erase(
          std::remove_if(
              rules.begin(), rules.end(),
              [&seenPairs](const Rule &r) {
                if (StringRef(r.id).endswith("-ctrl"))
                  return false;
                if (r.vars.empty() || r.sinks.empty())
                  return false;
                const std::string &sourceId = r.vars.front().schema.id;
                bool allDup = true;
                for (const SemanticSink &s : r.sinks) {
                  auto key = std::make_tuple(sourceId, s.function, s.argIndex);
                  if (seenPairs.insert(key).second)
                    allDup = false;
                }
                return allDup;
              }),
          rules.end());
    }

    // Blocklist low-value sinks for feature-bit control-dependency rules.
    // Internal virtqueue/vring helpers and conversion routines are rarely the
    // security-relevant endpoint of a feature-bit branch.
    {
      static const char *kBlockedSubstrings[] = {
          "indirect",      "packed",        "desc_split",
          "vring_create_", "vring_map_",    "vring_mapping_error",
          "virtio16_to_cpu", "virtio32_to_cpu", "virtio64_to_cpu",
          "cpu_to_virtio"};
      rules.erase(
          std::remove_if(
              rules.begin(), rules.end(),
              [](const Rule &r) {
                if (!StringRef(r.id).endswith("-ctrl"))
                  return false;
                if (r.vars.empty())
                  return false;
                const SourceSchema &src = r.vars.front().schema;
                if (src.clazz != "Mmio" || !src.featureBit.hasValue())
                  return false;
                return std::any_of(
                    r.sinks.begin(), r.sinks.end(),
                    [](const SemanticSink &s) {
                      for (const char *sub : kBlockedSubstrings)
                        if (StringRef(s.function).contains(sub))
                          return true;
                      return false;
                    });
              }),
          rules.end());
    }

    writeJSON(SDGOutputPath, sources, selfEdges, crossDataflow, rules);

    // SVF's module set must be released before LLVM destroys the module.
    LLVMModuleSet::releaseLLVMModuleSet();
    return PreservedAnalyses::all();
  }
};

} // namespace

//===----------------------------------------------------------------------===//
// Plugin registration
//===----------------------------------------------------------------------===//

extern "C" LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "SDGExtractPass", LLVM_VERSION_STRING,
          [](PassBuilder &PB) {
            PB.registerPipelineParsingCallback(
                [](StringRef Name, ModulePassManager &MPM,
                   ArrayRef<PassBuilder::PipelineElement>) {
                  if (Name == "sdg-extract") {
                    MPM.addPass(SDGExtractPass());
                    return true;
                  }
                  return false;
                });
          }};
}
