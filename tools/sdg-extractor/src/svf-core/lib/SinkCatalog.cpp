#include "sdg/core/SinkCatalog.h"
#include "llvm/IR/Instructions.h"
#include <regex>

using namespace llvm;
using namespace sdg::core;

SinkCatalog::SinkCatalog() { registerDefaultSinks(); }

void SinkCatalog::registerDefaultSinks() {
  // Exact kernel API contracts. Entries identify only operands whose value is
  // a size, count, or index consumed by a memory-sensitive operation. Call
  // edges are never invented here; match() requires an actual LLVM callsite.
  entries_ = {
      {"memcpy", 2, Role::Size},
      {"memmove", 2, Role::Size},
      {"memset", 2, Role::Size},
      {"strscpy", 2, Role::Size},
      {"strlcpy", 2, Role::Size},
      {"strncpy", 2, Role::Size},
      {"kmalloc", 0, Role::Size},
      {"kzalloc", 0, Role::Size},
      {"kcalloc", 0, Role::Size},
      {"kcalloc", 1, Role::Size},
      {"kvmalloc", 0, Role::Size},
      {"kvzalloc", 0, Role::Size},
      {"kvcalloc", 0, Role::Size},
      {"kvcalloc", 1, Role::Size},
      {"devm_kmalloc", 1, Role::Size},
      {"devm_kzalloc", 1, Role::Size},
      {"devm_kcalloc", 1, Role::Size},
      {"devm_kcalloc", 2, Role::Size},
      {"kmemdup", 1, Role::Size},
      {"devm_kmemdup", 2, Role::Size},
      {"kstrndup", 1, Role::Size},
      {"alloc_pages_exact", 0, Role::Size},
      {"skb_put", 1, Role::Size},
      {"skb_put_data", 2, Role::Size},
      {"netdev_alloc_skb", 1, Role::Size},
      {"napi_alloc_skb", 1, Role::Size},
      {"skb_copy_expand", 1, Role::Size},
      {"skb_copy_expand", 2, Role::Size},
      {"dma_map_sg_attrs", 2, Role::Size},
      {"dma_map_page_attrs", 3, Role::Size},
      {"dma_map_single_attrs", 2, Role::Size},
      {"virtqueue_map_page_attrs", 3, Role::Size},
      {"virtqueue_map_single_attrs", 2, Role::Size},
      {"detach_buf_split", 1, Role::Index},
      {"detach_buf_split_in_order", 1, Role::Index},
  };
}

std::string SinkCatalog::normalizeName(StringRef name) {
  std::string normalized = name.str();
  constexpr StringLiteral noProfileSuffix("_noprof");
  if (StringRef(normalized).endswith(noProfileSuffix))
    normalized.resize(normalized.size() - noProfileSuffix.size());
  normalized = std::regex_replace(normalized, std::regex(R"(\.\d+$)"), "");
  if (normalized == "__kmalloc")
    return "kmalloc";
  if (normalized == "__skb_put")
    return "skb_put";
  if (StringRef(normalized).startswith("llvm.memcpy."))
    return "memcpy";
  if (StringRef(normalized).startswith("llvm.memmove."))
    return "memmove";
  if (StringRef(normalized).startswith("llvm.memset."))
    return "memset";
  return normalized;
}

std::vector<SemanticSink> SinkCatalog::match(const CallBase *call) const {
  std::vector<SemanticSink> matches;
  const Function *callee = call->getCalledFunction();
  if (!callee)
    return matches;
  const std::string function = normalizeName(callee->getName());
  for (const Entry &entry : entries_) {
    if (entry.function == function && entry.argIndex < call->arg_size())
      matches.push_back(
          SemanticSink{function, entry.role, entry.argIndex, call});
  }
  return matches;
}
