#ifndef SDG_CORE_SEMANTICSINK_H
#define SDG_CORE_SEMANTICSINK_H

#include "llvm/ADT/Optional.h"
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
  /// Destination-buffer operand index from the sink contract, when the role
  /// operand is bounded by static destination capacity. Contract metadata
  /// owned by the catalog; never inferred from names at use sites.
  llvm::Optional<unsigned> destArg;
  const llvm::CallBase *call;
  /// True when a DMA telemetry event confirms the sink's DMA lifecycle.
  /// Evidence metadata only; telemetry never creates sinks.
  bool telemetryConfirmed = false;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_SEMANTICSINK_H
