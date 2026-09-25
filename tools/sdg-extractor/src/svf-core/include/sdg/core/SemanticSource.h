#ifndef SDG_CORE_SEMANTICSOURCE_H
#define SDG_CORE_SEMANTICSOURCE_H

#include "sdg/core/Role.h"
#include "llvm/ADT/Optional.h"
#include "llvm/IR/DebugLoc.h"
#include <string>

namespace llvm {
class Value;
class Instruction;
} // namespace llvm

namespace sdg {
namespace core {

/// Static description of a guest-controlled source class.
struct SourceSchema {
  std::string id;      ///< e.g. "MmioTransport.queue_notify"
  std::string clazz;   ///< "Mmio", "Dma", "InternalState"
  std::string accessKind; ///< "transport", "config", "feature", "streaming" ...
  llvm::Optional<uint64_t> offset;
  llvm::Optional<unsigned> featureBit;
  llvm::Optional<unsigned> widthBytes;
  std::string field;   ///< Human-readable field name when known.
};

/// A concrete source instance discovered in the bitcode.
struct SemanticSource {
  SourceSchema schema;
  const llvm::Value *rootValue;      ///< SSA value or memory object to track.
  const llvm::Instruction *site;     ///< Instruction where the source is read.
  std::string function;
  llvm::DebugLoc loc;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_SEMANTICSOURCE_H
