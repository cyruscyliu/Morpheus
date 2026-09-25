#ifndef SDG_CORE_SINKCATALOG_H
#define SDG_CORE_SINKCATALOG_H

#include "sdg/core/SemanticSink.h"
#include "llvm/ADT/Optional.h"
#include <vector>

namespace llvm {
class CallBase;
} // namespace llvm

namespace sdg {
namespace core {

/// Maps kernel API names to semantic sink roles.
class SinkCatalog {
public:
  SinkCatalog();

  void registerDefaultSinks();

  /// Normalize a function name (strip _noprof, .NNN clones, llvm. prefixes).
  static std::string normalizeName(llvm::StringRef name);

  /// Return all semantic sinks matched by this call. Multiple arguments may
  /// be sinks for the same function (e.g. memcpy src/dst/size).
  std::vector<SemanticSink> match(const llvm::CallBase *CB) const;

  /// True if the given function argument position is registered as a sink.
  bool isArgumentSink(llvm::StringRef functionName, unsigned argNo) const;

  /// For functions that are safe and not analyzed in the bitcode, return
  /// semantic-equivalent sinks that should also be reported (e.g.
  /// virtqueue_add_sgs internally calls dma_map_sg_attrs).
  std::vector<SemanticSink> modeledSinks(const SemanticSink &sink) const;

private:
  struct Entry {
    std::string function;
    unsigned argIndex;
    Role role;
  };
  std::vector<Entry> entries_;
};

} // namespace core
} // namespace sdg

#endif // SDG_CORE_SINKCATALOG_H
