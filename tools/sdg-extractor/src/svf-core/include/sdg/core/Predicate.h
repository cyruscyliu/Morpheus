#ifndef SDG_CORE_PREDICATE_H
#define SDG_CORE_PREDICATE_H

#include "llvm/ADT/Optional.h"
#include <string>

namespace sdg {
namespace core {

/// Guard predicate recovered from a comparison or feature test.
struct Predicate {
  std::string kind;               ///< "Eq", "Ne", "Gt", "Lt", "BitSet", ...
  llvm::Optional<uint64_t> value; ///< For scalar predicates.
  llvm::Optional<unsigned> bit;   ///< For BitSet / BitClear.
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_PREDICATE_H
