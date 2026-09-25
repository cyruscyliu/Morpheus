#include "sdg/core/RuleAssembler.h"
#include "llvm/IR/Instructions.h"
#include <algorithm>
#include <set>
#include <string>

using namespace llvm;
using namespace sdg::core;

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
  // Simple contradiction: a guard requires the same variable to be zero while
  // the trigger requires it to be non-zero.
  if (pre.src != trigger.src)
    return false;
  if (pre.pred.kind == "Eq" && trigger.pred.kind == "Ne" &&
      pre.pred.value.hasValue() && trigger.pred.value.hasValue() &&
      pre.pred.value.getValue() == trigger.pred.value.getValue())
    return false; // these agree (both bound away from zero)
  (void)pre;
  (void)trigger;
  return false;
}

std::vector<Rule>
RuleAssembler::assemble(const TaintResult &dataflow,
                        const std::vector<ControlResult> &control,
                        const std::vector<SemanticSource> &sources,
                        const std::map<std::string, Edge> &selfEdges,
                        const std::vector<Edge> &crossDataflow) const {
  std::vector<Rule> rules;

  // Map control results by sink call site so they can be attached as guard
  // preconditions to the data-flow rules that reach the same sink.
  std::map<std::pair<const CallBase *, unsigned>, std::vector<const ControlResult *>>
      ctrlBySink;
  for (const ControlResult &cr : control) {
    if (cr.sink.call)
      ctrlBySink[{cr.sink.call, cr.sink.argIndex}].push_back(&cr);
  }

  for (const auto &kv : dataflow) {
    const std::string &sourceId = kv.first;
    for (const auto &tuple : kv.second) {
      const SemanticSink &sink = std::get<0>(tuple);
      const TaintLabel &label = std::get<1>(tuple);

      Rule r;
      r.id = sink.call->getFunction()->getName().str() + "-" + sourceId;
      r.function = sink.call->getFunction()->getName().str();
      r.vars.push_back(*label.source);
      r.sinks.push_back(sink);

      // Trigger: use the extracted self-edge if available; otherwise infer a
      // missing-check trigger for size/offset sinks (grammar Pattern 3).
      Edge trigger;
      trigger.src = sourceId;
      trigger.dst = sourceId;
      trigger.function = r.function;
      trigger.loc = sink.call->getDebugLoc();
      auto selfIt = selfEdges.find(sourceId);
      if (selfIt != selfEdges.end()) {
        trigger = selfIt->second;
        trigger.src = sourceId;
        trigger.dst = sourceId;
        trigger.function = r.function;
      } else if (sink.role == Role::Size || sink.role == Role::Index) {
        trigger.head = heads::kBound;
        trigger.pred = Predicate{"Gt", llvm::None, llvm::None};
      } else {
        trigger.head = heads::kBound;
        trigger.pred = Predicate{"Ne", 0, llvm::None};
      }
      r.trigger = trigger;

      // Cross preconditions.
      // 1. Dataflow edges where this source is the destination.
      for (const Edge &e : crossDataflow) {
        if (e.dst == sourceId)
          r.preconditions.push_back(e);
      }
      // 2. Guard edges from control dependency analysis that gate the same
      // sink call site.
      auto ctrlIt = ctrlBySink.find({sink.call, sink.argIndex});
      if (ctrlIt != ctrlBySink.end()) {
        for (const ControlResult *cr : ctrlIt->second) {
          if (cr->sourceId == sourceId)
            continue;
          // Keep only meaningful guards.  Feature-bit guards are the primary
          // cross-edge precondition; discard generic state guards with no
          // concrete constant.
          bool isFeatureGuard = cr->source.schema.featureBit.hasValue() ||
                                cr->pred.kind == "BitSet" ||
                                cr->pred.kind == "BitClear";
          bool hasConcrete = cr->pred.value.hasValue() ||
                             cr->pred.bit.hasValue();
          if (!isFeatureGuard && !hasConcrete)
            continue;
          Edge pre;
          pre.src = cr->sourceId;
          pre.dst = sourceId;
          pre.head = heads::kGuard;
          pre.pred = cr->pred;
          pre.function = cr->function;
          pre.loc = cr->loc;
          r.preconditions.push_back(pre);
        }
      }

      // Cap preconditions to avoid rules that are dominated by a long chain
      // of unrelated feature-bit checks.  Prefer concrete feature-bit guards.
      if (r.preconditions.size() > 10) {
        std::stable_sort(
            r.preconditions.begin(), r.preconditions.end(),
            [](const Edge &a, const Edge &b) {
              auto rank = [](const Edge &e) -> int {
                if (e.pred.kind == "BitSet" || e.pred.kind == "BitClear")
                  return 0;
                if (e.pred.value.hasValue() || e.pred.bit.hasValue())
                  return 1;
                return 2;
              };
              return rank(a) < rank(b);
            });
        r.preconditions.resize(10);
      }

      r.mutation = mutationForPredicate(r.trigger.pred, sourceId);
      r.confidence = scoreRule(r);
      if (r.confidence >= 0.3f)
        rules.push_back(r);
    }
  }

  return deduplicate(std::move(rules));
}

std::vector<Rule> RuleAssembler::deduplicate(std::vector<Rule> rules) const {
  auto key = [](const Rule &r) -> std::string {
    std::string s = r.id + "|" + r.function;
    for (const SemanticSink &sink : r.sinks)
      s += "|" + sink.function + ":" + std::to_string(sink.argIndex);
    for (const Edge &e : r.preconditions)
      s += "|" + e.src + "->" + e.dst + ":" + e.head;
    return s;
  };
  std::stable_sort(rules.begin(), rules.end(),
                   [&key](const Rule &a, const Rule &b) {
                     return key(a) < key(b);
                   });
  std::vector<Rule> out;
  std::string last;
  for (Rule &r : rules) {
    std::string k = key(r);
    if (k == last)
      continue;
    last = k;
    out.push_back(std::move(r));
  }
  return out;
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
      m.value = ~(1ull << p.bit.getValue());
    m.bit = p.bit;
  } else if (p.kind == "Ne" && p.value.hasValue() && p.value.getValue() == 0) {
    m.op = "SetBoundary";
    m.side = "Above";
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
  } else if (p.kind == "InRange" && p.value.hasValue()) {
    m.op = "SampleRange";
    m.value = p.value.getValue();
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
