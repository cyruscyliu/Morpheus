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

  // Prefer the remaining capacity of the innermost constant-indexed array.
  // This recovers fixed destination storage such as `u8 key[40]` even when
  // the GEP decays it to i8*. It is source-layout evidence, not a name-based
  // bound.
  Type *current = GEP->getSourceElementType();
  bool firstIndex = true;
  llvm::Optional<uint64_t> arrayCapacity;
  llvm::Optional<uint64_t> overlayArrayCapacity;
  bool reachedFlexibleArray = false;
  for (const Use &indexUse : GEP->indices()) {
    auto *index = dyn_cast<ConstantInt>(indexUse.get());
    if (!index)
      break;
    if (firstIndex) {
      firstIndex = false;
      continue;
    }
    if (auto *structure = dyn_cast<StructType>(current)) {
      for (Type *elementType : structure->elements()) {
        if (auto *backingArray = dyn_cast<ArrayType>(elementType)) {
          uint64_t bytes =
              DL.getTypeAllocSize(backingArray).getFixedSize();
          if (bytes > 0 &&
              (!overlayArrayCapacity.hasValue() ||
               bytes > overlayArrayCapacity.getValue()))
            overlayArrayCapacity = bytes;
        }
      }
      uint64_t field = index->getZExtValue();
      if (field >= structure->getNumElements())
        break;
      current = structure->getElementType(field);
      continue;
    }
    if (auto *array = dyn_cast<ArrayType>(current)) {
      uint64_t element = index->getZExtValue();
      if (array->getNumElements() == 0 && element == 0) {
        reachedFlexibleArray = true;
        current = array->getElementType();
        continue;
      }
      if (element >= array->getNumElements())
        break;
      uint64_t elementBytes =
          DL.getTypeAllocSize(array->getElementType()).getFixedSize();
      arrayCapacity = (array->getNumElements() - element) * elementBytes;
      current = array->getElementType();
      continue;
    }
    break;
  }
  if (arrayCapacity.hasValue() && arrayCapacity.getValue() > 0)
    return arrayCapacity;
  if (reachedFlexibleArray && overlayArrayCapacity.hasValue())
    return overlayArrayCapacity;

  // A zero-length/flexible array may be overlaid with trailing storage in
  // the containing object. In that case the usable capacity is the constant
  // remainder from the GEP to the end of the source aggregate.
  APInt aggregateOffset(64, 0);
  if (GEP->hasAllConstantIndices() &&
      GEP->accumulateConstantOffset(DL, aggregateOffset) &&
      aggregateOffset.isNonNegative() &&
      GEP->getSourceElementType()->isSized()) {
    uint64_t total =
        DL.getTypeAllocSize(GEP->getSourceElementType()).getFixedSize();
    uint64_t offset = aggregateOffset.getZExtValue();
    if (offset < total)
      return total - offset;
  }

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

static bool directlyReachesSink(const Value *root,
                                const SemanticSink &sink,
                                const CallGraphInfo &callGraph,
                                ProvenArgumentPassing *provenPassing) {
  if (!root || !sink.call || sink.argIndex >= sink.call->arg_size())
    return false;
  const Value *target = sink.call->getArgOperand(sink.argIndex);
  const Function *sinkFunction = sink.call->getFunction();

  auto functionOf = [](const Value *value) -> const Function * {
    if (const auto *argument = dyn_cast<Argument>(value))
      return argument->getParent();
    if (const auto *instruction = dyn_cast<Instruction>(value))
      return instruction->getFunction();
    return nullptr;
  };

  using Node = std::pair<const Value *, const Function *>;

  // Exact forward value flow: transparent operations, actual-to-formal
  // argument passing, and return-value continuation, all through resolved
  // call edges (direct plus pointer-analysis indirect callees). Memory hops
  // are deliberately excluded: SVFG address propagation merges unrelated
  // sizes across functions, so a proof that requires a store/load hop is
  // unproven here.
  auto successorsOf = [&](const Node &node, std::vector<Node> &out) {
    const Value *value = node.first;
    const Function *function = node.second;
    for (const User *user : value->users()) {
      if (isa<CastInst>(user) || isa<PHINode>(user) ||
          isa<SelectInst>(user) || isa<UnaryOperator>(user) ||
          isa<BinaryOperator>(user)) {
        out.push_back({cast<Value>(user), functionOf(user)});
        continue;
      }
      // Actual-to-formal argument passing through resolved call edges.
      if (const CallBase *call = dyn_cast<CallBase>(user)) {
        auto calleeIt = callGraph.callees.find(call);
        if (calleeIt == callGraph.callees.end())
          continue;
        for (const Function *callee : calleeIt->second) {
          if (!callee || callee->isDeclaration())
            continue;
          for (unsigned i = 0, e = call->arg_size(); i < e; ++i) {
            if (call->getArgOperand(i) != value)
              continue;
            if (i < callee->arg_size())
              out.push_back({callee->getArg(i), callee});
          }
        }
        continue;
      }
      // Return-value continuation: the value is returned from `function`,
      // so every resolved caller's call result continues the chain.
      if (isa<ReturnInst>(user)) {
        if (!function)
          continue;
        auto callerIt = callGraph.callersOf.find(function);
        if (callerIt == callGraph.callersOf.end())
          continue;
        for (const CallBase *caller : callerIt->second) {
          if (caller->getType()->isVoidTy())
            continue;
          out.push_back({caller, caller->getFunction()});
        }
      }
    }
  };

  // Backward in-edges of a node, the exact inverse of the kinds above.
  auto predecessorsOf = [&](const Node &node, std::vector<Node> &out) {
    const Value *value = node.first;
    const Function *function = node.second;
    if (const auto *argument = dyn_cast<Argument>(value)) {
      unsigned index = argument->getArgNo();
      auto callerIt = callGraph.callersOf.find(function);
      if (callerIt == callGraph.callersOf.end())
        return;
      for (const CallBase *caller : callerIt->second) {
        if (index >= caller->arg_size())
          continue;
        const Value *actual = caller->getArgOperand(index);
        out.push_back({actual, functionOf(actual)});
      }
      return;
    }
    if (const auto *callValue = dyn_cast<CallBase>(value)) {
      if (callValue->getType()->isVoidTy())
        return;
      auto calleeIt = callGraph.callees.find(callValue);
      if (calleeIt == callGraph.callees.end())
        return;
      for (const Function *callee : calleeIt->second) {
        if (!callee || callee->isDeclaration())
          continue;
        for (const BasicBlock &BB : *callee) {
          for (const Instruction &I : BB) {
            auto *ret = dyn_cast<ReturnInst>(&I);
            if (!ret || !ret->getReturnValue())
              continue;
            out.push_back({ret->getReturnValue(), callee});
          }
        }
      }
      return;
    }
    // A transparent operation receives flow from its operands.
    if (isa<CastInst>(value) || isa<PHINode>(value) || isa<SelectInst>(value) ||
        isa<UnaryOperator>(value) || isa<BinaryOperator>(value))
      for (const Use &operandUse : cast<User>(value)->operands())
        out.push_back({operandUse.get(), functionOf(operandUse.get())});
  };

  // Provenance must consist of complete successful root-to-exact-sink paths
  // only, so the reachability runs in two passes. The forward pass collects
  // the nodes the root reaches; the backward pass collects the nodes that
  // reach the exact sink argument. An argument-passing step is proven only
  // when both of its endpoints are live in both passes, which keeps
  // explored-but-dead callers out of the capacity provenance.
  std::set<Node> forwardLive;
  std::vector<Node> work = {{root, functionOf(root)}};
  while (!work.empty()) {
    Node node = work.back();
    work.pop_back();
    if (!forwardLive.insert(node).second)
      continue;
    if (node.first == target && node.second == sinkFunction)
      continue;
    std::vector<Node> succs;
    successorsOf(node, succs);
    for (const Node &succ : succs)
      if (!forwardLive.count(succ))
        work.push_back(succ);
  }
  if (!forwardLive.count({target, sinkFunction}))
    return false;

  std::set<Node> backwardLive;
  work = {{target, sinkFunction}};
  while (!work.empty()) {
    Node node = work.back();
    work.pop_back();
    if (!backwardLive.insert(node).second)
      continue;
    std::vector<Node> preds;
    predecessorsOf(node, preds);
    for (const Node &pred : preds)
      if (!backwardLive.count(pred))
        work.push_back(pred);
  }

  if (provenPassing) {
    std::set<std::pair<const CallBase *, const Function *>> seen;
    for (const Node &node : backwardLive) {
      const auto *argument = dyn_cast<Argument>(node.first);
      if (!argument || node.second != argument->getParent())
        continue;
      auto callerIt = callGraph.callersOf.find(node.second);
      if (callerIt == callGraph.callersOf.end())
        continue;
      unsigned index = argument->getArgNo();
      for (const CallBase *caller : callerIt->second) {
        if (index >= caller->arg_size())
          continue;
        const Value *actual = caller->getArgOperand(index);
        Node actualNode = {actual, functionOf(actual)};
        if (!forwardLive.count(actualNode) || !backwardLive.count(actualNode))
          continue;
        if (seen.insert({caller, node.second}).second)
          provenPassing->push_back({caller, node.second});
      }
    }
  }
  return true;
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

/// Return true if `inst` executes on some path from `from` through the CFG.
static bool reachableInRegion(const BasicBlock *from, const Instruction *inst) {
  if (!from || !inst || !inst->getFunction())
    return false;
  if (from->getParent() != inst->getFunction())
    return false;
  std::set<const BasicBlock *> seen = {from};
  std::vector<const BasicBlock *> work = {from};
  while (!work.empty()) {
    const BasicBlock *BB = work.back();
    work.pop_back();
    if (BB == inst->getParent())
      return true;
    for (const BasicBlock *succ : successors(BB))
      if (seen.insert(succ).second)
        work.push_back(succ);
  }
  return false;
}

/// Prove that a guard's proven region controls every tainted execution of
/// `sink`.
///
/// Same-function control requires the sink callsite to sit in the proven
/// region: reachable from the block taken when the predicate holds and not
/// reachable from the opposite side. Sinks after the guard's join are
/// reachable from both sides and are excluded.
///
/// Cross-function control replays the rule's proven value-flow record: every
/// callsite through which the proven flow entered the sink's function — and,
/// transitively, every callsite that fed that entry — must sit in the proven
/// region. A function-level descent from one controlled callsite would also
/// attach guards whose control never covers the sink call's own executions.
/// Calls and sinks are never associated by name.
static bool guardControlsThroughChain(
    const Instruction *guard, const BasicBlock *guardedRegion,
    const BasicBlock *falseRegion, const llvm::CallBase *sink,
    const ProvenArgumentPassing &provenFlow, const CallGraphInfo &callGraph) {
  if (!guard || !guardedRegion || !sink || !guard->getFunction() ||
      !sink->getFunction())
    return false;
  const Function *guardFn = guard->getFunction();
  auto inProvenRegion = [&](const CallBase *call) -> bool {
    return reachableInRegion(guardedRegion, call) &&
           (!falseRegion || !reachableInRegion(falseRegion, call));
  };
  if (guardFn == sink->getFunction())
    return inProvenRegion(sink);

  std::map<const Function *, std::set<const CallBase *>> flowEntries;
  for (const auto &step : provenFlow)
    if (step.first && step.second)
      flowEntries[step.second].insert(step.first);

  // A direct proof (the sink argument is the tracked source value itself)
  // leaves no argument-passing record, so every execution of the sink call
  // is tainted and every caller chain must be anchored in the proven
  // region.
  auto entriesIt = flowEntries.find(sink->getFunction());
  const bool directFlow = entriesIt == flowEntries.end() ||
                          entriesIt->second.empty();
  std::set<const Function *> seen;
  std::vector<const Function *> work = {sink->getFunction()};
  while (!work.empty()) {
    const Function *F = work.back();
    work.pop_back();
    if (!seen.insert(F).second)
      continue;
    if (directFlow) {
      auto callerIt = callGraph.callersOf.find(F);
      if (callerIt == callGraph.callersOf.end())
        return false; // entered from outside the resolved call graph
      for (const CallBase *caller : callerIt->second) {
        if (caller->getFunction() == guardFn) {
          if (!inProvenRegion(caller))
            return false;
          continue;
        }
        work.push_back(caller->getFunction());
      }
      continue;
    }
    auto it = flowEntries.find(F);
    if (it == flowEntries.end())
      return false; // the proven flow originates here, unguarded
    for (const CallBase *entry : it->second) {
      if (entry->getFunction() == guardFn) {
        if (!inProvenRegion(entry))
          return false;
        continue;
      }
      work.push_back(entry->getFunction());
    }
  }
  return true;
}

/// Static capacity of the destination buffer behind `dest`. A formal
/// parameter carries no layout of its own, so its object provenance is
/// resolved along the proven actual-to-formal argument-passing path only:
/// the caller callsites an exact value-flow proof traversed are the callers
/// whose actual arguments feed this sink call. When several proven callers
/// pass different buffers, the minimum capacity is the sound bound for the
/// sink call. This is interprocedural evidence, not a name-based bound.
static llvm::Optional<uint64_t>
resolveDestCapacity(const llvm::Value *dest, const llvm::DataLayout &DL,
                    const ProvenArgumentPassing &provenPassing,
                    unsigned depth = 4) {
  if (!dest || depth == 0)
    return llvm::None;
  const llvm::Value *current = dest->stripPointerCasts();
  if (auto size = getBufferSizeBytes(current, DL))
    return size;
  const auto *argument = dyn_cast<Argument>(current);
  if (!argument)
    return llvm::None;
  const llvm::Function *parent = argument->getParent();
  if (!parent)
    return llvm::None;
  unsigned index = argument->getArgNo();
  llvm::Optional<uint64_t> best;
  for (const auto &step : provenPassing) {
    if (step.second != parent || index >= step.first->arg_size())
      continue;
    auto candidate = resolveDestCapacity(step.first->getArgOperand(index), DL,
                                         provenPassing, depth - 1);
    if (candidate &&
        (!best.hasValue() || candidate.getValue() < best.getValue()))
      best = candidate;
  }
  return best;
}

static llvm::Optional<Edge>
inferBufferBound(const SemanticSink &sink, const std::string &sourceId,
                 const llvm::DataLayout &DL,
                 const ProvenArgumentPassing &provenPassing) {
  if (sink.role != Role::Size)
    return llvm::None;

  // The destination-buffer contract lives in the sink catalog, not in a
  // name-keyed table here: sink.destArg is the operand whose static
  // capacity bounds the size operand.
  if (!sink.call || !sink.destArg.hasValue() ||
      sink.destArg.getValue() >= sink.call->arg_size())
    return llvm::None;

  const llvm::Value *dest = sink.call->getArgOperand(sink.destArg.getValue());
  auto size = resolveDestCapacity(dest, DL, provenPassing);
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
                        const std::vector<Edge> &crossDataflow,
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

  std::map<std::string, const SemanticSource *> sourcesById;
  for (const SemanticSource &source : sources)
    sourcesById[source.schema.id] = &source;
  std::map<std::string, std::set<std::string>> incomingDataflow;
  for (const Edge &edge : crossDataflow)
    if (edge.head == heads::kDataflow)
      incomingDataflow[edge.dst].insert(edge.src);

  auto physicalOrigin = [&](const std::string &id,
                            const SemanticSource *fallback)
      -> std::pair<std::string, const SemanticSource *> {
    if (fallback && fallback->schema.clazz != "InternalState")
      return {id, fallback};
    std::set<std::string> seen;
    std::vector<std::string> work = {id};
    std::vector<std::pair<std::string, const SemanticSource *>> physical;
    while (!work.empty()) {
      std::string current = work.back();
      work.pop_back();
      if (!seen.insert(current).second)
        continue;
      auto source = sourcesById.find(current);
      if (source != sourcesById.end() &&
          source->second->schema.clazz != "InternalState") {
        physical.push_back({current, source->second});
        continue;
      }
      auto incoming = incomingDataflow.find(current);
      if (incoming != incomingDataflow.end())
        work.insert(work.end(), incoming->second.begin(), incoming->second.end());
    }
    if (physical.size() == 1)
      return physical.front();
    return {id, nullptr};
  };

  for (const auto &kv : dataflow) {
    const std::string &sourceId = kv.first;
    for (const auto &tuple : kv.second) {
      const SemanticSink &sink = std::get<0>(tuple);
      const TaintLabel &label = std::get<1>(tuple);
      auto [effectiveSourceId, effectiveSource] =
          physicalOrigin(sourceId, label.source);

      if (!effectiveSource || !isPrimarySource(*effectiveSource))
        continue;
      // Exact forward dependency: the sink argument must be derived from the
      // label source by an exact LLVM use chain (casts, phis, selects,
      // arithmetic, resolved argument passing, and returns). SVFG memory
      // propagation alone merges unrelated sizes across functions; a
      // physical source may back a rule only with this exact forward
      // dependency, on top of the unique stored-source provenance resolved
      // above for InternalState labels. The traversed argument-passing steps
      // are the only object provenance for a sink's destination formal.
      ProvenArgumentPassing provenPassing;
      if (!directlyReachesSink(label.source->rootValue, sink, callGraph,
                               &provenPassing))
        continue;
      const std::string &ruleSourceId = effectiveSourceId;

      std::string functionName = sink.call->getFunction()->getName().str();

      std::vector<Edge> triggers;
      auto selfIt = selfEdges.find(sourceId);
      if (selfIt != selfEdges.end() && !selfIt->second.empty()) {
        for (const Edge &e : selfIt->second) {
          // Ne is guard-only, never a target-state mutation target.
          if (e.pred.kind == "Ne")
            continue;
          Edge trigger = e;
          trigger.src = ruleSourceId;
          trigger.dst = ruleSourceId;
          triggers.push_back(std::move(trigger));
        }
      }
      if (sink.call) {
        const llvm::DataLayout &DL = sink.call->getModule()->getDataLayout();
        if (auto inferred =
                inferBufferBound(sink, ruleSourceId, DL, provenPassing)) {
          uint64_t maxValue = UINT64_MAX;
          if (effectiveSource->schema.widthBytes.hasValue()) {
            unsigned bits = effectiveSource->schema.widthBytes.getValue() * 8;
            if (bits < 64)
              maxValue = (1ull << bits) - 1;
          }
          if (inferred->pred.value.hasValue() &&
              inferred->pred.value.getValue() < maxValue)
            triggers.push_back(*inferred);
        }
      }
      if (triggers.empty() && (sink.role == Role::Size || sink.role == Role::Index)) {
        Edge trigger;
        trigger.src = ruleSourceId;
        trigger.dst = ruleSourceId;
        trigger.function = functionName;
        trigger.loc = sink.call->getDebugLoc();
        trigger.head = heads::kBound;
        trigger.pred = Predicate{"Gt", llvm::None, llvm::None};
        triggers.push_back(trigger);
      }
      if (triggers.empty())
        continue;

      for (Edge trigger : triggers) {
        trigger.src = ruleSourceId;
        trigger.dst = ruleSourceId;
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
                                        trigger.falseRegion, sink.call,
                                        provenPassing, callGraph);
          if (!associated)
            continue;
        }

        // Pattern 3: when a value reaches a size/index sink without an
        // explicit comparison, derive a concrete bound only from the actual
        // destination object size. Otherwise retain the unknown analysis
        // finding; it cannot be lowered into an executable rule.
        if (isGenericTrigger(trigger.pred) && sink.call) {
          const llvm::DataLayout &DL = sink.call->getModule()->getDataLayout();
          if (auto inferred =
                  inferBufferBound(sink, ruleSourceId, DL, provenPassing))
            trigger = *inferred;
        }
        if (trigger.pred.value.hasValue() &&
            effectiveSource->schema.widthBytes.hasValue()) {
          unsigned bits = effectiveSource->schema.widthBytes.getValue() * 8;
          uint64_t maxValue = bits >= 64 ? UINT64_MAX : (1ull << bits) - 1;
          if (trigger.pred.value.getValue() > maxValue)
            continue;
        }
        if ((trigger.pred.kind == "Gt" || trigger.pred.kind == "Lt" ||
             trigger.pred.kind == "Ge" || trigger.pred.kind == "Le") &&
            !trigger.pred.value.hasValue())
          continue;

        std::string key = functionName + "|" + ruleSourceId + "|" +
                          triggerKey(trigger);
        Rule *rp = nullptr;
        auto rmIt = ruleMap.find(key);
        if (rmIt == ruleMap.end()) {
          Rule r;
          r.id = functionName + "-" + ruleSourceId;
          r.function = functionName;
          r.vars.push_back(*effectiveSource);
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
        for (const auto &step : provenPassing)
          rp->provenFlow.push_back(step);

        auto ctrlIt = ctrlBySink.find(sink.call);
        if (ctrlIt != ctrlBySink.end()) {
          for (const ControlResult *controlResult : ctrlIt->second) {
            if (controlResult->sourceId == ruleSourceId)
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
            pre.dst = ruleSourceId;
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
  // source becomes a precondition when its proven region controls the path
  // to one of the rule's sinks — directly for same-function sinks, or by
  // covering the rule's proven value-flow entry into the sink's function.
  // Guards on disjoint paths are discarded.
  for (auto &kv : ruleMap) {
    Rule &r = kv.second;
    for (const ControlResult *cr : guardCandidates) {
      if (cr->sourceId == r.trigger.src)
        continue;
      bool ok = false;
      for (const SemanticSink &sink : r.sinks) {
        if (!sink.call)
          continue;
        if (guardControlsThroughChain(cr->site, cr->guardedRegion,
                                      cr->falseRegion, sink.call,
                                      r.provenFlow, callGraph)) {
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
      pre.falseRegion = cr->falseRegion;
      r.preconditions.push_back(std::move(pre));
    }
  }

  std::vector<Rule> rules;
  for (auto &kv : ruleMap) {
    Rule &r = kv.second;

    // Filter preconditions to guards that provably control the path to one
    // of the rule's sinks: from their guarded region directly, or by
    // covering the rule's proven value-flow entry into the sink's function.
    // Guards on disjoint paths are discarded.
    r.preconditions.erase(
        std::remove_if(r.preconditions.begin(), r.preconditions.end(),
                       [&](const Edge &pre) {
                         if (!pre.site)
                           return true;
                         for (const SemanticSink &sink : r.sinks) {
                           if (!sink.call)
                             continue;
                           if (guardControlsThroughChain(
                                   pre.site, pre.guardedRegion,
                                   pre.falseRegion, sink.call, r.provenFlow,
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
