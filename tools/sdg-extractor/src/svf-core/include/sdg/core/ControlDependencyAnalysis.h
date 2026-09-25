#ifndef SDG_CORE_CONTROLDEPENDENCYANALYSIS_H
#define SDG_CORE_CONTROLDEPENDENCYANALYSIS_H

#include "sdg/core/Predicate.h"
#include "sdg/core/RuleAssembler.h"
#include "sdg/core/SemanticSink.h"
#include "sdg/core/SemanticSource.h"
#include "llvm/ADT/SmallVector.h"
#include <limits>
#include <map>
#include <vector>

namespace llvm {
class Value;
class BasicBlock;
class Function;
class Module;
} // namespace llvm

namespace SVF {
class ICFG;
class ICFGNode;
} // namespace SVF

namespace sdg {
namespace core {
class SemanticValueFlowGraph;
class SinkCatalog;

using StructFieldAliasKey = std::pair<std::string, unsigned>;
using BoolFlagAlias = std::pair<std::string, Predicate>;
using LocationAliasKey = std::pair<const llvm::Value *, int64_t>;

/// Both forms of boolean-flag aliases: keyed by struct field and by normalized
/// memory location (base pointer + byte offset).  The location form captures
/// byte-offset GEPs that appear after SROA/bitcast optimization.
struct BoolFlagAliasMaps {
  std::map<StructFieldAliasKey, std::vector<BoolFlagAlias>> fieldAliases;
  std::map<LocationAliasKey, std::vector<BoolFlagAlias>> locationAliases;
};

/// Finds sink calls that are directly gated by a tainted branch condition.
class ControlDependencyAnalysis {
public:
  explicit ControlDependencyAnalysis(
      SVF::ICFG *icfg, const SemanticValueFlowGraph *graph,
      const llvm::Module &M, const SinkCatalog &sinks,
      const BoolFlagAliasMaps &boolFlagAliases = {});

  /// For a semantic source value, identify branch predicates that gate the
  /// source (e.g. feature-bit tests) and any sink calls that are reached on
  /// the predicate-true side.
  std::vector<ControlResult> analyze(const SemanticSource &src,
                                     const SinkCatalog &sinks) const;

private:
  SVF::ICFG *icfg_;
  const SemanticValueFlowGraph *graph_;

  /// Maps a struct field to the feature-bit predicates that set it.  This lets
  /// us recognize guards like `if (vi->has_rss)` as proxies for feature checks.
  BoolFlagAliasMaps boolFlagAliases_;

  /// Precomputed sinks reachable from each function's entry.  Used to answer
  /// interprocedural control-dependency queries without traversing the ICFG
  /// on every source.
  std::map<const llvm::Function *, std::vector<SemanticSink>> functionSinks_;

  void buildFunctionSinks(const llvm::Module &M, const SinkCatalog &sinks);
  std::vector<SemanticSink>
  findSinkInFunction(const llvm::Function *F,
                     const SinkCatalog &sinks) const;
  std::vector<SemanticSink>
  findSinkInRegion(const llvm::BasicBlock *BB, const SinkCatalog &sinks,
                   unsigned maxBlocks = std::numeric_limits<unsigned>::max()) const;

  /// Scan every branch/switch in the source's function and emit guards for
  /// conditions that are aliased boolean flags of this feature-bit source.
  std::vector<ControlResult>
  analyzeFeatureFlagGuards(const SemanticSource &src,
                           const SinkCatalog &sinks) const;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_CONTROLDEPENDENCYANALYSIS_H
