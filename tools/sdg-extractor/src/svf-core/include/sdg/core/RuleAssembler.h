#ifndef SDG_CORE_RULEASSEMBLER_H
#define SDG_CORE_RULEASSEMBLER_H

#include "sdg/core/Rule.h"
#include "sdg/core/RoleTaintAnalysis.h"
#include <map>
#include <set>
#include <vector>

namespace llvm {
class Function;
class Instruction;
} // namespace llvm

namespace sdg {
namespace core {
struct ControlResult {
  std::string sourceId;
  Predicate pred;
  SemanticSink sink;
  std::string function;
  llvm::DebugLoc loc;
  const llvm::Instruction *site = nullptr;
  /// The basic block reached when the predicate holds: the guarded region.
  /// A branch dominates sinks on both successors, so the exact sink-side
  /// reached when the predicate holds must be carried through any proof.
  const llvm::BasicBlock *guardedRegion = nullptr;
  /// The opposite (condition-false) successor of the guarding branch.
  /// Reachability from the guarded region alone also admits sinks that sit
  /// after the guard's join and run regardless of the predicate; the false
  /// side excludes them from the proven region.
  const llvm::BasicBlock *falseRegion = nullptr;
  SemanticSource source;
};

/// Call-graph information used to prove cross-function control dependency.
/// Callees include indirect callees resolved by pointer analysis, so the
/// proof never associates calls and sinks by name.
struct CallGraphInfo {
  /// Resolved callees (direct + indirect) for every call site.
  std::map<const llvm::CallBase *, std::set<const llvm::Function *>> callees;
  /// Call sites grouped by their containing function.
  std::map<const llvm::Function *, std::vector<const llvm::CallBase *>> calls;
  /// Reverse edges: every call site resolved to a function, so a returned
  /// value can continue the chain into each caller.
  std::map<const llvm::Function *, std::vector<const llvm::CallBase *>>
      callersOf;
};

class RuleAssembler {
public:
  /// Combine data-flow and control-dependency findings into SDG rules.
  std::vector<Rule> assemble(
      const TaintResult &dataflow,
      const std::vector<ControlResult> &control,
      const std::vector<SemanticSource> &sources,
      const SelfEdgeMap &selfEdges,
      const std::vector<Edge> &crossDataflow,
      const CallGraphInfo &callGraph) const;

private:
  Mutation mutationForPredicate(const Predicate &p,
                                const std::string &var) const;
  float scoreRule(const Rule &r) const;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_RULEASSEMBLER_H
