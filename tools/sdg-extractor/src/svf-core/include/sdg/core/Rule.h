#ifndef SDG_CORE_RULE_H
#define SDG_CORE_RULE_H

#include "sdg/core/Predicate.h"
#include "sdg/core/SemanticSink.h"
#include "sdg/core/SemanticSource.h"
#include <map>
#include <string>
#include <vector>

namespace llvm {
class CallBase;
class DebugLoc;
class Function;
class Instruction;
} // namespace llvm

namespace sdg {
namespace core {

struct Edge {
  std::string src;
  std::string dst;
  std::string head;
  Predicate pred;
  std::string function;
  llvm::DebugLoc loc;
  const llvm::Instruction *site = nullptr;
  /// The basic block reached when the predicate holds: for target states,
  /// the direction that stays on the non-error path.
  const llvm::BasicBlock *guardedRegion = nullptr;
  /// The opposite (condition-false) successor of the guarding branch. A
  /// callsite reachable from both sides runs regardless of the predicate,
  /// so the false side is what confines the proven region. Metadata only;
  /// not part of the .sdg condition identity.
  const llvm::BasicBlock *falseRegion = nullptr;
  std::string evidence = "llvm";
};

using SelfEdgeMap = std::map<std::string, std::vector<Edge>>;

/// Call sites traversed by an exact value-flow proof, paired with the
/// callee each argument was passed into. Object provenance for a sink's
/// destination formal is resolved along this proven path only.
using ProvenArgumentPassing =
    std::vector<std::pair<const llvm::CallBase *, const llvm::Function *>>;

namespace heads {
inline constexpr const char *kBound = "head_bound";
inline constexpr const char *kGuard = "head_guard";
inline constexpr const char *kDataflow = "head_dataflow";
inline constexpr const char *kOffset = "head_offset";
inline constexpr const char *kCall = "head_call";
} // namespace heads

struct Mutation {
  std::string op;  // "SampleRange", "SetValue", "FlipBit", "ClearBits" ...
  llvm::Optional<uint64_t> value;
  llvm::Optional<unsigned> bit;
  llvm::Optional<uint64_t> min;
  llvm::Optional<uint64_t> max;
  llvm::Optional<std::string> side; // "Above", "Below"
  std::string var;                  ///< Variable targeted by the mutation.
};

struct Rule {
  std::string id;
  std::string function;
  std::vector<SemanticSource> vars;
  std::vector<SemanticSink> sinks;
  std::vector<Edge> preconditions;
  Edge trigger;
  /// Argument-passing callsites traversed by the rule's exact value-flow
  /// proofs: the record cross-function guard proofs replay. Internal only;
  /// not serialized.
  ProvenArgumentPassing provenFlow;
  Mutation mutation;
  float confidence;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_RULE_H
