#include "sdg/core/RuleAssembler.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/Dominators.h"
#include "llvm/IR/GlobalVariable.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Operator.h"
#include <algorithm>
#include <map>
#include <set>
#include <string>

using namespace llvm;
using namespace sdg::core;

/// Return true if `dom` (an instruction) dominates `target` within the same
/// function. Uses LLVM DominatorTree plus same-block instruction order.
static bool dominatesInstruction(const Instruction *dom,
                                 const Instruction *target) {
  if (!dom || !target)
    return false;
  if (dom->getFunction() != target->getFunction())
    return false;
  const Function *F = dom->getFunction();
  DominatorTree DT(const_cast<Function &>(*F));
  const BasicBlock *domBB = dom->getParent();
  const BasicBlock *targetBB = target->getParent();
  if (domBB == targetBB) {
    for (const Instruction &I : *domBB) {
      if (&I == dom)
        return true;
      if (&I == target)
        return false;
    }
    return false;
  }
  return DT.dominates(domBB, targetBB);
}

static bool isMemorySink(const SemanticSink &s) {
  static const char *kMemoryFns[] = {"memcpy",    "memmove", "memset",
                                      "kmalloc",   "kzalloc", "skb_put",
                                      "alloc_skb", "krealloc"};
  for (const char *name : kMemoryFns)
    if (s.function == name)
      return true;
  return false;
}

static bool isIndirectSink(const SemanticSink &s) {
  return s.call && !s.call->getCalledFunction();
}

static bool preconditionContradictsTrigger(const Edge &pre,
                                           const Edge &trigger) {
  if (pre.src != trigger.src)
    return false;
  if (((pre.pred.kind == "Eq" && trigger.pred.kind == "Ne") ||
       (pre.pred.kind == "Ne" && trigger.pred.kind == "Eq")) &&
      pre.pred.value.hasValue() && trigger.pred.value.hasValue() &&
      pre.pred.value.getValue() == trigger.pred.value.getValue())
    return true;
  if (((pre.pred.kind == "BitSet" && trigger.pred.kind == "BitClear") ||
       (pre.pred.kind == "BitClear" && trigger.pred.kind == "BitSet")) &&
      pre.pred.bit.hasValue() && trigger.pred.bit.hasValue() &&
      pre.pred.bit.getValue() == trigger.pred.bit.getValue())
    return true;
  return false;
}

/// Compute the byte size of the object pointed to by V when V is a GEP into an
/// array or struct field.  This lets us recover the implicit bound from
/// fixed-size array declarations.
static llvm::Optional<uint64_t>
getBufferSizeBytes(const llvm::Value *V, const llvm::DataLayout &DL) {
  if (!V)
    return llvm::None;

  if (auto *AI = dyn_cast<AllocaInst>(V))
    return DL.getTypeStoreSize(AI->getAllocatedType()).getFixedSize();

  if (auto *GV = dyn_cast<GlobalVariable>(V))
    return DL.getTypeStoreSize(GV->getValueType()).getFixedSize();

  auto *GEP = dyn_cast<GEPOperator>(V);
  if (!GEP)
    return llvm::None;
  SmallVector<Value *, 8> indices(GEP->idx_begin(), GEP->idx_end());
  Type *resultType = GetElementPtrInst::getIndexedType(
      GEP->getSourceElementType(), indices);
  if (!resultType || !resultType->isSized())
    return llvm::None;
  return DL.getTypeStoreSize(resultType).getFixedSize();
}

static bool isGenericTrigger(const Predicate &p) {
  if ((p.kind == "Gt" || p.kind == "Lt" || p.kind == "Ge" ||
       p.kind == "Le") &&
      !p.value.hasValue())
    return true;
  return false;
}

/// Determine whether a source should be used as a primary fuzzable variable in
/// a rule.  Feature bits are preconditions, not variables, and pointer-to-object
/// fields (e.g. dev, vdev) are not fuzzable data.
static bool isPrimarySource(const SemanticSource &src) {
  return src.schema.accessKind != "feature";
}

static std::string triggerKey(const Edge &e) {
  std::string s = e.head + "|" + e.pred.kind;
  if (e.pred.value.hasValue())
    s += "|" + std::to_string(e.pred.value.getValue());
  if (e.pred.bit.hasValue())
    s += "|bit" + std::to_string(e.pred.bit.getValue());
  if (e.pred.min.hasValue())
    s += "|min" + std::to_string(e.pred.min.getValue());
  if (e.pred.max.hasValue())
    s += "|max" + std::to_string(e.pred.max.getValue());
  s += "|" + std::string(sdg::core::signednessName(e.pred.signedness));
  return s;
}

/// Return true if `inst` executes on some path from its function's entry
/// block, i.e. its basic block is reachable from the entry block.
static bool reachableFromEntry(const llvm::Instruction *inst) {
  if (!inst || !inst->getFunction())
    return false;
  const Function *F = inst->getFunction();
  std::set<const BasicBlock *> seen;
  std::vector<const BasicBlock *> work = {&F->getEntryBlock()};
  while (!work.empty()) {
    const BasicBlock *BB = work.back();
    work.pop_back();
    if (BB == inst->getParent())
      return true;
    if (!seen.insert(BB).second)
      continue;
    for (const BasicBlock *succ : successors(BB))
      if (seen.insert(succ).second)
        work.push_back(succ);
  }
  return false;
}

/// Return true if `inst` executes on some path from `from` through the CFG.
static bool reachableInRegion(const BasicBlock *from, const Instruction *inst) {
  if (!from || !inst || !inst->getFunction())
    return false;
  if (from->getParent() != inst->getFunction())
    return false;
  std::set<const BasicBlock *> seen;
  std::vector<const BasicBlock *> work = {from};
  while (!work.empty()) {
    const BasicBlock *BB = work.back();
    work.pop_back();
    if (BB == inst->getParent())
      return true;
    if (!seen.insert(BB).second)
      continue;
    for (const BasicBlock *succ : successors(BB))
      if (seen.insert(succ).second)
        work.push_back(succ);
  }
  return false;
}

/// Prove that a guarded region controls `sink` through a call chain.
///
/// Same-function control requires the sink to sit in the guarded region: the
/// subgraph reachable from the block taken when the predicate holds. A branch
/// dominates calls on both successors, so dominance alone would attach a
/// guard to sinks reached through the predicate-false branch. Cross-function
/// control requires a proven chain: every call site on the chain must be
/// reachable from the guarded region (first hop) or from its function's entry
/// (later hops), and the sink must be reachable from its function's entry.
/// Call edges come from resolved direct and indirect (pointer-analysis)
/// callees; calls and sinks are never associated by name.
static bool guardControlsThroughChain(const Instruction *guard,
                                      const BasicBlock *guardedRegion,
                                      const Instruction *sink,
                                      const CallGraphInfo &callGraph) {
  if (!guard || !guardedRegion || !sink || !guard->getFunction() ||
      !sink->getFunction())
    return false;
  if (guard->getFunction() == sink->getFunction())
    return reachableInRegion(guardedRegion, sink);
  if (!reachableFromEntry(sink))
    return false;

  const Function *sinkFn = sink->getFunction();
  const Function *guardFn = guard->getFunction();
  // BFS over call edges; (function, inGuardedRegion) tracks whether calls in
  // that function still sit in the proven guarded path.
  std::set<const Function *> seen;
  std::vector<std::pair<const Function *, bool>> work;
  work.push_back({guardFn, true});
  while (!work.empty()) {
    auto [F, inGuardedRegion] = work.back();
    work.pop_back();
    if (!seen.insert(F).second)
      continue;
    auto callsIt = callGraph.calls.find(F);
    if (callsIt == callGraph.calls.end())
      continue;
    for (const CallBase *call : callsIt->second) {
      if (inGuardedRegion) {
        if (!reachableInRegion(guardedRegion, call))
          continue;
      } else if (!reachableFromEntry(call)) {
        continue;
      }
      auto calleesIt = callGraph.callees.find(call);
      if (calleesIt == callGraph.callees.end())
        continue;
      for (const Function *callee : calleesIt->second) {
        if (callee == sinkFn)
          return true;
        work.push_back({callee, false});
      }
    }
  }
  return false;
}

static llvm::Optional<Edge>
inferBufferBound(const SemanticSink &sink, const std::string &sourceId,
                 const llvm::DataLayout &DL) {
  if (sink.role != Role::Size)
    return llvm::None;

  static const std::map<std::string, unsigned> kDestArg = {
      {"memcpy", 0},
      {"memmove", 0},
      {"memset", 0},
  };
  auto it = kDestArg.find(sink.function);
  if (it == kDestArg.end() || !sink.call)
    return llvm::None;

  const llvm::Value *dest = sink.call->getArgOperand(it->second);
  auto size = getBufferSizeBytes(dest, DL);
  if (!size || size.getValue() == 0)
    return llvm::None;

  Edge e;
  e.src = sourceId;
  e.dst = sourceId;
  e.head = heads::kBound;
  e.pred = Predicate{"Gt", llvm::None, llvm::None};
  e.pred.value = size.getValue();
  e.function = sink.call->getFunction()->getName().str();
  e.loc = sink.call->getDebugLoc();
  return e;
}

std::vector<Rule>
RuleAssembler::assemble(const TaintResult &dataflow,
                        const std::vector<ControlResult> &control,
                        const std::vector<SemanticSource> &sources,
                        const SelfEdgeMap &selfEdges,
                        const CallGraphInfo &callGraph) const {
  // Attach guards only to the exact LLVM callsite they control. Matching by
  // function name and argument index conflates unrelated calls throughout the
  // module and fabricates preconditions. Interprocedural guards are kept only
  // when a call chain proves the guard dominates the path to the sink.
  std::map<const CallBase *, std::vector<const ControlResult *>> ctrlBySink;
  for (const ControlResult &cr : control) {
    if (cr.sink.call)
      ctrlBySink[cr.sink.call].push_back(&cr);
  }
  // Guards whose propagated sink reaches a rule sink through a call chain are
  // candidates for cross-function preconditions.
  std::vector<const ControlResult *> guardCandidates;
  for (const ControlResult &cr : control) {
    if (!cr.sink.call || !cr.site)
      continue;
    bool isFeatureGuard = cr.source.schema.featureBit.hasValue() ||
                          cr.source.schema.accessKind == "feature";
    bool hasConcrete = cr.pred.value.hasValue() || cr.pred.bit.hasValue();
    if (!isFeatureGuard && !hasConcrete)
      continue;
    guardCandidates.push_back(&cr);
  }

  std::map<std::string, Rule> ruleMap;

  for (const auto &kv : dataflow) {
    const std::string &sourceId = kv.first;
    for (const auto &tuple : kv.second) {
      const SemanticSink &sink = std::get<0>(tuple);
      const TaintLabel &label = std::get<1>(tuple);

      if (!isPrimarySource(*label.source))
        continue;
      // InternalState values are not physically lowerable; they may appear as
      // preconditions when the stored-source alias expansion proves a guard,
      // but they can never be the target state of a fuzzable rule.
      if (label.source->schema.clazz == "InternalState")
        continue;

      std::string functionName = sink.call->getFunction()->getName().str();

      std::vector<Edge> triggers;
      auto selfIt = selfEdges.find(sourceId);
      if (selfIt != selfEdges.end() && !selfIt->second.empty()) {
        for (const Edge &e : selfIt->second) {
          // Ne is guard-only, never a target-state mutation target.
          if (e.pred.kind != "Ne")
            triggers.push_back(e);
        }
      }
      if (triggers.empty() && (sink.role == Role::Size || sink.role == Role::Index)) {
        Edge trigger;
        trigger.src = sourceId;
        trigger.dst = sourceId;
        trigger.function = functionName;
        trigger.loc = sink.call->getDebugLoc();
        trigger.head = heads::kBound;
        trigger.pred = Predicate{"Gt", llvm::None, llvm::None};
        triggers.push_back(trigger);
      }
      if (triggers.empty())
        continue;

      for (Edge trigger : triggers) {
        trigger.src = sourceId;
        trigger.dst = sourceId;
        trigger.function = functionName;
        if (!trigger.loc)
          trigger.loc = sink.call->getDebugLoc();

        // A concrete target-state comparison is relevant to this rule only
        // when it provably controls the path to the sink call: an exact
        // callsite match means the trigger is the sink itself; otherwise
        // same-function comparisons must control it from their guarded
        // region and cross-function comparisons must control a proven call
        // chain to the sink's function. Association is never inferred from
        // matching names.
        if (trigger.site && sink.call) {
          bool associated =
              trigger.site == sink.call ||
              guardControlsThroughChain(trigger.site, trigger.guardedRegion,
                                        sink.call, callGraph);
          if (!associated)
            continue;
        }

        // Pattern 3: when a value reaches a size/index sink without an
        // explicit comparison, derive a concrete bound only from the actual
        // destination object size. Otherwise retain the unknown analysis
        // finding; it cannot be lowered into an executable rule.
        if (isGenericTrigger(trigger.pred) && sink.call) {
          const llvm::DataLayout &DL = sink.call->getModule()->getDataLayout();
          if (auto inferred = inferBufferBound(sink, sourceId, DL))
            trigger = *inferred;
        }
        if ((trigger.pred.kind == "Gt" || trigger.pred.kind == "Lt" ||
             trigger.pred.kind == "Ge" || trigger.pred.kind == "Le") &&
            !trigger.pred.value.hasValue())
          continue;

        std::string key = functionName + "|" + sourceId + "|" +
                          triggerKey(trigger);
        Rule *rp = nullptr;
        auto rmIt = ruleMap.find(key);
        if (rmIt == ruleMap.end()) {
          Rule r;
          r.id = functionName + "-" + sourceId;
          r.function = functionName;
          r.vars.push_back(*label.source);
          r.trigger = trigger;
          // The rule target-state instruction defaults to the sink call when
          // the self-edge carries no concrete site.
          if (!r.trigger.site)
            r.trigger.site = sink.call;
          ruleMap[key] = std::move(r);
          rp = &ruleMap[key];
        } else {
          rp = &rmIt->second;
        }

        bool hasSink = false;
        for (const SemanticSink &existingSink : rp->sinks) {
          // Deduplicate by exact LLVM callsite identity so two calls to the
          // same function at different sites stay distinct sinks.
          if (existingSink.call == sink.call &&
              existingSink.argIndex == sink.argIndex &&
              existingSink.function == sink.function) {
            hasSink = true;
            break;
          }
        }
        if (!hasSink)
          rp->sinks.push_back(sink);

        auto ctrlIt = ctrlBySink.find(sink.call);
        if (ctrlIt != ctrlBySink.end()) {
          for (const ControlResult *controlResult : ctrlIt->second) {
            if (controlResult->sourceId == sourceId)
              continue;
            bool isFeatureGuard =
                controlResult->source.schema.featureBit.hasValue() ||
                controlResult->pred.kind == "BitSet" ||
                controlResult->pred.kind == "BitClear";
            bool hasConcrete = controlResult->pred.value.hasValue() ||
                               controlResult->pred.bit.hasValue();
            if (!isFeatureGuard && !hasConcrete)
              continue;
            Edge pre;
            pre.src = controlResult->sourceId;
            pre.dst = sourceId;
            pre.head = heads::kGuard;
            pre.pred = controlResult->pred;
            pre.function = controlResult->function;
            pre.loc = controlResult->loc;
            pre.site = controlResult->site;
            pre.guardedRegion = controlResult->guardedRegion;
            rp->preconditions.push_back(pre);
          }
        }
      }
    }
  }

  // Guards are attached once every rule exists: a guard on a feature/state
  // source becomes a precondition when it provably controls the path to one
  // of the rule's sinks — from its guarded region directly, or through a
  // proven call chain. Guards on disjoint paths are discarded.
  for (auto &kv : ruleMap) {
    Rule &r = kv.second;
    for (const ControlResult *cr : guardCandidates) {
      if (cr->sourceId == r.trigger.src)
        continue;
      bool ok = false;
      for (const SemanticSink &sink : r.sinks) {
        if (!sink.call)
          continue;
        if (guardControlsThroughChain(cr->site, cr->guardedRegion, sink.call,
                                      callGraph)) {
          ok = true;
          break;
        }
      }
      if (!ok)
        continue;
      Edge pre;
      pre.src = cr->sourceId;
      pre.dst = r.trigger.dst;
      pre.head = heads::kGuard;
      pre.pred = cr->pred;
      pre.function = cr->function;
      pre.loc = cr->loc;
      pre.site = cr->site;
      pre.guardedRegion = cr->guardedRegion;
      r.preconditions.push_back(std::move(pre));
    }
  }

  std::vector<Rule> rules;
  for (auto &kv : ruleMap) {
    Rule &r = kv.second;

    // Filter preconditions to guards that provably control the path to one
    // of the rule's sinks: from their guarded region directly, or through a
    // proven call chain. Guards on disjoint paths are discarded.
    r.preconditions.erase(
        std::remove_if(r.preconditions.begin(), r.preconditions.end(),
                       [&](const Edge &pre) {
                         if (!pre.site)
                           return true;
                         for (const SemanticSink &sink : r.sinks) {
                           if (!sink.call)
                             continue;
                           if (guardControlsThroughChain(
                                   pre.site, pre.guardedRegion, sink.call,
                                   callGraph))
                             return false;
                         }
                         return true;
                       }),
        r.preconditions.end());

    // Deduplicate preconditions after merging. Canonical edge identity keeps
    // src, dst, head, signedness, and every predicate field.
    std::sort(r.preconditions.begin(), r.preconditions.end(),
              [](const Edge &a, const Edge &b) {
                return std::tie(a.src, a.dst, a.head, a.pred.kind,
                                a.pred.value, a.pred.bit, a.pred.min,
                                a.pred.max, a.pred.signedness) <
                       std::tie(b.src, b.dst, b.head, b.pred.kind,
                                b.pred.value, b.pred.bit, b.pred.min,
                                b.pred.max, b.pred.signedness);
              });
    r.preconditions.erase(
        std::unique(r.preconditions.begin(), r.preconditions.end(),
                    [](const Edge &a, const Edge &b) {
                      return std::tie(a.src, a.dst, a.head, a.pred.kind,
                                      a.pred.value, a.pred.bit, a.pred.min,
                                      a.pred.max, a.pred.signedness) ==
                             std::tie(b.src, b.dst, b.head, b.pred.kind,
                                      b.pred.value, b.pred.bit, b.pred.min,
                                      b.pred.max, b.pred.signedness);
                    }),
        r.preconditions.end());

    r.mutation = mutationForPredicate(r.trigger.pred, r.vars.front().schema.id);
    r.confidence = scoreRule(r);
    if (r.confidence >= 0.3f)
      rules.push_back(std::move(r));
  }

  (void)sources;
  return rules;
}

Mutation RuleAssembler::mutationForPredicate(const Predicate &p,
                                             const std::string &var) const {
  Mutation m;
  m.var = var;
  m.op = "SampleRange";
  if (p.kind == "BitSet") {
    m.op = "SetBits";
    if (p.bit.hasValue())
      m.value = 1ull << p.bit.getValue();
    m.bit = p.bit;
  } else if (p.kind == "BitClear") {
    m.op = "ClearBits";
    if (p.bit.hasValue())
      m.value = 1ull << p.bit.getValue();
    m.bit = p.bit;
  } else if (p.kind == "Eq" && p.value.hasValue()) {
    m.op = "SetValue";
    m.value = p.value.getValue();
  } else if ((p.kind == "Gt" || p.kind == "Ge") && p.value.hasValue()) {
    m.op = "SetBoundary";
    m.side = "Above";
    m.value = p.value.getValue();
  } else if ((p.kind == "Lt" || p.kind == "Le") && p.value.hasValue()) {
    m.op = "SetBoundary";
    m.side = "Below";
    m.value = p.value.getValue();
  } else if (p.kind == "InRange" && p.min.hasValue() && p.max.hasValue()) {
    m.op = "SampleRange";
    m.min = p.min;
    m.max = p.max;
  } else {
    // Fallback: tell the mutator not to touch this variable.
    m.op = "Keep";
  }
  (void)var;
  return m;
}

float RuleAssembler::scoreRule(const Rule &r) const {
  float score = 0.5f;
  bool hasConcreteConstant = false;
  bool triggerUnknown = false;

  const Predicate &tp = r.trigger.pred;
  if (tp.kind == "BitSet" || tp.kind == "BitClear") {
    hasConcreteConstant = tp.bit.hasValue();
  } else if (tp.kind == "InRange") {
    hasConcreteConstant = tp.min.hasValue() && tp.max.hasValue();
    triggerUnknown = !hasConcreteConstant;
  } else if (tp.value.hasValue()) {
    hasConcreteConstant = true;
  } else if (tp.kind == "Gt" || tp.kind == "Lt" || tp.kind == "Ge" ||
             tp.kind == "Le" || tp.kind == "Eq" || tp.kind == "Ne") {
    triggerUnknown = true;
  }

  if (hasConcreteConstant)
    score += 0.2f;
  if (triggerUnknown)
    score -= 0.3f;

  bool allFeatureBits = !r.preconditions.empty();
  for (const Edge &e : r.preconditions) {
    if (e.head != heads::kGuard ||
        (e.pred.kind != "BitSet" && e.pred.kind != "BitClear"))
      allFeatureBits = false;
  }
  if (allFeatureBits)
    score += 0.15f;

  bool hasMemorySink = false;
  bool hasIndirect = false;
  for (const SemanticSink &s : r.sinks) {
    if (isMemorySink(s))
      hasMemorySink = true;
    if (isIndirectSink(s))
      hasIndirect = true;
  }
  if (hasMemorySink)
    score += 0.15f;
  if (hasIndirect)
    score -= 0.2f;

  if (!r.vars.empty()) {
    const SourceSchema &src = r.vars.front().schema;
    if (src.clazz == "Mmio")
      score += 0.05f;
    if (src.clazz == "Dma" && !src.field.empty())
      score += 0.05f;
  }

  for (const Edge &pre : r.preconditions) {
    if (preconditionContradictsTrigger(pre, r.trigger)) {
      score -= 0.5f;
      break;
    }
  }

  return std::max(0.0f, std::min(1.0f, score));
}
