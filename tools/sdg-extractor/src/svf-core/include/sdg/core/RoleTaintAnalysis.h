#ifndef SDG_CORE_ROLETAINTANALYSIS_H
#define SDG_CORE_ROLETAINTANALYSIS_H

#include "sdg/core/Predicate.h"
#include "sdg/core/SemanticSink.h"
#include "sdg/core/SemanticSource.h"
#include "sdg/core/SemanticValueFlowGraph.h"
#include "sdg/core/SinkCatalog.h"
#include "sdg/core/SourceCatalog.h"
#include "llvm/ADT/SmallVector.h"
#include <map>
#include <tuple>
#include <vector>

namespace SVF {
class VFGNode;
} // namespace SVF

namespace sdg {
namespace core {

/// A taint label propagated from a source through the value-flow graph.
struct TaintLabel {
  const SemanticSource *source;
  Role role;
  float confidence;
};

/// Result of the role-preserving taint pass.
using TaintResult = std::map<
    std::string, // source id
    std::vector<std::tuple<SemanticSink, TaintLabel, std::vector<Predicate>>>>;

class RoleTaintAnalysis {
public:
  RoleTaintAnalysis(const SemanticValueFlowGraph &graph,
                    const std::vector<SemanticSource> &sources,
                    const SinkCatalog &sinks);

  void run(unsigned maxDepth = 64);

  const TaintResult &result() const { return result_; }

private:
  Role transformRole(Role role, const SVF::VFGNode *from,
                     const SVF::VFGNode *to) const;

  const SemanticValueFlowGraph &graph_;
  const std::vector<SemanticSource> &sources_;
  const SinkCatalog &sinkCatalog_;
  TaintResult result_;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_ROLETAINTANALYSIS_H
