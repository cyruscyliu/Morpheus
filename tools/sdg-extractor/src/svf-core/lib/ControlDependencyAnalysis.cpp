#include "sdg/core/ControlDependencyAnalysis.h"
#include "sdg/core/SemanticValueFlowGraph.h"
#include "Graphs/VFGNode.h"
#include "llvm/Analysis/CFG.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Operator.h"
#include <queue>
#include <set>

using namespace llvm;
using namespace SVF;
using namespace sdg::core;

ControlDependencyAnalysis::ControlDependencyAnalysis(
    SVF::ICFG *icfg, const SemanticValueFlowGraph *graph,
    const Module &M, const SinkCatalog &sinks,
    const std::map<StructFieldAliasKey, std::vector<BoolFlagAlias>>
        &boolFlagAliases)
    : icfg_(icfg), graph_(graph), boolFlagAliases_(boolFlagAliases) {
  buildFunctionSinks(M, sinks);
}

void ControlDependencyAnalysis::buildFunctionSinks(const Module &M,
                                                   const SinkCatalog &sinks) {
  // Direct sinks.
  for (const Function &F : M) {
    if (F.isDeclaration())
      continue;
    functionSinks_[&F] = findSinkInFunction(&F, sinks);
  }

  // Transitive closure: if F calls G and G has reachable sinks, those sinks
  // are also reachable from F. Repeat until fixed point.
  bool changed = true;
  while (changed) {
    changed = false;
    for (const Function &F : M) {
      if (F.isDeclaration())
        continue;
      auto &summary = functionSinks_[&F];
      std::set<std::pair<std::string, unsigned>> seen;
      for (const auto &s : summary)
        seen.insert({s.function, s.argIndex});

      for (const BasicBlock &BB : F) {
        for (const Instruction &I : BB) {
          auto *CB = dyn_cast<CallBase>(&I);
          if (!CB)
            continue;
          auto *callee = CB->getCalledFunction();
          if (!callee)
            continue;
          auto it = functionSinks_.find(callee);
          if (it == functionSinks_.end())
            continue;
          for (const SemanticSink &cs : it->second) {
            auto key = std::make_pair(cs.function, cs.argIndex);
            if (seen.insert(key).second) {
              SemanticSink modeled = cs;
              modeled.call = CB;
              summary.push_back(modeled);
              changed = true;
            }
          }
        }
      }
    }
  }
}

std::vector<SemanticSink>
ControlDependencyAnalysis::findSinkInFunction(const Function *F,
                                              const SinkCatalog &sinks) const {
  std::vector<SemanticSink> out;
  for (const BasicBlock &BB : *F) {
    for (const Instruction &I : BB) {
      if (auto *CB = dyn_cast<CallBase>(&I)) {
        auto matched = sinks.match(CB);
        out.insert(out.end(), matched.begin(), matched.end());
      }
    }
  }
  return out;
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
      APInt v = CI->getValue();
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

struct ExtractedGuard {
  Predicate pred;
  bool trueWhenSet;
  std::string sourceId;
};

static Optional<std::pair<std::string, unsigned>>
fieldKeyFromPointer(const Value *ptr) {
  auto *gep = dyn_cast<GEPOperator>(ptr);
  if (!gep || gep->getNumIndices() < 2)
    return llvm::None;
  Type *srcTy = gep->getSourceElementType();
  auto *st = dyn_cast<StructType>(srcTy);
  if (!st || !st->hasName())
    return llvm::None;
  auto *fieldIdx = dyn_cast<ConstantInt>(*(gep->idx_begin() + 1));
  if (!fieldIdx)
    return llvm::None;
  return std::make_pair(st->getName().str(),
                        static_cast<unsigned>(fieldIdx->getZExtValue()));
}

/// Extract a feature-bit predicate from a branch condition.
static Optional<StructFieldAliasKey> fieldKeyOfValue(const Value *V) {
  auto *LI = dyn_cast<LoadInst>(V);
  if (!LI)
    return llvm::None;
  return fieldKeyFromPointer(LI->getPointerOperand());
}

static Predicate flipBitPredicate(const Predicate &p) {
  Predicate out = p;
  if (out.kind == "BitSet")
    out.kind = "BitClear";
  else if (out.kind == "BitClear")
    out.kind = "BitSet";
  return out;
}

static Optional<ExtractedGuard>
extractPredicate(
    const Value *cond, const SemanticSource &src,
    const std::map<StructFieldAliasKey, std::vector<BoolFlagAlias>>
        &aliases) {
  // If this source is itself a boolean flag that aliases a feature-bit
  // predicate (e.g. vi->has_rss), use the original feature source.
  if (auto srcKey = fieldKeyOfValue(src.rootValue)) {
    auto it = aliases.find(*srcKey);
    if (it != aliases.end() && !it->second.empty()) {
      const auto &alias = it->second.front();
      Predicate baseP = alias.second;
      if (cond == src.rootValue)
        return ExtractedGuard{baseP, true, alias.first};
      if (auto *ICI = dyn_cast<ICmpInst>(cond)) {
        const Value *op0 = ICI->getOperand(0);
        const Value *op1 = ICI->getOperand(1);
        auto *zero0 = dyn_cast<ConstantInt>(op0);
        auto *zero1 = dyn_cast<ConstantInt>(op1);
        const Value *maybeVal = zero1 ? op0 : (zero0 ? op1 : nullptr);
        auto *zero = zero1 ? zero1 : zero0;
        if (maybeVal && zero && zero->isZero() &&
            (ICI->getPredicate() == ICmpInst::ICMP_NE ||
             ICI->getPredicate() == ICmpInst::ICMP_EQ)) {
          bool trueWhenNe = (ICI->getPredicate() == ICmpInst::ICMP_NE);
          // Direct operand match.
          if (maybeVal == src.rootValue) {
            Predicate p = trueWhenNe ? baseP : flipBitPredicate(baseP);
            return ExtractedGuard{p, trueWhenNe, alias.first};
          }
          // OR-of-bools match: vi->has_rss || vi->has_rss_hash_report.
          if (auto *BO = dyn_cast<BinaryOperator>(maybeVal)) {
            if (BO->getOpcode() == Instruction::Or &&
                (BO->getOperand(0) == src.rootValue ||
                 BO->getOperand(1) == src.rootValue)) {
              Predicate p = trueWhenNe ? baseP : flipBitPredicate(baseP);
              return ExtractedGuard{p, trueWhenNe, alias.first};
            }
          }
        }
      }
    }
  }

  // Direct feature call: virtio_has_feature(..., bit)
  if (cond == src.rootValue && src.schema.featureBit.hasValue()) {
    Predicate p{"BitSet", llvm::None, src.schema.featureBit.getValue()};
    return ExtractedGuard{p, true, src.schema.id};
  }

  // Inlined: (src & (1<<b)) pred 0
  if (auto *ICI = dyn_cast<ICmpInst>(cond)) {
    const Value *op0 = ICI->getOperand(0);
    const Value *op1 = ICI->getOperand(1);
    auto and0 = extractBitAnd(op0);
    auto and1 = extractBitAnd(op1);

    auto check = [&](const std::pair<const Value *, unsigned> &ab,
                     const Value *other) -> Optional<ExtractedGuard> {
      const Value *base = ab.first;
      unsigned bit = ab.second;
      // Ensure the base is data-dependent on the source.  Simple case: base is
      // the source itself.
      bool fromSource = (base == src.rootValue);
      if (!fromSource) {
        // Walk one hop through loads/stores to handle alloca locals.
        if (auto *LI = dyn_cast<LoadInst>(base)) {
          const Value *ptr = LI->getPointerOperand();
          for (const User *U : ptr->users())
            if (auto *SI = dyn_cast<StoreInst>(U))
              if (SI->getValueOperand() == src.rootValue)
                fromSource = true;
        }
      }
      if (!fromSource)
        return llvm::None;

      auto *zero = dyn_cast<ConstantInt>(other);
      if (!zero || !zero->isZero())
        return llvm::None;

      ICmpInst::Predicate pred = ICI->getPredicate();
      bool trueWhenSet = false;
      if (pred == ICmpInst::ICMP_NE)
        trueWhenSet = true;
      else if (pred == ICmpInst::ICMP_EQ)
        trueWhenSet = false;
      else
        return llvm::None;

      Predicate out{trueWhenSet ? "BitSet" : "BitClear", llvm::None, bit};
      return ExtractedGuard{out, trueWhenSet, src.schema.id};
    };

    if (and0.hasValue() && !and1.hasValue())
      if (auto eg = check(and0.getValue(), op1))
        return eg;
    if (and1.hasValue() && !and0.hasValue())
      if (auto eg = check(and1.getValue(), op0))
        return eg;

    // Boolean flag aliases: the condition may be `has_rss || has_hash_report`
    // or simply `has_rss != 0`.
    auto checkAlias = [&](const Value *maybeVal,
                          const Value *other) -> Optional<ExtractedGuard> {
      auto *zero = dyn_cast<ConstantInt>(other);
      if (!zero || !zero->isZero())
        return llvm::None;
      if (ICI->getPredicate() != ICmpInst::ICMP_NE &&
          ICI->getPredicate() != ICmpInst::ICMP_EQ)
        return llvm::None;
      bool trueWhenSet = (ICI->getPredicate() == ICmpInst::ICMP_NE);

      SmallVector<const Value *, 4> work;
      work.push_back(maybeVal);
      while (!work.empty()) {
        const Value *cur = work.pop_back_val();
        if (auto *LI = dyn_cast<LoadInst>(cur)) {
          auto key = fieldKeyFromPointer(LI->getPointerOperand());
          if (!key)
            continue;
          auto it = aliases.find(*key);
          if (it == aliases.end() || it->second.empty())
            continue;
          const auto &alias = it->second.front();
          Predicate p = alias.second;
          // Flip the predicate if the branch takes the false side.
          if (!trueWhenSet) {
            if (p.kind == "BitSet")
              p.kind = "BitClear";
            else if (p.kind == "BitClear")
              p.kind = "BitSet";
          }
          return ExtractedGuard{p, trueWhenSet, alias.first};
        }
        if (auto *BO = dyn_cast<BinaryOperator>(cur)) {
          if (BO->getOpcode() == Instruction::Or) {
            work.push_back(BO->getOperand(0));
            work.push_back(BO->getOperand(1));
          }
        }
      }
      return llvm::None;
    };

    if (auto eg = checkAlias(op0, op1))
      return eg;
    if (auto eg = checkAlias(op1, op0))
      return eg;
  }
  return llvm::None;
}

/// Find all sink calls reachable from BB.  Search within the same function up
/// to maxBlocks, and also consult precomputed function summaries when a call
/// to another function is encountered.
std::vector<SemanticSink>
ControlDependencyAnalysis::findSinkInRegion(const BasicBlock *BB,
                                            const SinkCatalog &sinks,
                                            unsigned maxBlocks) const {
  std::vector<SemanticSink> out;
  std::set<const BasicBlock *> seen;
  std::queue<std::pair<const BasicBlock *, unsigned>> q;
  q.push({BB, 0});
  seen.insert(BB);

  while (!q.empty()) {
    auto [cur, depth] = q.front();
    q.pop();

    for (const Instruction &I : *cur) {
      if (auto *CB = dyn_cast<CallBase>(&I)) {
        // Direct sinks.
        auto direct = sinks.match(CB);
        out.insert(out.end(), direct.begin(), direct.end());
        // Interprocedural summary: if the callee contains sinks, report them
        // as if they were reached through this call site.
        if (auto *callee = CB->getCalledFunction()) {
          auto it = functionSinks_.find(callee);
          if (it != functionSinks_.end()) {
            for (const SemanticSink &cs : it->second) {
              SemanticSink modeled = cs;
              modeled.call = CB;
              out.push_back(modeled);
            }
          }
        }
      }
    }

    if (depth >= maxBlocks)
      continue;
    for (const BasicBlock *succ : successors(cur)) {
      if (seen.insert(succ).second)
        q.push({succ, depth + 1});
    }
  }
  return out;
}

std::vector<ControlResult>
ControlDependencyAnalysis::analyze(const SemanticSource &src,
                                   const SinkCatalog &sinks) const {
  std::vector<ControlResult> out;
  std::set<const Value *> seen;
  std::queue<const Value *> q;
  q.push(src.rootValue);
  seen.insert(src.rootValue);

  // Seed the control-dependency search with every LLVM value that is
  // data-reachable from the source according to the SVFG. This captures
  // memory/field dependencies that a pure use-def walk would miss.
  if (graph_) {
    std::set<NodeID> nseen;
    std::queue<const VFGNode *> nq;
    for (const VFGNode *root : graph_->nodesForValue(src.rootValue)) {
      if (nseen.insert(root->getId()).second)
        nq.push(root);
    }
    while (!nq.empty()) {
      const VFGNode *node = nq.front();
      nq.pop();
      if (const Value *V = graph_->llvmValue(node))
        if (seen.insert(V).second)
          q.push(V);
      SmallVector<const VFGNode *, 8> next;
      graph_->forwardNeighbours(node, next);
      for (const VFGNode *succ : next)
        if (nseen.insert(succ->getId()).second)
          nq.push(succ);
    }
  }

  auto valueIsDerivedFromSrc = [&](const Value *V) -> bool {
    if (seen.count(V))
      return true;
    if (auto *ICI = dyn_cast<ICmpInst>(V)) {
      return seen.count(ICI->getOperand(0)) || seen.count(ICI->getOperand(1));
    }
    return false;
  };

  while (!q.empty()) {
    const Value *V = q.front();
    q.pop();

    for (const User *U : V->users()) {
      if (auto *BI = dyn_cast<BranchInst>(U)) {
        const Value *cond = BI->getCondition();
        Optional<ExtractedGuard> guard = extractPredicate(cond, src, boolFlagAliases_);

        // Fallback: if the condition (or its operands) is derived from the
        // source through conversions/calls/phis, create a generic predicate.
        if (!guard.hasValue() && valueIsDerivedFromSrc(cond)) {
          bool trueWhenNonZero = true;
          if (auto *ICI = dyn_cast<ICmpInst>(cond)) {
            if (ICI->getPredicate() == ICmpInst::ICMP_EQ)
              trueWhenNonZero = false;
          }
          Predicate p{trueWhenNonZero ? "Ne" : "Eq", llvm::None,
                      src.schema.featureBit};
          guard = ExtractedGuard{p, trueWhenNonZero, src.schema.id};
        }
        if (!guard.hasValue())
          continue;

        Predicate p = guard->pred;
        bool trueWhenSet = guard->trueWhenSet;
        const std::string &guardSourceId = guard->sourceId;

        const BasicBlock *trueSide = trueWhenSet ? BI->getSuccessor(0)
                                                 : BI->getSuccessor(1);
        const BasicBlock *falseSide = trueWhenSet ? BI->getSuccessor(1)
                                                  : BI->getSuccessor(0);
        std::string func = BI->getFunction()->getName().str();

        // Collect sinks reachable from each side. A sink is control-dependent
        // on this branch only if it is reachable from one side but not the
        // other (keyed by function + argIndex). This removes the common case
        // where a sink is reachable regardless of the branch outcome.
        std::vector<SemanticSink> trueSinks = findSinkInRegion(trueSide, sinks);
        std::vector<SemanticSink> falseSinks =
            findSinkInRegion(falseSide, sinks);

        auto sinkKey = [](const SemanticSink &s) {
          return std::make_pair(s.function, s.argIndex);
        };
        std::set<std::pair<std::string, unsigned>> trueKeys, falseKeys;
        for (const SemanticSink &s : trueSinks)
          trueKeys.insert(sinkKey(s));
        for (const SemanticSink &s : falseSinks)
          falseKeys.insert(sinkKey(s));

        bool emitted = false;
        for (const SemanticSink &s : trueSinks) {
          if (!falseKeys.count(sinkKey(s))) {
            emitted = true;
            out.push_back(
                {guardSourceId, p, s, func, BI->getDebugLoc(), src});
          }
        }
        Predicate negP = p;
        negP.kind = (p.kind == "Ne")   ? "Eq"
                    : (p.kind == "Eq") ? "Ne"
                                       : p.kind;
        for (const SemanticSink &s : falseSinks) {
          if (!trueKeys.count(sinkKey(s))) {
            emitted = true;
            out.push_back(
                {guardSourceId, negP, s, func, BI->getDebugLoc(), src});
          }
        }

        // If no sink is reachable at all, still emit a control edge so pure
        // feature-bit tests remain visible.
        if (!emitted && trueSinks.empty() && falseSinks.empty()) {
          CallBase *dummy = nullptr;
          out.push_back({guardSourceId, p,
                         SemanticSink{"", Role::Control, 0, dummy}, func,
                         BI->getDebugLoc(), src});
        }
      } else if (auto *SI = dyn_cast<SwitchInst>(U)) {
        // If the switch value is derived from the source, each case may gate
        // sinks. Emit a control rule per case/default that has reachable sinks.
        const Value *cond = SI->getCondition();
        if (!valueIsDerivedFromSrc(cond))
          continue;
        std::string func = SI->getFunction()->getName().str();
        auto sinkKey = [](const SemanticSink &s) {
          return std::make_pair(s.function, s.argIndex);
        };

        struct CaseSinks {
          Predicate pred;
          std::vector<SemanticSink> sinks;
          std::set<std::pair<std::string, unsigned>> keys;
        };
        std::vector<CaseSinks> cases;
        std::set<std::pair<std::string, unsigned>> allKeys;

        for (const auto &caseIt : SI->cases()) {
          const BasicBlock *caseBB = caseIt.getCaseSuccessor();
          int64_t caseVal = caseIt.getCaseValue()->getSExtValue();
          Predicate p{"Eq", llvm::None, llvm::None};
          p.value = caseVal;
          CaseSinks cs;
          cs.pred = p;
          cs.sinks = findSinkInRegion(caseBB, sinks);
          for (const SemanticSink &s : cs.sinks) {
            cs.keys.insert(sinkKey(s));
            allKeys.insert(sinkKey(s));
          }
          cases.push_back(std::move(cs));
        }

        Predicate defaultP{"Default", llvm::None, llvm::None};
        CaseSinks defaultCase;
        defaultCase.pred = defaultP;
        defaultCase.sinks = findSinkInRegion(SI->getDefaultDest(), sinks);
        for (const SemanticSink &s : defaultCase.sinks)
          defaultCase.keys.insert(sinkKey(s));
        for (const auto &k : defaultCase.keys)
          allKeys.insert(k);

        bool emitted = false;
        auto emitUnique = [&](const CaseSinks &cs) {
          for (const SemanticSink &s : cs.sinks) {
            // A sink is control-dependent on this case if it is not reachable
            // from any other case/default.
            if (cs.keys.count(sinkKey(s)) &&
                std::count_if(allKeys.begin(), allKeys.end(),
                              [&](const auto &k) { return k == sinkKey(s); }) == 1) {
              emitted = true;
              out.push_back(
                  {src.schema.id, cs.pred, s, func, SI->getDebugLoc(), src});
            }
          }
        };
        for (const auto &cs : cases)
          emitUnique(cs);
        emitUnique(defaultCase);

        if (!emitted && allKeys.empty()) {
          CallBase *dummy = nullptr;
          out.push_back({src.schema.id,
                         Predicate{"Switch", llvm::None, llvm::None},
                         SemanticSink{"", Role::Control, 0, dummy}, func,
                         SI->getDebugLoc(), src});
        }
      } else if (isa<BinaryOperator>(U) || isa<CastInst>(U) ||
                 isa<ICmpInst>(U) || isa<SelectInst>(U) || isa<PHINode>(U) ||
                 isa<CallBase>(U) || isa<LoadInst>(U) || isa<StoreInst>(U)) {
        if (seen.insert(U).second)
          q.push(U);
      }
    }
  }

  (void)icfg_;
  return out;
}
