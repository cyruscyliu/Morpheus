#ifndef SDG_CORE_PREDICATE_H
#define SDG_CORE_PREDICATE_H

#include "llvm/ADT/Optional.h"
#include <string>

namespace sdg {
namespace core {

/// Signedness of a relational predicate. This belongs to the comparison that
/// produced the predicate, not to the node itself.
enum class Signedness { Unknown, Signed, Unsigned };

inline const char *signednessName(Signedness s) {
  switch (s) {
  case Signedness::Signed: return "Signed";
  case Signedness::Unsigned: return "Unsigned";
  default: return "Unknown";
  }
}

inline Signedness signednessFromName(const std::string &name) {
  if (name == "Signed") return Signedness::Signed;
  if (name == "Unsigned") return Signedness::Unsigned;
  return Signedness::Unknown;
}

/// Guard predicate recovered from a comparison or feature test.
struct Predicate {
  std::string kind;               ///< "Eq", "Ne", "Gt", "Lt", "BitSet", ...
  llvm::Optional<uint64_t> value; ///< For scalar predicates.
  llvm::Optional<unsigned> bit;   ///< For BitSet / BitClear.
  llvm::Optional<uint64_t> min;   ///< For InRange lower bound.
  llvm::Optional<uint64_t> max;   ///< For InRange upper bound.
  Signedness signedness = Signedness::Unknown; ///< Signed, Unsigned, or Unknown.
  llvm::Optional<unsigned> widthBits; ///< Node width for width/domain checks.
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_PREDICATE_H
