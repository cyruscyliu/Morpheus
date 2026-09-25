#include "sdg/core/RuleAssembler.h"
#include "llvm/IR/Instructions.h"
#include <algorithm>
#include <string>

using namespace sdg::core;

std::vector<Rule>
RuleAssembler::assemble(const TaintResult &dataflow,
                        const std::vector<ControlResult> &control) const {
  std::vector<Rule> rules;

  // Assemble data-flow rules.
  for (const auto &kv : dataflow) {
    const std::string &sourceId = kv.first;
    for (const auto &tuple : kv.second) {
      const SemanticSink &sink = std::get<0>(tuple);
      const TaintLabel &label = std::get<1>(tuple);
      const std::vector<Predicate> &pres = std::get<2>(tuple);

      Rule r;
      r.id = sink.call->getFunction()->getName().str() + "-" + sourceId;
      r.function = sink.call->getFunction()->getName().str();
      r.vars.push_back(*label.source);
      r.sinks.push_back(sink);
      // TODO: convert pres to Edge preconditions.
      (void)pres;
      r.trigger.src = sourceId;
      r.trigger.dst = sourceId;
      r.trigger.function = r.function;
      r.trigger.head = heads::kBound;
      r.trigger.pred = Predicate{"Ne", 0, llvm::None};
      r.trigger.loc = sink.call->getDebugLoc();
      r.mutation = mutationForPredicate(r.trigger.pred);
      r.confidence = label.confidence;
      rules.push_back(r);
    }
  }

  // Assemble control-dependency rules.  If no sink is reached on the
  // predicate side the rule still records the feature-bit/branch predicate.
  for (const auto &cr : control) {
    Rule r;
    r.id = cr.function + "-" + cr.sourceId + "-ctrl";
    r.function = cr.function;
    r.vars.push_back(cr.source);
    r.sinks.push_back(cr.sink);
    r.trigger.src = cr.sourceId;
    r.trigger.dst = cr.sourceId;
    r.trigger.function = cr.function;
    r.trigger.head = heads::kBound;
    r.trigger.pred = cr.pred;
    r.trigger.loc = cr.loc;
    r.mutation = mutationForPredicate(cr.pred);
    r.confidence = 0.55f;
    rules.push_back(r);
  }

  return deduplicate(std::move(rules));
}

std::vector<Rule> RuleAssembler::deduplicate(std::vector<Rule> rules) const {
  auto key = [](const Rule &r) -> std::string {
    std::string s = r.id + "|" + r.function;
    for (const SemanticSink &sink : r.sinks)
      s += "|" + sink.function + ":" + std::to_string(sink.argIndex);
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

Mutation RuleAssembler::mutationForPredicate(const Predicate &p) const {
  Mutation m;
  if (p.kind == "BitSet") {
    m.op = "FlipBit";
    m.bit = p.bit;
  } else if (p.kind == "Ne" && p.value.hasValue() && p.value.getValue() == 0) {
    m.op = "SampleRange";
  } else if (p.kind == "Gt" && p.value.hasValue() && p.value.getValue() == 0) {
    m.op = "SetBoundary";
    m.side = "Above";
  } else {
    m.op = "SampleRange";
  }
  return m;
}
