#ifndef SDG_CORE_SEMANTICSINK_H
#define SDG_CORE_SEMANTICSINK_H

#include "sdg/core/Role.h"
#include <string>

namespace llvm {
class CallBase;
} // namespace llvm

namespace sdg {
namespace core {

/// A concrete sink call discovered in the bitcode.
struct SemanticSink {
  std::string function;   ///< Normalized base function name.
  Role role;
  unsigned argIndex;
  const llvm::CallBase *call;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_SEMANTICSINK_H
