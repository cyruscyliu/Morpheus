#ifndef SDG_CORE_SOURCECATALOG_H
#define SDG_CORE_SOURCECATALOG_H

#include "sdg/core/SemanticSource.h"
#include "llvm/ADT/Optional.h"
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace llvm {
class CallBase;
class LoadInst;
} // namespace llvm

namespace sdg {
namespace core {

/// Per-function DMA telemetry evidence from the partial DMA telemetry patch.
/// `root` is the associable provenance value (the traced DMA address for the
/// publish signature, the virtqueue pointer for the vq-state signature);
/// the vq-state aux operand is never used for association.
struct TelemetryEvidence {
  std::string event;
  const llvm::Value *root = nullptr;
  bool addressRoot = false;
};

/// Matches LLVM values to Virtio 1.3 MMIO and DMA protocol sources.
class SourceCatalog {
public:
  SourceCatalog();

  /// Provide per-function telemetry evidence used as DMA provenance at
  /// match time. Telemetry never creates a source by itself: it confirms a
  /// candidate whose value shares provenance with a traced address or
  /// virtqueue.
  void setTelemetryEvents(
      std::map<const llvm::Function *, std::vector<TelemetryEvidence>>
          events);

  /// Try to classify a call as a source.
  llvm::Optional<SemanticSource> matchCall(llvm::CallBase *CB,
                                           const std::string &functionName,
                                           llvm::DebugLoc loc) const;

  /// Try to classify a load from a known semantic struct field as a source.
  llvm::Optional<SemanticSource> matchLoad(llvm::LoadInst *LI,
                                           const std::string &functionName,
                                           llvm::DebugLoc loc) const;

private:
  void registerDefaultSchemas();

  llvm::Optional<SemanticSource>
  matchConfigGetLoad(llvm::LoadInst *LI, const std::string &functionName,
                     llvm::DebugLoc loc) const;

private:
  std::vector<SourceSchema> schemas_;
  std::map<std::pair<std::string, unsigned>, SourceSchema> structFieldSchemas_;
  std::map<const llvm::Function *, std::vector<TelemetryEvidence>>
      telemetryEvents_;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_SOURCECATALOG_H
