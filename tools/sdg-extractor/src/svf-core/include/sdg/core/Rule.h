#ifndef SDG_CORE_RULE_H
#define SDG_CORE_RULE_H

#include "sdg/core/Predicate.h"
#include "sdg/core/SemanticSink.h"
#include "sdg/core/SemanticSource.h"
#include <string>
#include <vector>

namespace sdg {
namespace core {

struct Edge {
  std::string src;
  std::string dst;
  std::string head;
  Predicate pred;
  std::string function;
  llvm::DebugLoc loc;
};

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
  Mutation mutation;
  float confidence;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_RULE_H
