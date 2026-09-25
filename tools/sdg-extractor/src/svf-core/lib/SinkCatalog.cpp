#include "sdg/core/SinkCatalog.h"
#include "llvm/IR/Instructions.h"
#include <regex>

using namespace llvm;
using namespace sdg::core;

SinkCatalog::SinkCatalog() { registerDefaultSinks(); }

void SinkCatalog::registerDefaultSinks() {
  // Allocation sinks (normalizeName maps __kmalloc -> kmalloc, __skb_put ->
  // skb_put, and strips _noprof / _node / clone suffixes).
  entries_.push_back({"kmalloc", 0, Role::Size});
  entries_.push_back({"kzalloc", 0, Role::Size});
  entries_.push_back({"devm_kzalloc", 1, Role::Size});
  entries_.push_back({"kvzalloc", 0, Role::Size});
  entries_.push_back({"kvcalloc", 1, Role::Size});
  entries_.push_back({"alloc_page", 0, Role::Size});
  entries_.push_back({"alloc_pages", 1, Role::Size});
  entries_.push_back({"alloc_pages_exact", 0, Role::Size});
  entries_.push_back({"kmemdup", 1, Role::Size});
  entries_.push_back({"kstrndup", 1, Role::Size});
  entries_.push_back({"kvmalloc", 0, Role::Size});
  entries_.push_back({"kvzalloc", 0, Role::Size});
  entries_.push_back({"kvcalloc", 0, Role::Size});
  entries_.push_back({"kvcalloc", 1, Role::Size});
  entries_.push_back({"devm_kmemdup", 1, Role::Size});

  // DMA / virtqueue mapping sinks
  entries_.push_back({"dma_map_sg_attrs", 2, Role::Size});
  entries_.push_back({"dma_map_page_attrs", 3, Role::Size});
  entries_.push_back({"dma_map_single_attrs", 2, Role::Size});
  entries_.push_back({"vring_map_one_sg", 3, Role::Size});
  entries_.push_back({"vring_map_single", 2, Role::Size});
  entries_.push_back({"virtqueue_map_single_attrs", 2, Role::Size});
  entries_.push_back({"vring_mapping_error", 1, Role::Address});

  // Memory / network sinks
  entries_.push_back({"memcpy", 1, Role::Address});
  entries_.push_back({"memcpy", 2, Role::Size});
  entries_.push_back({"memmove", 2, Role::Size});
  entries_.push_back({"memset", 2, Role::Size});
  entries_.push_back({"netdev_rss_key_fill", 0, Role::Address});
  entries_.push_back({"netdev_rss_key_fill", 1, Role::Size});
  entries_.push_back({"strscpy", 0, Role::Address});
  entries_.push_back({"strscpy", 2, Role::Size});
  entries_.push_back({"strlcpy", 0, Role::Address});
  entries_.push_back({"strlcpy", 2, Role::Size});
  entries_.push_back({"strncpy", 0, Role::Address});
  entries_.push_back({"strncpy", 2, Role::Size});
  entries_.push_back({"eth_hw_addr_set", 1, Role::Address});
  entries_.push_back({"skb_put", 1, Role::Size});
  entries_.push_back({"__skb_put", 1, Role::Size});
  entries_.push_back({"skb_put_data", 0, Role::Address});
  entries_.push_back({"skb_put_data", 1, Role::Size});
  entries_.push_back({"netdev_alloc_skb", 1, Role::Size});
  entries_.push_back({"napi_alloc_skb", 1, Role::Size});
  entries_.push_back({"skb_copy", 1, Role::Size});
  entries_.push_back({"skb_copy_expand", 1, Role::Size});
  entries_.push_back({"skb_copy_expand", 2, Role::Size});
  entries_.push_back({"skb_realloc", 1, Role::Size});
  entries_.push_back({"netif_carrier_on", 0, Role::Control});
  entries_.push_back({"netif_carrier_off", 0, Role::Control});
  entries_.push_back({"virtqueue_poll", 1, Role::Control});

  // MMIO / config output and input
  entries_.push_back({"writel", 0, Role::Value});
  entries_.push_back({"writeb", 0, Role::Value});
  entries_.push_back({"writew", 0, Role::Value});
  entries_.push_back({"readl", 0, Role::Address});
  entries_.push_back({"readb", 0, Role::Address});
  entries_.push_back({"readw", 0, Role::Address});

  // Virtqueue / DMA helpers where guest values are consumed
  entries_.push_back({"cpu_to_virtio16", 1, Role::Value});
  entries_.push_back({"cpu_to_virtio32", 1, Role::Value});
  entries_.push_back({"cpu_to_virtio64", 1, Role::Value});
  entries_.push_back({"virtio16_to_cpu", 1, Role::Value});
  entries_.push_back({"virtio32_to_cpu", 1, Role::Value});
  entries_.push_back({"virtio64_to_cpu", 1, Role::Value});
  entries_.push_back({"virtqueue_add_sgs", 0, Role::Control});
  entries_.push_back({"virtqueue_add_sgs", 2, Role::Size});
  entries_.push_back({"virtqueue_add_sgs", 3, Role::Size});
  entries_.push_back({"virtqueue_map_page_attrs", 1, Role::Size});
  entries_.push_back({"virtqueue_map_page_attrs", 3, Role::Size});
  entries_.push_back({"virtqueue_map_single_attrs", 2, Role::Size});
  entries_.push_back({"dma_map_sg_attrs", 2, Role::Size});
  entries_.push_back({"dma_map_page_attrs", 3, Role::Size});
  entries_.push_back({"detach_buf_split", 1, Role::Index});
  entries_.push_back({"detach_buf_split_in_order", 1, Role::Index});
  entries_.push_back({"vring_mapping_error", 1, Role::Address});

  // Allocation sinks
  entries_.push_back({"alloc_page", 0, Role::Size});
  entries_.push_back({"alloc_etherdev_mqs", 2, Role::Size});
  entries_.push_back({"alloc_etherdev_mqs", 3, Role::Size});
  entries_.push_back({"eth_hw_addr_set", 1, Role::Address});
  entries_.push_back({"virtnet_set_big_packets", 1, Role::Size});

  // Feature sink
  entries_.push_back({"virtio_has_feature", 1, Role::FeatureBit});
}

std::string SinkCatalog::normalizeName(StringRef name) {
  std::string s = name.str();
  // Strip _noprof / _node suffixes.
  for (const char *suffix : {"_noprof", "_node"}) {
    if (s.size() > strlen(suffix) &&
        s.compare(s.size() - strlen(suffix), strlen(suffix), suffix) == 0) {
      s.resize(s.size() - strlen(suffix));
    }
  }
  // Strip LLVM clone suffix .NNN.
  s = std::regex_replace(s, std::regex(R"(\.\d+$)"), "");
  // Normalize kmalloc / skb_put wrappers so rules use the public name.
  if (s == "__kmalloc" || s == "__kmalloc_cache")
    return "kmalloc";
  if (s == "__skb_put")
    return "skb_put";
  // Normalize LLVM memory intrinsics.
  if (s.find("llvm.memcpy.") == 0)
    return "memcpy";
  if (s.find("llvm.memmove.") == 0)
    return "memmove";
  if (s.find("llvm.memset.") == 0)
    return "memset";
  return s;
}

std::vector<SemanticSink> SinkCatalog::match(const CallBase *CB) const {
  std::vector<SemanticSink> out;
  Function *callee = CB->getCalledFunction();
  if (!callee)
    return out;
  std::string base = normalizeName(callee->getName());

  // Explicit entries first.
  for (const auto &e : entries_) {
    if (e.function == base && e.argIndex < CB->arg_size())
      out.push_back(SemanticSink{e.function, e.role, e.argIndex, CB});
  }
  if (!out.empty())
    return out;

  // Pattern fallback: catch allocation / memcpy / DMA / MMIO / network
  // variants that are not explicitly listed. Only semantically-relevant
  // argument indices are registered, which cuts FP while keeping recall high.
  struct Pattern {
    const char *prefix;
    std::vector<unsigned> argIndices;
    Role role;
  };
  static const Pattern kPatterns[] = {
      // Allocation: size argument(s).
      {"kmalloc_array", {0, 1}, Role::Size},
      {"kcalloc_node", {0, 1}, Role::Size},
      {"kmalloc_node", {0}, Role::Size},
      {"kzalloc_node", {0}, Role::Size},
      {"kmemdup", {1}, Role::Size},
      {"kstrndup", {1}, Role::Size},
      {"kvmalloc", {0}, Role::Size},
      {"kvzalloc", {0}, Role::Size},
      {"kvcalloc", {0, 1}, Role::Size},
      {"__kmalloc", {0}, Role::Size},
      {"kmalloc", {0}, Role::Size},
      {"kzalloc", {0}, Role::Size},
      {"kcalloc", {0, 1}, Role::Size},
      {"devm_kcalloc", {1, 2}, Role::Size},
      {"devm_kzalloc", {1}, Role::Size},
      {"devm_kmalloc", {1}, Role::Size},
      {"devm_kmemdup", {1}, Role::Size},
      {"alloc_pages_exact", {0}, Role::Size},
      {"alloc_pages", {0}, Role::Size},
      {"alloc_page", {0}, Role::Size},
      {"alloc_etherdev", {2, 3}, Role::Size},
      {"alloc_netdev", {3, 4}, Role::Size},
      // Memory copy/set: the size/count argument.
      {"__copy_to_user", {2}, Role::Size},
      {"__copy_from_user", {2}, Role::Size},
      {"copy_to_user", {2}, Role::Size},
      {"copy_from_user", {2}, Role::Size},
      {"strscpy", {2}, Role::Size},
      {"strlcpy", {2}, Role::Size},
      {"strncpy", {2}, Role::Size},
      {"memmove", {2}, Role::Size},
      {"memcpy", {2}, Role::Size},
      {"memset", {2}, Role::Size},
      // DMA: the size / nents argument.
      {"pci_map_sg", {2}, Role::Size},
      {"dma_map_sg", {2}, Role::Size},
      {"pci_map_single", {2}, Role::Size},
      {"pci_map_page", {3}, Role::Size},
      {"dma_map_resource", {2}, Role::Size},
      {"dma_map_single", {2}, Role::Size},
      {"dma_map_page", {3}, Role::Size},
      // Network: the length / headroom argument.
      {"netdev_alloc_skb", {1}, Role::Size},
      {"napi_alloc_skb", {1}, Role::Size},
      {"skb_copy_expand", {1, 2}, Role::Size},
      {"skb_realloc", {1}, Role::Size},
      {"skb_copy", {1}, Role::Size},
      {"skb_put", {1}, Role::Size},
      // Virtqueue: the scatter/gather count.
      {"virtqueue_add", {2, 3}, Role::Size},
      {"vring_add", {2, 3}, Role::Size},
      {"vring_create", {1}, Role::Size},
      {"virtqueue_resize", {1}, Role::Size},
      // Control / MMIO output.
      {"virtqueue_kick", {0}, Role::Control},
      {"virtqueue_notify", {0}, Role::Control},
      {"netif_carrier_off", {0}, Role::Control},
      {"netif_carrier_on", {0}, Role::Control},
      {"writeq", {0}, Role::Value},
      {"writel", {0}, Role::Value},
      {"writew", {0}, Role::Value},
      {"writeb", {0}, Role::Value},
  };

  for (const auto &pat : kPatterns) {
    if (base.find(pat.prefix) != std::string::npos) {
      for (unsigned idx : pat.argIndices)
        if (idx < CB->arg_size())
          out.push_back(SemanticSink{base, pat.role, idx, CB});
      return out;
    }
  }
  return out;
}

bool SinkCatalog::isArgumentSink(llvm::StringRef functionName,
                                 unsigned argNo) const {
  std::string base = normalizeName(functionName);
  for (const auto &e : entries_)
    if (e.function == base && e.argIndex == argNo)
      return true;
  return false;
}

std::vector<SemanticSink>
SinkCatalog::modeledSinks(const SemanticSink &sink) const {
  std::vector<SemanticSink> out;
  using Key = std::pair<std::string, unsigned>;
  static const std::vector<std::pair<Key, SemanticSink>> kModeled = {
      // virtqueue_add_sgs() internally calls dma_map_sg_attrs() with the
      // scatterlist count as the size argument.
      {{"virtqueue_add_sgs", 2},
       SemanticSink{"dma_map_sg_attrs", Role::Size, 2, nullptr}},
      {{"virtqueue_add_sgs", 3},
       SemanticSink{"dma_map_sg_attrs", Role::Size, 2, nullptr}},
      // eth_hw_addr_set() copies the MAC address, semantically a memcpy.
      {{"eth_hw_addr_set", 1},
       SemanticSink{"memcpy", Role::Address, 1, nullptr}},
      // alloc_etherdev_mqs() allocates memory keyed by queue count.
      {{"alloc_etherdev_mqs", 2},
       SemanticSink{"kzalloc", Role::Size, 0, nullptr}},
      {{"alloc_etherdev_mqs", 3},
       SemanticSink{"kzalloc", Role::Size, 0, nullptr}},
      // virtnet_set_big_packets() influences page allocation for large MTU.
      {{"virtnet_set_big_packets", 1},
       SemanticSink{"alloc_page", Role::Size, 0, nullptr}},
      // virtqueue_poll() passes the used index to the VIRTQUEUE_CALL notify.
      {{"virtqueue_poll", 1},
       SemanticSink{"VIRTQUEUE_CALL", Role::Control, 1, nullptr}},
  };

  Key key{sink.function, sink.argIndex};
  for (const auto &kv : kModeled)
    if (kv.first == key)
      out.push_back(kv.second);
  return out;
}
