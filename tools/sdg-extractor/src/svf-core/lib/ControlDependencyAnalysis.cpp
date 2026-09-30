#include "sdg/core/ControlDependencyAnalysis.h"
#include "sdg/core/SemanticValueFlowGraph.h"
#include "Graphs/VFGNode.h"
#include "llvm/Analysis/CFG.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/DataLayout.h"
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
    const Module &M, const SinkCatalog &sinks)
    : icfg_(icfg), graph_(graph) {
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
              SemanticSink propagated = cs;
              propagated.call = CB;
              summary.push_back(propagated);
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

static Predicate invertPredicate(const Predicate &predicate) {
  Predicate inverted = predicate;
  if (predicate.kind == "Eq") inverted.kind = "Ne";
  else if (predicate.kind == "Ne") inverted.kind = "Eq";
  else if (predicate.kind == "Lt") inverted.kind = "Ge";
  else if (predicate.kind == "Le") inverted.kind = "Gt";
  else if (predicate.kind == "Gt") inverted.kind = "Le";
  else if (predicate.kind == "Ge") inverted.kind = "Lt";
  else if (predicate.kind == "BitSet") inverted.kind = "BitClear";
  else if (predicate.kind == "BitClear") inverted.kind = "BitSet";
  return inverted;
}

static Optional<ExtractedGuard>
extractPredicate(const Value *cond, const SemanticSource &src);

static const Value *skipCasts(const Value *V) {
  while (V) {
    if (auto *CE = dyn_cast<ConstantExpr>(V))
      V = CE->getOperand(0);
    else if (auto *I = dyn_cast<CastInst>(V))
      V = I->getOperand(0);
    else
      break;
  }
  return V;
}

static Optional<std::pair<const Value *, int64_t>>
constantPointerLocation(const Value *value, const DataLayout &layout) {
  int64_t total = 0;
  const Value *current = value;
  while (current) {
    if (auto *gep = dyn_cast<GEPOperator>(current)) {
      if (!gep->hasAllConstantIndices())
        return llvm::None;
      APInt offset(64, 0);
      if (!gep->accumulateConstantOffset(layout, offset) ||
          offset.getSignificantBits() > 63)
        return llvm::None;
      total += offset.getSExtValue();
      current = gep->getPointerOperand()->stripPointerCasts();
      continue;
    }
    if (auto *cast = dyn_cast<CastInst>(current)) {
      current = cast->getOperand(0);
      continue;
    }
    return std::make_pair(current, total);
  }
  return llvm::None;
}

/// Whether every path from the function entry to `toBlock` includes the edge
/// `fromBlock -> toBlock`. A bypass means executions can reach the block
/// without the guard condition holding, so any predicate derived from a
/// constant stored there is unsound. This is CFG evidence only.
static bool edgeDominatesBlock(const BasicBlock *fromBlock,
                               const BasicBlock *toBlock,
                               const Function *function) {
  if (!fromBlock || !toBlock || !function ||
      fromBlock->getParent() != function || toBlock->getParent() != function)
    return false;
  std::set<const BasicBlock *> seen = {&function->getEntryBlock()};
  std::vector<const BasicBlock *> work = {&function->getEntryBlock()};
  while (!work.empty()) {
    const BasicBlock *BB = work.back();
    work.pop_back();
    for (const BasicBlock *succ : successors(BB)) {
      if (BB == fromBlock && succ == toBlock)
        continue;
      if (succ == toBlock)
        return false;
      if (seen.insert(succ).second)
        work.push_back(succ);
    }
  }
  return true;
}

static Optional<ExtractedGuard>
extractPredicate(const Value *cond, const SemanticSource &src) {
  // Direct feature call: virtio_has_feature(..., bit)
  if (cond == src.rootValue && src.schema.nodeLocalBit.hasValue()) {
    Predicate p{"BitSet", llvm::None, src.schema.nodeLocalBit.getValue()};
    return ExtractedGuard{p, true, src.schema.id};
  }

  // Handle `select guard, inner_cmp, false` / `select guard, true, inner_cmp`
  // patterns created when the optimizer merges a guard with an inner check.
  if (auto *SI = dyn_cast<SelectInst>(cond)) {
    const Value *trueVal = skipCasts(SI->getTrueValue());
    const Value *falseVal = skipCasts(SI->getFalseValue());
    auto *trueCI = dyn_cast<ICmpInst>(trueVal);
    auto *falseCI = dyn_cast<ICmpInst>(falseVal);
    const Value *guardCond = SI->getCondition();
    // select guard, cmp, false  -> sink reachable only when guard AND cmp true.
    if (trueCI && isa<ConstantInt>(falseVal) &&
        cast<ConstantInt>(falseVal)->isZero()) {
      if (auto inner = extractPredicate(trueCI, src))
        return inner;
      return extractPredicate(guardCond, src);
    }
    // select guard, true, cmp   -> sink reachable when guard AND cmp false.
    if (falseCI && isa<ConstantInt>(trueVal) &&
        cast<ConstantInt>(trueVal)->isOne()) {
      if (auto inner = extractPredicate(falseCI, src)) {
        ExtractedGuard eg = *inner;
        eg.pred = invertPredicate(eg.pred);
        return eg;
      }
      return extractPredicate(guardCond, src);
    }
  }

  // Inlined: (src & (1<<b)) pred 0, or direct src pred 0 for feature calls.
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

    // Direct src == 0 / src != 0 for feature-call results.
    if (src.schema.nodeLocalBit.hasValue()) {
      auto directCheck = [&](const Value *candidate,
                             const Value *other) -> Optional<ExtractedGuard> {
        if (candidate != src.rootValue)
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
        Predicate out{trueWhenSet ? "BitSet" : "BitClear", llvm::None,
                      src.schema.nodeLocalBit.getValue()};
        return ExtractedGuard{out, trueWhenSet, src.schema.id};
      };
      if (auto eg = directCheck(op0, op1))
        return eg;
      if (auto eg = directCheck(op1, op0))
        return eg;
    }

    if (and0.hasValue() && !and1.hasValue())
      if (auto eg = check(and0.getValue(), op1))
        return eg;
    if (and1.hasValue() && !and0.hasValue())
      if (auto eg = check(and1.getValue(), op0))
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
              SemanticSink propagated = cs;
              propagated.call = CB;
              out.push_back(propagated);
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

  auto emitStoredBooleanGuards = [&](const BranchInst *featureBranch,
                                     const Predicate &featurePredicate) {
    if (!src.schema.nodeLocalBit.hasValue())
      return;
    const Function *function = featureBranch->getFunction();
    const DataLayout &layout = function->getParent()->getDataLayout();

    for (unsigned successorIndex = 0; successorIndex < 2; ++successorIndex) {
      const BasicBlock *storeBlock = featureBranch->getSuccessor(successorIndex);
      // A constant stored in a branch successor only proves the guarded
      // predicate when that edge dominates the block. A short-circuit or
      // else-if join can be reached with the bit clear, so its stores derive
      // nothing.
      if (!edgeDominatesBlock(featureBranch->getParent(), storeBlock,
                              function))
        continue;
      Predicate storedPredicate = successorIndex == 0
                                      ? featurePredicate
                                      : invertPredicate(featurePredicate);
      for (const Instruction &instruction : *storeBlock) {
        auto *store = dyn_cast<StoreInst>(&instruction);
        if (!store)
          continue;
        auto *constant = dyn_cast<ConstantInt>(store->getValueOperand());
        if (!constant || constant->isZero())
          continue;
        auto storedAt =
            constantPointerLocation(store->getPointerOperand(), layout);
        if (!storedAt)
          continue;

        for (const BasicBlock &block : *function) {
          for (const Instruction &candidate : block) {
            auto *load = dyn_cast<LoadInst>(&candidate);
            if (!load)
              continue;
            auto loadedAt =
                constantPointerLocation(load->getPointerOperand(), layout);
            if (!loadedAt || loadedAt.getValue() != storedAt.getValue())
              continue;

            std::queue<std::pair<const Value *, bool>> stateWork;
            std::set<std::pair<const Value *, bool>> stateSeen;
            stateWork.push({load, true});
            stateSeen.insert({load, true});
            while (!stateWork.empty()) {
              auto [stateValue, trueWhenFeature] = stateWork.front();
              stateWork.pop();
              for (const User *user : stateValue->users()) {
                if (auto *branch = dyn_cast<BranchInst>(user)) {
                  if (!branch->isConditional() ||
                      branch->getCondition() != stateValue)
                    continue;
                  const BasicBlock *guarded = branch->getSuccessor(
                      trueWhenFeature ? 0 : 1);
                  auto guardedSinks = findSinkInRegion(guarded, sinks);
                  for (const SemanticSink &sink : guardedSinks) {
                    // The stored constant is the proof here, not region
                    // membership: a short-circuit join can also flow into
                    // the guarded block from the opposite successor, so no
                    // false-side exclusion applies.
                    out.push_back({src.schema.id, storedPredicate, sink,
                                   branch->getFunction()->getName().str(),
                                   branch->getDebugLoc(), branch, guarded,
                                   nullptr, src});
                  }
                  continue;
                }

                bool nextPolarity = trueWhenFeature;
                bool transparent = isa<CastInst>(user);
                if (auto *comparison = dyn_cast<ICmpInst>(user)) {
                  const Value *other = comparison->getOperand(0) == stateValue
                                           ? comparison->getOperand(1)
                                           : comparison->getOperand(0);
                  auto *zero = dyn_cast<ConstantInt>(other);
                  if (!zero || !zero->isZero())
                    continue;
                  if (comparison->getPredicate() == ICmpInst::ICMP_EQ)
                    nextPolarity = !trueWhenFeature;
                  else if (comparison->getPredicate() != ICmpInst::ICMP_NE)
                    continue;
                  transparent = true;
                } else if (auto *binary = dyn_cast<BinaryOperator>(user)) {
                  if (binary->getOpcode() == Instruction::Or &&
                      trueWhenFeature)
                    transparent = true;
                  else if (binary->getOpcode() == Instruction::And &&
                           !trueWhenFeature)
                    transparent = true;
                }
                if (transparent &&
                    stateSeen.insert({cast<Value>(user), nextPolarity}).second)
                  stateWork.push({cast<Value>(user), nextPolarity});
              }
            }
          }
        }
      }
    }
  };

  while (!q.empty()) {
    const Value *V = q.front();
    q.pop();

    for (const User *U : V->users()) {
      if (auto *BI = dyn_cast<BranchInst>(U)) {
        const Value *cond = BI->getCondition();
        Optional<ExtractedGuard> guard = extractPredicate(cond, src);

        if (!guard.hasValue())
          continue;

        Predicate p = guard->pred;
        const std::string &guardSourceId = guard->sourceId;

        // The extracted predicate describes the source state under which the
        // branch condition is TRUE: cond true <=> pred holds. Therefore the
        // predicate-holds side is always successor(0) and the predicate-fails
        // side is successor(1), independent of the predicate kind.
        const BasicBlock *predSide = BI->getSuccessor(0);
        const BasicBlock *predFailsSide = BI->getSuccessor(1);
        std::string func = BI->getFunction()->getName().str();

        bool directFeatureBranch = cond == src.rootValue;
        if (auto *comparison = dyn_cast<ICmpInst>(cond))
          directFeatureBranch =
              skipCasts(comparison->getOperand(0)) == src.rootValue ||
              skipCasts(comparison->getOperand(1)) == src.rootValue;
        if (directFeatureBranch)
          emitStoredBooleanGuards(BI, p);

        // Collect sinks reachable from each side. A sink is control-dependent
        // on this branch only if it is reachable from one side but not the
        // other, keyed by exact LLVM callsite identity so two calls to the
        // same function in opposite branches stay distinct.
        std::vector<SemanticSink> trueSinks = findSinkInRegion(predSide, sinks);
        std::vector<SemanticSink> falseSinks =
            findSinkInRegion(predFailsSide, sinks);

        auto sinkKey = [](const SemanticSink &s) {
          return std::make_pair(s.call, s.argIndex);
        };
        std::set<std::pair<const CallBase *, unsigned>> trueKeys, falseKeys;
        for (const SemanticSink &s : trueSinks)
          trueKeys.insert(sinkKey(s));
        for (const SemanticSink &s : falseSinks)
          falseKeys.insert(sinkKey(s));

        bool emitted = false;
        for (const SemanticSink &s : trueSinks) {
          if (!falseKeys.count(sinkKey(s))) {
            emitted = true;
            out.push_back({guardSourceId, p, s, func, BI->getDebugLoc(), BI,
                           predSide, predFailsSide, src});
          }
        }
        Predicate negP = invertPredicate(p);
        for (const SemanticSink &s : falseSinks) {
          if (!trueKeys.count(sinkKey(s))) {
            emitted = true;
            out.push_back({guardSourceId, negP, s, func, BI->getDebugLoc(), BI,
                           predFailsSide, predSide, src});
          }
        }

        // If no sink is reachable at all, still emit a control edge so pure
        // feature-bit tests remain visible.
        if (!emitted && trueSinks.empty() && falseSinks.empty()) {
          CallBase *dummy = nullptr;
          out.push_back({guardSourceId, p,
                         SemanticSink{"", Role::Control, 0, llvm::None, dummy}, func,
                         BI->getDebugLoc(), BI, predSide, predFailsSide, src});
        }
      } else if (auto *SI = dyn_cast<SwitchInst>(U)) {
        // If the switch value is derived from the source, each case may gate
        // sinks. Emit a control rule per case/default that has reachable sinks.
        const Value *cond = SI->getCondition();
        if (!valueIsDerivedFromSrc(cond))
          continue;
        std::string func = SI->getFunction()->getName().str();
        auto sinkKey = [](const SemanticSink &s) {
          return std::make_pair(s.call, s.argIndex);
        };

        struct CaseSinks {
          Predicate pred;
          std::vector<SemanticSink> sinks;
          const BasicBlock *guardedRegion = nullptr;
          std::set<std::pair<const CallBase *, unsigned>> keys;
        };
        std::vector<CaseSinks> cases;
        std::map<std::pair<const CallBase *, unsigned>, unsigned> keyCounts;

        for (const auto &caseIt : SI->cases()) {
          const BasicBlock *caseBB = caseIt.getCaseSuccessor();
          int64_t caseVal = caseIt.getCaseValue()->getSExtValue();
          Predicate p{"Eq", llvm::None, llvm::None};
          p.value = caseVal;
          CaseSinks cs;
          cs.pred = p;
          cs.guardedRegion = caseBB;
          cs.sinks = findSinkInRegion(caseBB, sinks);
          for (const SemanticSink &s : cs.sinks) {
            cs.keys.insert(sinkKey(s));
          }
          for (const auto &key : cs.keys)
            ++keyCounts[key];
          cases.push_back(std::move(cs));
        }

        Predicate defaultP{"Default", llvm::None, llvm::None};
        CaseSinks defaultCase;
        defaultCase.pred = defaultP;
        defaultCase.guardedRegion = SI->getDefaultDest();
        defaultCase.sinks = findSinkInRegion(SI->getDefaultDest(), sinks);
        for (const SemanticSink &s : defaultCase.sinks)
          defaultCase.keys.insert(sinkKey(s));
        for (const auto &k : defaultCase.keys)
          ++keyCounts[k];

        bool emitted = false;
        auto emitUnique = [&](const CaseSinks &cs) {
          for (const SemanticSink &s : cs.sinks) {
            // A sink is control-dependent on this case if it is not reachable
            // from any other case/default.
            if (keyCounts[sinkKey(s)] == 1) {
              emitted = true;
              out.push_back({src.schema.id, cs.pred, s, func,
                             SI->getDebugLoc(), SI, cs.guardedRegion, nullptr,
                             src});
            }
          }
        };
        for (const auto &cs : cases)
          emitUnique(cs);
        emitUnique(defaultCase);

        if (!emitted && keyCounts.empty()) {
          CallBase *dummy = nullptr;
          out.push_back({src.schema.id,
                         Predicate{"Switch", llvm::None, llvm::None},
                         SemanticSink{"", Role::Control, 0, llvm::None, dummy}, func,
                         SI->getDebugLoc(), SI, SI->getDefaultDest(), nullptr,
                         src});
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
