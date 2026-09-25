#include "sdg/core/SemanticValueFlowGraph.h"
#include "SVF-LLVM/LLVMModule.h"
#include "Graphs/SVFG.h"
#include "SVFIR/SVFVariables.h"

using namespace llvm;
using namespace SVF;
using namespace sdg::core;

SemanticValueFlowGraph::SemanticValueFlowGraph(SVF::SVFG *svfg)
    : svfg_(svfg) {}

std::vector<const SVF::VFGNode *>
SemanticValueFlowGraph::nodesForValue(const llvm::Value *V) const {
  std::vector<const VFGNode *> out;
  // SVF indexes def nodes by SVFVar. A direct lookup from LLVM value is not
  // exposed, so we scan the SVFG and map back to LLVM values.
  for (const auto &it : *svfg_) {
    const VFGNode *node = it.second;
    if (llvmValue(node) == V)
      out.push_back(node);
  }
  return out;
}

void SemanticValueFlowGraph::forwardNeighbours(
    const VFGNode *node,
    SmallVectorImpl<const VFGNode *> &out) const {
  for (VFGNode::const_iterator it = node->OutEdgeBegin(),
                               end = node->OutEdgeEnd();
       it != end; ++it) {
    out.push_back((*it)->getDstNode());
  }
}

void SemanticValueFlowGraph::backwardNeighbours(
    const VFGNode *node,
    SmallVectorImpl<const VFGNode *> &out) const {
  for (VFGNode::const_iterator it = node->InEdgeBegin(),
                               end = node->InEdgeEnd();
       it != end; ++it) {
    out.push_back((*it)->getSrcNode());
  }
}

const llvm::Value *SemanticValueFlowGraph::llvmValue(const VFGNode *node) const {
  const SVFVar *svfVar = node->getValue();
  if (!svfVar)
    return nullptr;
  auto *modSet = LLVMModuleSet::getLLVMModuleSet();
  if (!modSet->hasLLVMValue(svfVar))
    return nullptr;
  return modSet->getLLVMValue(svfVar);
}

const llvm::Instruction *
SemanticValueFlowGraph::llvmInstruction(const VFGNode *node) const {
  if (const llvm::Value *V = llvmValue(node))
    return dyn_cast<Instruction>(V);
  return nullptr;
}
