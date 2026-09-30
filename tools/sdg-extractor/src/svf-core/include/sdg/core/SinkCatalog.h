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
