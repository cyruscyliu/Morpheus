#ifndef SDG_CORE_SEMANTICVALUEFLOWGRAPH_H
#define SDG_CORE_SEMANTICVALUEFLOWGRAPH_H

#include "llvm/ADT/SmallVector.h"
#include <vector>

namespace llvm {
class Value;
class Instruction;
} // namespace llvm

namespace SVF {
class SVFG;
class VFGNode;
} // namespace SVF

namespace sdg {
namespace core {

/// Thin wrapper around SVF's SVFG that speaks LLVM values.
class SemanticValueFlowGraph {
public:
  explicit SemanticValueFlowGraph(SVF::SVFG *svfg);

  /// SVFG nodes that correspond to an LLVM value.
  std::vector<const SVF::VFGNode *>
  nodesForValue(const llvm::Value *V) const;

  /// Forward value-flow neighbours.
  void
  forwardNeighbours(const SVF::VFGNode *node,
                    llvm::SmallVectorImpl<const SVF::VFGNode *> &out) const;

  /// Backward value-flow neighbours.
  void
  backwardNeighbours(const SVF::VFGNode *node,
                     llvm::SmallVectorImpl<const SVF::VFGNode *> &out) const;

  /// Map an SVFG node back to LLVM.
  const llvm::Value *llvmValue(const SVF::VFGNode *node) const;
  const llvm::Instruction *llvmInstruction(const SVF::VFGNode *node) const;

private:
  SVF::SVFG *svfg_;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_SEMANTICVALUEFLOWGRAPH_H
