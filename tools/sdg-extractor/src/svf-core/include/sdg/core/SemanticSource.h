#ifndef SDG_CORE_SEMANTICSOURCE_H
#define SDG_CORE_SEMANTICSOURCE_H

#include "sdg/core/Role.h"
#include "llvm/ADT/Optional.h"
#include "llvm/IR/DebugLoc.h"
#include <string>
#include <vector>

namespace llvm {
class Value;
class Instruction;
} // namespace llvm

namespace sdg {
namespace core {

/// Signedness hint carried by the source-level type/debug info.
struct ValueType {
  unsigned widthBits = 0;
  enum class Signedness { Unknown, Signed, Unsigned } signedness =
      Signedness::Unknown;
};

/// Static description of a guest-controlled source class.
struct SourceSchema {
  std::string id;      ///< e.g. "MmioTransport.queue_notify"
  std::string clazz;   ///< "Mmio", "Dma", "InternalState"
  std::string accessKind; ///< "transport", "config", "feature", "streaming" ...
  llvm::Optional<uint64_t> offset;
  llvm::Optional<unsigned> featureBit;
  llvm::Optional<unsigned> widthBytes;
  std::string field;   ///< Human-readable field name when known.
  llvm::Optional<unsigned> featureWordSelector;
  llvm::Optional<unsigned> nodeLocalBit;
  llvm::Optional<unsigned> slot; ///< Streaming-buffer slot, when specified.
  /// DMA telemetry event that confirms this surface, when known from the
  /// partial DMA telemetry patch (e.g. "map", "alloc_success", "vq_get_buf").
  llvm::Optional<std::string> telemetryEvent;
  std::string direction; ///< Protocol direction: R, W, RW, or device-writable.
  std::vector<std::string> requiredFeaturesAnyOf;
  std::string evidence; ///< Evidence source, e.g. "virtio-1.3".
  llvm::Optional<uint64_t> validMask;
  std::vector<uint64_t> validValues;
  ValueType valueType; ///< Width and signedness hint from source/debug info.
};

/// A concrete source instance discovered in the bitcode.
struct SemanticSource {
  SourceSchema schema;
  const llvm::Value *rootValue;      ///< SSA value or memory object to track.
  const llvm::Instruction *site = nullptr; ///< Instruction where the source is read.
  std::string function;
  llvm::DebugLoc loc;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_SEMANTICSOURCE_H
