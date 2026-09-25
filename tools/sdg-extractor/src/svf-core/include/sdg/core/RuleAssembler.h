#ifndef SDG_CORE_RULEASSEMBLER_H
#define SDG_CORE_RULEASSEMBLER_H

#include "sdg/core/Rule.h"
#include "sdg/core/RoleTaintAnalysis.h"
#include <vector>

namespace llvm {
class Function;
} // namespace llvm

namespace sdg {
namespace core {

struct ControlResult {
  std::string sourceId;
  Predicate pred;
  SemanticSink sink;
  std::string function;
  llvm::DebugLoc loc;
  SemanticSource source;
};

class RuleAssembler {
public:
  /// Combine data-flow and control-dependency findings into SDG rules.
  std::vector<Rule> assemble(
      const TaintResult &dataflow,
      const std::vector<ControlResult> &control,
      const std::vector<SemanticSource> &sources,
      const std::map<std::string, Edge> &selfEdges,
      const std::vector<Edge> &crossDataflow) const;

  /// Deduplicate rules, preferring more complete metadata / higher confidence.
  std::vector<Rule> deduplicate(std::vector<Rule> rules) const;

private:
  Mutation mutationForPredicate(const Predicate &p,
                                const std::string &var) const;
  float scoreRule(const Rule &r) const;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_RULEASSEMBLER_H
