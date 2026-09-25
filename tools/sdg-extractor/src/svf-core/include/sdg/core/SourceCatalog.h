#ifndef SDG_CORE_SOURCECATALOG_H
#define SDG_CORE_SOURCECATALOG_H

#include "sdg/core/SemanticSink.h"
#include "sdg/core/SemanticSource.h"
#include "llvm/ADT/Optional.h"
#include "llvm/ADT/StringMap.h"
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace llvm {
class Argument;
class CallBase;
class LoadInst;
class Module;
class Value;
} // namespace llvm

namespace sdg {
namespace core {

/// Maps transport-specific knowledge onto LLVM instructions.
class SourceCatalog {
public:
  SourceCatalog();

  /// Register the default virtio-mmio + virtio-net schemas.
  void registerDefaultSchemas();

  /// Auto-discover struct-field schemas from DWARF debug info in the module.
  /// This removes the need to manually list every config/state field.
  void initialize(const llvm::Module &M);

  /// Try to classify a call as a source.
  llvm::Optional<SemanticSource> matchCall(llvm::CallBase *CB,
                                           const std::string &functionName,
                                           llvm::DebugLoc loc) const;

  /// Try to classify a load from a known semantic struct field as a source.
  llvm::Optional<SemanticSource> matchLoad(llvm::LoadInst *LI,
                                           const std::string &functionName,
                                           llvm::DebugLoc loc) const;

  /// Try to classify a function argument as a source. Multiple schemas may
  /// apply to the same argument.
  std::vector<SemanticSource> matchArgument(llvm::Argument *A,
                                            const std::string &functionName,
                                            unsigned argNo,
                                            llvm::DebugLoc loc) const;

  /// Return additional sources implied by a call that has already been
  /// classified as a source. For example, the bit-argument of
  /// virtio_has_feature is also a source so that self-check rules are emitted.
  std::vector<SemanticSource> extraSourcesForCall(llvm::CallBase *CB,
                                                  const SemanticSource &base) const;

  /// For source IDs that have a guaranteed protocol-level sink but no visible
  /// IR dataflow in this build, return that modeled sink.
  llvm::Optional<SemanticSink> modeledSinkForSourceId(const std::string &id) const;

private:
  llvm::Optional<SemanticSource>
  matchConfigGetLoad(llvm::LoadInst *LI, const std::string &functionName,
                     llvm::DebugLoc loc) const;

private:
  std::vector<SourceSchema> schemas_;
  std::map<std::pair<std::string, unsigned>, SourceSchema> structFieldSchemas_;
  std::map<std::string, std::vector<std::pair<unsigned, SourceSchema>>>
      argSchemas_;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_SOURCECATALOG_H
