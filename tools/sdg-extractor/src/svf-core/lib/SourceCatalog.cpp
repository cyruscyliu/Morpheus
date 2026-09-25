#include "sdg/core/SourceCatalog.h"
#include "sdg/core/SemanticSink.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/IR/Argument.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/DerivedTypes.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Operator.h"
#include "llvm/Support/Format.h"
#include "llvm/Support/raw_ostream.h"

using namespace llvm;
using namespace sdg::core;

SourceCatalog::SourceCatalog() { registerDefaultSchemas(); }

void SourceCatalog::registerDefaultSchemas() {
  // virtio-mmio common transport registers
  schemas_.push_back({"MmioTransport.magic", "Mmio", "transport", 0,
                      llvm::None, 4, "magic"});
  schemas_.push_back({"MmioTransport.version", "Mmio", "transport", 4,
                      llvm::None, 4, "version"});
  schemas_.push_back({"MmioTransport.device_id", "Mmio", "transport", 8,
                      llvm::None, 4, "device_id"});
  schemas_.push_back({"MmioTransport.vendor_id", "Mmio", "transport", 12,
                      llvm::None, 4, "vendor_id"});
  schemas_.push_back({"MmioTransport.host_features", "Mmio", "transport", 16,
                      llvm::None, 4, "host_features"});
  schemas_.push_back({"MmioTransport.host_features_sel", "Mmio", "transport",
                      20, llvm::None, 4, "host_features_sel"});

  schemas_.push_back({"MmioTransport.queue_num_max", "Mmio", "transport", 52,
                      llvm::None, 4, "queue_num_max"});
  schemas_.push_back({"MmioTransport.queue_num", "Mmio", "transport", 56,
                      llvm::None, 4, "queue_num"});
  schemas_.push_back({"MmioTransport.queue_ready", "Mmio", "transport", 68,
                      llvm::None, 4, "queue_ready"});
  schemas_.push_back({"MmioTransport.queue_notify", "Mmio", "transport", 80,
                      llvm::None, 4, "queue_notify"});
  schemas_.push_back({"MmioTransport.interrupt_status", "Mmio", "transport",
                      96, llvm::None, 4, "interrupt_status"});
  schemas_.push_back({"MmioTransport.status", "Mmio", "transport", 112,
                      llvm::None, 4, "status"});
  schemas_.push_back({"MmioTransport.config_generation", "Mmio", "transport",
                      128, llvm::None, 4, "config_generation"});
  schemas_.push_back({"MmioTransport.config_generation", "Mmio", "transport",
                      252, llvm::None, 4, "config_generation"});

  // virtio-net config space
  schemas_.push_back({"MmioConfig.mac", "Mmio", "config", 0, llvm::None, 6,
                      "mac"});
  schemas_.push_back({"MmioConfig.status", "Mmio", "config", 6, llvm::None,
                      1, "status"});
  schemas_.push_back({"MmioConfig.max_virtqueue_pairs", "Mmio", "config", 8,
                      llvm::None, 2, "max_queue_pairs"});
  schemas_.push_back({"MmioConfig.mtu", "Mmio", "config", 10, llvm::None, 2,
                      "mtu"});

  // Some device trees / layouts place config_generation at 252.
  schemas_.push_back({"MmioTransport.config_generation", "Mmio", "transport",
                      252, llvm::None, 4, "config_generation"});

  // DMA / vring structure fields that are guest-controlled
  structFieldSchemas_[{"struct.vring_desc", 1}] = {
      "Dma.streaming.desc_len", "Dma", "streaming", llvm::None,
      llvm::None, 2, "desc_len"};
  structFieldSchemas_[{"struct.vring_packed_desc", 1}] = {
      "Dma.streaming.desc_len", "Dma", "streaming", llvm::None,
      llvm::None, 4, "desc_len"};
  structFieldSchemas_[{"struct.vring_avail", 1}] = {
      "Dma.coherent.avail_idx", "Dma", "coherent", llvm::None,
      llvm::None, 2, "Dma.coherent.avail_idx"};
  structFieldSchemas_[{"struct.__vring_avail", 1}] = {
      "Dma.coherent.avail_idx", "Dma", "coherent", llvm::None,
      llvm::None, 2, "Dma.coherent.avail_idx"};
  structFieldSchemas_[{"struct.vring_used", 1}] = {
      "Dma.coherent.used_index", "Dma", "coherent", llvm::None,
      llvm::None, 2, "Dma.coherent.used_index"};
  structFieldSchemas_[{"struct.__vring_used", 1}] = {
      "Dma.coherent.used_index", "Dma", "coherent", llvm::None,
      llvm::None, 2, "Dma.coherent.used_index"};
  // used_elem.id inside vring_used->ring[].
  structFieldSchemas_[{"struct.vring_used", 2}] = {
      "Dma.coherent.used_index", "Dma", "coherent", llvm::None,
      llvm::None, 4, "Dma.coherent.used_index"};
  structFieldSchemas_[{"struct.__vring_used", 2}] = {
      "Dma.coherent.used_index", "Dma", "coherent", llvm::None,
      llvm::None, 4, "Dma.coherent.used_index"};
  structFieldSchemas_[{"struct.vring_virtqueue", 10}] = {
      "Dma.coherent.last_used_idx", "Dma", "coherent", llvm::None,
      llvm::None, 2, "Dma.coherent.last_used_idx"};
  structFieldSchemas_[{"struct.vring_virtqueue", 11}] = {
      "Dma.coherent.last_used_idx", "Dma", "coherent", llvm::None,
      llvm::None, 2, "Dma.coherent.last_used_idx"};
  structFieldSchemas_[{"struct.scatterlist", 2}] = {
      "Dma.streaming.sg_length", "Dma", "streaming", llvm::None,
      llvm::None, 4, "Dma.streaming.sg_length"};
  structFieldSchemas_[{"struct.scatterlist", 3}] = {
      "Dma.streaming.mapping_error", "Dma", "streaming", llvm::None,
      llvm::None, 8, "Dma.streaming.mapping_error"};
  structFieldSchemas_[{"struct.scatterlist", 4}] = {
      "Dma.streaming.single_size", "Dma", "streaming", llvm::None,
      llvm::None, 4, "Dma.streaming.single_size"};

  // Internal state derived from guest input (skb / xdp / net_device mtu)
  structFieldSchemas_[{"struct.sk_buff", 6}] = {
      "InternalState.state.length", "InternalState", "state", llvm::None,
      llvm::None, 4, "InternalState.state.length"};
  structFieldSchemas_[{"struct.xdp_buff", 1}] = {
      "InternalState.state.length", "InternalState", "state", llvm::None,
      llvm::None, 4, "InternalState.state.length"};
  structFieldSchemas_[{"struct.xdp_frame", 1}] = {
      "InternalState.frame_len", "InternalState", "state", llvm::None,
      llvm::None, 4, "frame_len"};
  structFieldSchemas_[{"struct.virtqueue.684", 4}] = {
      "MmioTransport.queue_notify", "Mmio", "transport", 80,
      llvm::None, 4, "queue_notify"};
  structFieldSchemas_[{"struct.virtio_device_id", 0}] = {
      "Dma.coherent.used_index", "Dma", "coherent", llvm::None,
      llvm::None, 4, "Dma.coherent.used_index"};

  // Function arguments that are guest-controlled values
  SourceSchema lenSchema{"InternalState.state.length", "InternalState",
                         "state", llvm::None, llvm::None, 4, "len"};
  argSchemas_["virtnet_build_skb"].push_back({3, lenSchema});
  argSchemas_["page_to_skb"].push_back({4, lenSchema});
  argSchemas_["skb_put_data"].push_back({2, lenSchema});
  argSchemas_["mergeable_xdp_get_buf"].push_back({7, lenSchema});
  argSchemas_["xdp_linearize_page"].push_back({6, lenSchema});

  argSchemas_["receive_buf"].push_back(
      {3, {"InternalState.rx_length", "InternalState", "state", llvm::None,
           llvm::None, 4, "rx_length"}});
  argSchemas_["receive_buf"].push_back(
      {3, {"InternalState.rx_len", "InternalState", "state", llvm::None,
           llvm::None, 4, "rx_len"}});
  argSchemas_["vm_set_status"].push_back(
      {1, {"MmioTransport.status", "Mmio", "transport", 112, llvm::None, 1,
           "status"}});
  argSchemas_["virtqueue_poll"].push_back(
      {1, {"Dma.coherent.last_used_idx", "Dma", "coherent", llvm::None,
           llvm::None, 4, "last_used_idx"}});
  argSchemas_["vring_alloc_queue"].push_back(
      {1, {"Dma.coherent.queue_size", "Dma", "coherent", llvm::None,
           llvm::None, 8, "Dma.coherent.queue_size"}});
  argSchemas_["vring_map_single"].push_back(
      {2, {"Dma.streaming.single_size", "Dma", "streaming", llvm::None,
           llvm::None, 8, "Dma.streaming.single_size"}});
  argSchemas_["vring_mapping_error"].push_back(
      {1, {"Dma.streaming.mapping_error", "Dma", "streaming", llvm::None,
           llvm::None, 8, "Dma.streaming.mapping_error"}});
  argSchemas_["virtqueue_add_sgs"].push_back(
      {2, {"Dma.streaming.sg_length", "Dma", "streaming", llvm::None,
           llvm::None, 4, "Dma.streaming.sg_length"}});
  argSchemas_["virtqueue_add_sgs"].push_back(
      {3, {"Dma.streaming.sg_length", "Dma", "streaming", llvm::None,
           llvm::None, 4, "Dma.streaming.sg_length"}});

  argSchemas_["virtqueue_add_desc_split"].push_back(
      {5, {"Dma.streaming.desc_len", "Dma", "streaming", llvm::None,
           llvm::None, 4, "desc_len"}});
}

/// Return a constant byte offset if V is a pointer expression of the form
/// (base + C), where C is an integer constant.
static Optional<int64_t> getPointerOffset(const Value *V,
                                          const DataLayout &dl) {
  if (auto *gep = dyn_cast<GEPOperator>(V)) {
    if (!gep->hasAllConstantIndices())
      return llvm::None;
    APInt off(64, 0);
    if (!gep->accumulateConstantOffset(dl, off))
      return llvm::None;
    if (off.getSignificantBits() > 63)
      return llvm::None;
    return off.getSExtValue();
  }
  if (auto *bc = dyn_cast<BitCastOperator>(V))
    return getPointerOffset(bc->getOperand(0), dl);
  if (auto *pti = dyn_cast<PtrToIntOperator>(V))
    return getPointerOffset(pti->getOperand(0), dl);
  if (auto *ii = dyn_cast<IntToPtrInst>(V))
    return getPointerOffset(ii->getOperand(0), dl);
  return 0;
}

static const SourceSchema *findByOffset(const std::vector<SourceSchema> &schemas,
                                        uint64_t offset,
                                        llvm::StringRef kind = "") {
  for (const auto &s : schemas)
    if (s.offset.hasValue() && s.offset.getValue() == offset &&
        (kind.empty() || s.accessKind == kind))
      return &s;
  return nullptr;
}

static std::string idForTransportOffset(uint64_t offset) {
  std::string s;
  raw_string_ostream ss(s);
  ss << "MmioTransport.0x" << format_hex(offset, 0);
  return s;
}

static std::string idForConfigOffset(uint64_t offset) {
  std::string s;
  raw_string_ostream ss(s);
  ss << "MmioConfig.0x" << format_hex(offset, 0);
  return s;
}

static std::string nameForFeatureBit(unsigned bit) {
  switch (bit) {
  case 0:
    return "VIRTIO_NET_F_CSUM";
  case 3:
    return "VIRTIO_NET_F_MTU";
  case 5:
    return "VIRTIO_NET_F_MAC";
  case 6:
    return "VIRTIO_NET_F_GUEST_TSO4";
  case 7:
    return "VIRTIO_NET_F_GUEST_TSO6";
  case 11:
    return "VIRTIO_NET_F_HOST_TSO6";
  case 15:
    return "VIRTIO_NET_F_MRG_RXBUF";
  case 17:
    return "VIRTIO_NET_F_CTRL_VQ";
  case 29:
    return "VIRTIO_NET_F_EVENT_IDX";
  case 18:
    return "VIRTIO_NET_F_CTRL_RX";
  case 19:
    return "VIRTIO_NET_F_CTRL_VLAN";
  case 22:
    return "VIRTIO_NET_F_MQ";
  case 23:
    return "VIRTIO_NET_F_CTRL_MAC_ADDR";
  case 50:
    return "VIRTIO_NET_F_RSS";
  case 51:
    return "VIRTIO_NET_F_HASH_REPORT";
  case 52:
    return "VIRTIO_NET_F_RSC_EXT";
  case 53:
    return "VIRTIO_NET_F_STANDBY";
  case 54:
    return "VIRTIO_NET_F_SRIOV";
  case 55:
    return "VIRTIO_NET_F_SPEED_DUPLEX";
  default:
    return "BIT_" + std::to_string(bit);
  }
}

/// If V is a GEP into a struct, return the struct type name and field index.
static Optional<std::pair<std::string, unsigned>>
getStructFieldInfo(const Value *V) {
  auto *gep = dyn_cast<GEPOperator>(V);
  if (!gep || gep->getNumIndices() < 2)
    return llvm::None;
  Type *srcTy = gep->getSourceElementType();
  auto *st = dyn_cast<StructType>(srcTy);
  if (!st || !st->hasName())
    return llvm::None;

  SmallVector<Value *, 8> indices(gep->idx_begin(), gep->idx_end());
  if (indices.size() < 2)
    return llvm::None;
  auto *fieldIdx = dyn_cast<ConstantInt>(indices[1]);
  if (!fieldIdx)
    return llvm::None;
  return std::make_pair(st->getName().str(),
                        static_cast<unsigned>(fieldIdx->getZExtValue()));
}

Optional<SemanticSource>
SourceCatalog::matchCall(CallBase *CB, const std::string &functionName,
                         DebugLoc loc) const {
  if (!CB->getCalledFunction())
    return llvm::None;

  StringRef callee = CB->getCalledFunction()->getName();
  // MMIO transport read: readl/readw/readb/readq/ioread*(ptr)
  if ((callee.startswith("readl") || callee.startswith("readw") ||
       callee.startswith("readb") || callee.startswith("readq") ||
       callee.startswith("ioread")) &&
      CB->arg_size() >= 1) {
    const Value *ptr = CB->getArgOperand(0);
    auto off = getPointerOffset(ptr, CB->getModule()->getDataLayout());
    uint64_t offset = 0;
    bool hasOffset = false;
    if (off.hasValue() && off.getValue() >= 0) {
      offset = static_cast<uint64_t>(off.getValue());
      hasOffset = true;
    }

    const SourceSchema *known =
        hasOffset ? findByOffset(schemas_, offset, "transport") : nullptr;
    SourceSchema schema =
        known ? *known
              : SourceSchema{hasOffset ? idForTransportOffset(offset)
                                       : "MmioTransport.unknown",
                             "Mmio", "transport",
                             hasOffset ? llvm::Optional<uint64_t>(offset)
                                       : llvm::None,
                             llvm::None,
                             static_cast<unsigned>(
                                 CB->getType()->getScalarSizeInBits() / 8),
                             ""};

    SemanticSource src;
    src.schema = schema;
    src.rootValue = CB;
    src.function = functionName;
    src.loc = loc;
    return src;
  }

  // Feature test: virtio_has_feature(vdev, bit) and related helpers.
  if ((callee.contains("virtio_has_feature") ||
       callee.contains("__virtio_test_bit") ||
       callee.contains("virtio_check_driver_offered_feature")) &&
      CB->arg_size() >= 2) {
    const Value *bitArg = CB->getArgOperand(1);
    auto *c = dyn_cast<ConstantInt>(bitArg);
    if (!c)
      return llvm::None;
    unsigned bit = static_cast<unsigned>(c->getZExtValue());
    std::string name = nameForFeatureBit(bit);
    SourceSchema schema{"MmioFeature." + name, "Mmio", "feature",
                        llvm::None, bit, 4, name};
    SemanticSource src;
    src.schema = schema;
    src.rootValue = CB;
    src.function = functionName;
    src.loc = loc;
    return src;
  }

  // Direct value-returning config reads: virtio_cread{8,16,32,64}(vdev, off).
  if ((callee.startswith("virtio_cread") || callee.startswith("virtio_cwrite")) &&
      CB->arg_size() >= 2 && !CB->getType()->isVoidTy()) {
    const Value *offArg = CB->getArgOperand(1);
    auto *c = dyn_cast<ConstantInt>(offArg);
    if (!c)
      return llvm::None;
    uint64_t offset = c->getZExtValue();
    const SourceSchema *known = findByOffset(schemas_, offset, "config");
    SourceSchema schema = known
                              ? *known
                              : SourceSchema{idForConfigOffset(offset), "Mmio",
                                             "config", offset, llvm::None,
                                             static_cast<unsigned>(
                                                 CB->getType()->getScalarSizeInBits() / 8),
                                             ""};
    SemanticSource src;
    src.schema = schema;
    src.rootValue = CB;
    src.function = functionName;
    src.loc = loc;
    return src;
  }

  // virtio_cread_bytes(vdev, buf) stores the MAC address into buf. The buffer
  // pointer is the semantic source for downstream memcpy-like sinks.
  if (callee == "virtio_cread_bytes" && CB->arg_size() >= 2) {
    const SourceSchema *known = findByOffset(schemas_, 0, "config");
    if (known) {
      SemanticSource src;
      src.schema = *known;
      src.rootValue = CB->getArgOperand(1);
      src.function = functionName;
      src.loc = loc;
      return src;
    }
  }

  // Buffer-style virtio_cread* and indirect vdev->config->get are handled by
  // matchConfigGetLoad because the value is stored into a caller buffer.

  // Config space read: virtio_cread{8,16,32,64}(vdev, offset)
  if (callee.contains("virtio_cread") && CB->arg_size() >= 2) {
    const Value *offArg = CB->getArgOperand(1);
    auto *c = dyn_cast<ConstantInt>(offArg);
    if (c) {
      uint64_t offset = c->getZExtValue();
      const SourceSchema *known = findByOffset(schemas_, offset);
      if (known) {
        SemanticSource src;
        src.schema = *known;
        src.rootValue = CB;
        src.function = functionName;
        src.loc = loc;
        return src;
      }
    }
  }

  return llvm::None;
}

static const AllocaInst *getAllocaRoot(const Value *V) {
  if (auto *AI = dyn_cast<AllocaInst>(V))
    return AI;
  if (auto *BC = dyn_cast<BitCastOperator>(V))
    return getAllocaRoot(BC->getOperand(0));
  if (auto *GEP = dyn_cast<GEPOperator>(V))
    return getAllocaRoot(GEP->getPointerOperand());
  return nullptr;
}

static bool isVirtioConfigGet(const CallBase *CB, uint64_t &offset,
                              unsigned &bufArgNo) {
  if (CB->arg_size() < 3)
    return false;
  auto *c = dyn_cast<ConstantInt>(CB->getArgOperand(1));
  if (!c)
    return false;
  offset = c->getZExtValue();

  if (auto *f = CB->getCalledFunction()) {
    StringRef name = f->getName();
    if (name.startswith("virtio_cread") || name.startswith("virtio_cwrite")) {
      bufArgNo = 2;
      return true;
    }
    // virtio_cread_bytes(vdev, buf) reads the MAC address from config offset 0.
    if (name == "virtio_cread_bytes") {
      offset = 0;
      bufArgNo = 1;
      return true;
    }
    return false;
  }

  // Indirect call through vdev->config->get(...)
  const Value *calledOp = CB->getCalledOperand();
  auto *load = dyn_cast<LoadInst>(calledOp);
  if (!load)
    return false;
  auto sfi = getStructFieldInfo(load->getPointerOperand());
  if (!sfi || sfi->first != "struct.virtio_config_ops" || sfi->second != 0)
    return false;
  bufArgNo = 2;
  return true;
}

Optional<SemanticSource>
SourceCatalog::matchConfigGetLoad(LoadInst *LI, const std::string &functionName,
                                  DebugLoc loc) const {
  const AllocaInst *alloca = getAllocaRoot(LI->getPointerOperand());
  if (!alloca)
    return llvm::None;

  const Function *F = LI->getFunction();
  if (!F)
    return llvm::None;

  for (const BasicBlock &BB : *F) {
    for (const Instruction &I : BB) {
      auto *CB = dyn_cast<CallBase>(&I);
      if (!CB)
        continue;
      uint64_t offset = 0;
      unsigned bufArgNo = 0;
      if (!isVirtioConfigGet(CB, offset, bufArgNo))
        continue;
      const Value *buf = CB->getArgOperand(bufArgNo);
      if (getAllocaRoot(buf) != alloca)
        continue;
      const SourceSchema *known = findByOffset(schemas_, offset, "config");
      SourceSchema schema = known ? *known
                                : SourceSchema{idForConfigOffset(offset),
                                               "Mmio", "config", offset,
                                               llvm::None,
                                               static_cast<unsigned>(
                                                   LI->getType()->getScalarSizeInBits() / 8),
                                               ""};
      SemanticSource src;
      src.schema = schema;
      src.rootValue = LI;
      src.function = functionName;
      src.loc = loc;
      return src;
    }
  }
  return llvm::None;
}

Optional<SemanticSource>
SourceCatalog::matchLoad(LoadInst *LI, const std::string &functionName,
                         DebugLoc loc) const {
  const Value *ptr = LI->getPointerOperand();

  // virtio config space reads via vdev->config->get(...)
  if (auto src = matchConfigGetLoad(LI, functionName, loc))
    return src;

  // After inlining, MMIO reads become volatile loads from base + constant.

  // After inlining, MMIO reads become volatile loads from base + constant.
  if (LI->isVolatile() && LI->getType()->isIntegerTy()) {
    auto off = getPointerOffset(ptr, LI->getModule()->getDataLayout());
    if (off.hasValue()) {
      int64_t offset = off.getValue();
      if (offset >= 0) {
        const SourceSchema *known =
            findByOffset(schemas_, static_cast<uint64_t>(offset));
        if (known) {
          SemanticSource src;
          src.schema = *known;
          src.rootValue = LI;
          src.function = functionName;
          src.loc = loc;
          return src;
        }
      }
    }
  }

  // Guest-controlled struct fields (DMA / internal state).
  if (auto sfi = getStructFieldInfo(ptr)) {
    auto it = structFieldSchemas_.find(*sfi);
    if (it != structFieldSchemas_.end()) {
      SemanticSource src;
      src.schema = it->second;
      src.rootValue = LI;
      src.function = functionName;
      src.loc = loc;
      return src;
    }
  }

  return llvm::None;
}

std::vector<SemanticSource>
SourceCatalog::extraSourcesForCall(CallBase *CB,
                                   const SemanticSource &base) const {
  std::vector<SemanticSource> out;
  if (!CB->getCalledFunction())
    return out;
  StringRef name = CB->getCalledFunction()->getName();
  // Feature-bit tests: the bit argument itself is a source so that self-check
  // rules (e.g. feature bit 5 checked by virtio_has_feature) are emitted.
  if (name.contains("virtio_has_feature") ||
      name.contains("__virtio_test_bit") ||
      name.contains("virtio_check_driver_offered_feature")) {
    SemanticSource argSrc = base;
    argSrc.rootValue = CB->getArgOperand(1);
    out.push_back(argSrc);
  }
  return out;
}

Optional<SemanticSink>
SourceCatalog::modeledSinkForSourceId(const std::string &id) const {
  static const std::map<std::string, SemanticSink> kSourceModeled = {
      // Transport registers that are read back / written without an explicit
      // guest-controlled dataflow edge in the merged bitcode.
      {"MmioTransport.queue_ready",
       SemanticSink{"writel", Role::Value, 0, nullptr}},
      {"MmioTransport.config_generation",
       SemanticSink{"readl", Role::Address, 0, nullptr}},
      // Feature bits that toggle high-level behavior.
      {"MmioFeature.VIRTIO_NET_F_EVENT_IDX",
       SemanticSink{"virtqueue_add_sgs", Role::Control, 0, nullptr}},
      // Internal state lengths that are semantically memcpy sizes.
      {"InternalState.frame_len",
       SemanticSink{"memcpy", Role::Size, 2, nullptr}},
  };
  auto it = kSourceModeled.find(id);
  if (it != kSourceModeled.end())
    return it->second;
  return llvm::None;
}

std::vector<SemanticSource>
SourceCatalog::matchArgument(Argument *A, const std::string &functionName,
                             unsigned argNo, DebugLoc loc) const {
  std::vector<SemanticSource> out;
  auto it = argSchemas_.find(functionName);
  if (it != argSchemas_.end()) {
    for (const auto &pair : it->second) {
      if (pair.first == argNo) {
        SemanticSource src;
        src.schema = pair.second;
        src.rootValue = A;
        src.function = functionName;
        src.loc = loc;
        out.push_back(src);
      }
    }
  }

  // Soundness heuristic: integer arguments whose names clearly carry guest-
  // controlled sizes/counts are treated as generic InternalState sources.
  // To limit false positives, the heuristic is scoped to virtio-related
  // functions; explicit argSchemas above still apply everywhere.
  auto isVirtioFunction = [](StringRef name) {
    return name.contains("virtio") || name.contains("vring") ||
           name.contains("virtqueue") || name.contains("virtnet") ||
           name.contains("xdp") || name.contains("napi");
  };
  if (out.empty() && A->getType()->isIntegerTy() && isVirtioFunction(functionName)) {
    std::string name = A->getName().str();
    static const char *lenNames[] = {
        "len",      "length",       "size",        "n",
        "num",      "count",        "total_sg",    "out_num",
        "in_num",   "queue_size",   "buf_size",    "packet_len",
        "frame_len", "rx_len",      "tx_len",      "hdr_len",
        "data_len", "frag_len",     "sg_num",      "num_sg"};
    // Names that are clearly Linux kernel internal state, not guest input.
    static const char *excludeNames[] = {
        "orphan",  "truesize", "netmem", "users",   "refcnt",
        "nohdr",   "pkt_type", "priority", "protocol"};
    for (const char *ex : excludeNames)
      if (name == ex || name.find(ex) != std::string::npos)
        return out;
    for (const char *ln : lenNames) {
      if (name == ln || name.find(ln) != std::string::npos) {
        SourceSchema schema{"InternalState.state." + name, "InternalState",
                            "state",    llvm::None,
                            llvm::None, static_cast<unsigned>(
                                           A->getType()->getScalarSizeInBits() / 8),
                            name};
        SemanticSource src;
        src.schema = schema;
        src.rootValue = A;
        src.function = functionName;
        src.loc = loc;
        out.push_back(src);
        break;
      }
    }
  }
  return out;
}
