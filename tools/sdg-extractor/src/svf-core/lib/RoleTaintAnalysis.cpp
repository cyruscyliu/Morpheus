#include "sdg/core/RoleTaintAnalysis.h"
#include "Graphs/SVFG.h"
#include "Graphs/VFGNode.h"
#include "SVF-LLVM/LLVMModule.h"
#include "llvm/IR/Instructions.h"
#include <queue>
#include <set>

using namespace llvm;
using namespace SVF;
using namespace sdg::core;

static Role roleForSchema(const SourceSchema &schema) {
  if (schema.accessKind == "feature")
    return Role::FeatureBit;
  if (schema.accessKind == "config" || schema.accessKind == "transport")
    return Role::Value;
  if (schema.clazz == "Dma")
    return Role::Address;
  if (schema.clazz == "InternalState")
    return Role::Value;
  return Role::Unknown;
}

RoleTaintAnalysis::RoleTaintAnalysis(
    const SemanticValueFlowGraph &graph,
    const std::vector<SemanticSource> &sources,
    const SinkCatalog &sinks)
    : graph_(graph), sources_(sources), sinkCatalog_(sinks) {}

/// Find the index of V as an actual argument of CB.
static Optional<unsigned> argIndexForValue(const CallBase *CB,
                                           const Value *V) {
  for (unsigned i = 0, e = CB->arg_size(); i < e; ++i)
    if (CB->getArgOperand(i) == V)
      return i;
  return llvm::None;
}

/// Check whether the LLVM value V (reached by the taint BFS) is an argument
/// of any sink call. Returns all matched sinks.
static std::vector<SemanticSink> sinksForValue(const Value *V,
                                                const SinkCatalog &catalog) {
  std::vector<SemanticSink> out;
  if (!V)
    return out;
  for (const User *U : V->users()) {
    if (const CallBase *CB = dyn_cast<CallBase>(U)) {
      auto idx = argIndexForValue(CB, V);
      if (!idx.hasValue())
        continue;
      for (const SemanticSink &sink : catalog.match(CB))
        if (sink.argIndex == idx.getValue())
          out.push_back(sink);
    }
  }
  return out;
}

void RoleTaintAnalysis::run(unsigned maxDepth) {
  for (const SemanticSource &src : sources_) {
    std::vector<const VFGNode *> roots = graph_.nodesForValue(src.rootValue);
    if (roots.empty())
      continue;

    TaintLabel label{&src, roleForSchema(src.schema), 0.9f};
    std::set<NodeID> seen;
    std::queue<std::pair<const VFGNode *, unsigned>> q;

    for (const VFGNode *root : roots) {
      seen.insert(root->getId());
      q.push({root, 0});
    }

    while (!q.empty()) {
      auto [node, depth] = q.front();
      q.pop();
      if (depth >= maxDepth)
        continue;

      // Check whether this SVFG node reaches any sink arguments.
      const Value *V = graph_.llvmValue(node);
      for (const SemanticSink &sink : sinksForValue(V, sinkCatalog_))
        result_[src.schema.id].push_back(
            {sink, label, std::vector<Predicate>()});

      SmallVector<const VFGNode *, 8> next;
      graph_.forwardNeighbours(node, next);
      for (const VFGNode *succ : next) {
        if (seen.insert(succ->getId()).second) {
          Role newRole = transformRole(label.role, node, succ);
          (void)newRole;
          q.push({succ, depth + 1});
        }
      }
    }
  }
}

Role RoleTaintAnalysis::transformRole(Role role, const VFGNode *from,
                                      const VFGNode *to) const {
  // TODO: inspect the LLVM instruction represented by 'to' and adjust role.
  // Examples:
  // - address through GEP/bitcast -> Address
  // - size through align/page-order -> Size
  // - feature bit result used as branch -> Control
  (void)from;
  (void)to;
  return role;
}
