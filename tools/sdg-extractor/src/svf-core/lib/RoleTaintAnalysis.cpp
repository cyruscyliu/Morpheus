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

/// Direct LLVM use-chain fallback: collect sink calls reachable from V through
/// casts, binary ops, compares, selects and phis. This complements the SVFG
/// when volatile loads or simple arithmetic are not represented by SVFG edges.
static void collectSinksByUseChain(
    const llvm::Value *V, const SinkCatalog &catalog,
    const SemanticSource &src, Role sourceRole,
    std::vector<std::tuple<SemanticSink, TaintLabel, std::vector<Predicate>>> &out,
    std::set<const llvm::Value *> &seen) {
  if (!V || !seen.insert(V).second)
    return;

  for (const SemanticSink &sink : sinksForValue(V, catalog)) {
    TaintLabel label{&src, sink.role, 1.0f};
    out.push_back({sink, label, std::vector<Predicate>()});
  }

  // Traverse only forward users. Walking from a derived instruction back to
  // all of its operands taints unrelated values that merely participate in
  // the same expression and quickly contaminates the whole value-flow graph.
  for (const User *U : V->users()) {
    if (isa<CastInst>(U) || isa<PHINode>(U) || isa<SelectInst>(U) ||
        isa<UnaryOperator>(U) || isa<BinaryOperator>(U) ||
        isa<ICmpInst>(U) || isa<FCmpInst>(U)) {
      collectSinksByUseChain(cast<Value>(U), catalog, src, sourceRole, out, seen);
    }
  }
}

void RoleTaintAnalysis::run() {
  for (const SemanticSource &src : sources_) {
    const Role sourceRole = roleForSchema(src.schema);
    std::vector<std::tuple<SemanticSink, TaintLabel, std::vector<Predicate>>> found;

    std::vector<const VFGNode *> roots = graph_.nodesForValue(src.rootValue);
    if (!roots.empty()) {
      std::set<std::pair<NodeID, Role>> seen;
      std::queue<std::pair<const VFGNode *, Role>> q;

      for (const VFGNode *root : roots) {
        seen.insert({root->getId(), sourceRole});
        q.push({root, sourceRole});
      }

      while (!q.empty()) {
        auto [node, role] = q.front();
        q.pop();

        // Check whether this SVFG node reaches any sink arguments.
        const Value *V = graph_.llvmValue(node);
        for (const SemanticSink &sink : sinksForValue(V, sinkCatalog_)) {
          TaintLabel label{&src, sink.role, 1.0f};
          found.push_back({sink, label, std::vector<Predicate>()});
        }

        SmallVector<const VFGNode *, 8> next;
        graph_.forwardNeighbours(node, next);
        for (const VFGNode *succ : next) {
          Role nextRole = transformRole(role, node, succ);
          if (seen.insert({succ->getId(), nextRole}).second)
            q.push({succ, nextRole});
        }
      }
    }

    // Fallback: direct LLVM use-chain for cases the SVFG does not cover.
    std::set<const llvm::Value *> seenValues;
    collectSinksByUseChain(src.rootValue, sinkCatalog_, src, sourceRole,
                           found, seenValues);

    // Deduplicate by sink call pointer and arg index.
    std::set<std::pair<const llvm::CallBase *, unsigned>> seenSinks;
    for (auto &tuple : found) {
      const SemanticSink &sink = std::get<0>(tuple);
      auto key = std::make_pair(sink.call, sink.argIndex);
      if (seenSinks.insert(key).second)
        result_[src.schema.id].push_back(std::move(tuple));
    }
  }
}

Role RoleTaintAnalysis::transformRole(Role role, const VFGNode *from,
                                      const VFGNode *to) const {
  (void)from;
  if (const Instruction *instruction = graph_.llvmInstruction(to)) {
    if (isa<GetElementPtrInst>(instruction) ||
        isa<PtrToIntInst>(instruction) || isa<IntToPtrInst>(instruction))
      return Role::Address;
    if (isa<ICmpInst>(instruction) || isa<FCmpInst>(instruction))
      return Role::Control;
  }
  return role;
}
