#include "sdg/core/SourceCatalog.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/DerivedTypes.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Operator.h"

using namespace llvm;
using namespace sdg::core;

namespace {

// Normative protocol source for the tables in this namespace:
// https://docs.oasis-open.org/virtio/virtio/v1.3/virtio-v1.3.html
// Scope: Virtio 1.3, MMIO transport, and the virtio-net device.
// Values below are protocol data, not Linux implementation guesses.
constexpr uint64_t kMmioConfigBase = 0x100;

struct MmioRegisterSpec {
  const char *name;
  uint64_t offset;
  unsigned sizeBytes;
  const char *requiredFeatureA = nullptr;
  const char *requiredFeatureB = nullptr;
};

static StringRef mmioDirection(uint64_t offset) {
  switch (offset) {
  case 0x044:
  case 0x070:
  case 0x0c0:
    return "RW";
  case 0x000:
  case 0x004:
  case 0x008:
  case 0x00c:
  case 0x010:
  case 0x034:
  case 0x060:
  case 0x0b0:
  case 0x0b4:
  case 0x0b8:
  case 0x0bc:
  case 0x0fc:
    return "R";
  default:
    return "W";
  }
}

// Virtio 1.3 section 4.2.2, table "MMIO Device Register Layout", explicitly
// assigns each register offset from the MMIO base. Entries that describe a
// 64-bit value are exposed by the specification as separate Low/High 32-bit
// registers, hence every table entry below has size 4. The final table row
// says device-specific Config starts at 0x100 and supports byte alignment;
// that statement is the source of kMmioConfigBase above.
constexpr MmioRegisterSpec kVirtio13MmioRegisters[] = {
    {"magic_value", 0x000, 4},
    {"version", 0x004, 4},
    {"device_id", 0x008, 4},
    {"vendor_id", 0x00c, 4},
    {"device_features", 0x010, 4},
    {"device_features_sel", 0x014, 4},
    {"driver_features", 0x020, 4},
    {"driver_features_sel", 0x024, 4},
    {"queue_sel", 0x030, 4},
    {"queue_size_max", 0x034, 4},
    {"queue_size", 0x038, 4},
    {"queue_ready", 0x044, 4},
    {"queue_notify", 0x050, 4},
    {"interrupt_status", 0x060, 4},
    {"interrupt_ack", 0x064, 4},
    {"status", 0x070, 4},
    {"queue_desc_low", 0x080, 4},
    {"queue_desc_high", 0x084, 4},
    {"queue_driver_low", 0x090, 4},
    {"queue_driver_high", 0x094, 4},
    {"queue_device_low", 0x0a0, 4},
    {"queue_device_high", 0x0a4, 4},
    {"shm_sel", 0x0ac, 4},
    {"shm_len_low", 0x0b0, 4},
    {"shm_len_high", 0x0b4, 4},
    {"shm_base_low", 0x0b8, 4},
    {"shm_base_high", 0x0bc, 4},
    {"queue_reset", 0x0c0, 4},
    {"config_generation", 0x0fc, 4},
};

// Virtio 1.3 section 5.1.4 gives the ordered virtio_net_config structure:
//   u8 mac[6]; le16 status; le16 max_virtqueue_pairs; le16 mtu;
//   le32 speed; u8 duplex; u8 rss_max_key_size;
//   le16 rss_max_indirection_table_length; le32 supported_hash_types;
//   le32 supported_tunnel_types.
// The specification gives types and order rather than absolute MMIO addresses.
// We infer each address by starting at the section-4.2.2 Config base 0x100 and
// cumulatively adding the preceding field widths. For example, duplex ends at
// 0x110, so the following one-byte rss_max_key_size is at absolute 0x111.
constexpr MmioRegisterSpec kVirtio13NetConfigFields[] = {
    {"mac", 0x100, 6, "VIRTIO_NET_F_MAC"},
    {"status", 0x106, 2, "VIRTIO_NET_F_STATUS"},
    {"max_virtqueue_pairs", 0x108, 2, "VIRTIO_NET_F_MQ", "VIRTIO_NET_F_RSS"},
    {"mtu", 0x10a, 2, "VIRTIO_NET_F_MTU"},
    {"speed", 0x10c, 4, "VIRTIO_NET_F_SPEED_DUPLEX"},
    {"duplex", 0x110, 1, "VIRTIO_NET_F_SPEED_DUPLEX"},
    {"rss_max_key_size", 0x111, 1, "VIRTIO_NET_F_RSS", "VIRTIO_NET_F_HASH_REPORT"},
    {"rss_max_indirection_table_length", 0x112, 2, "VIRTIO_NET_F_RSS"},
    {"supported_hash_types", 0x114, 4, "VIRTIO_NET_F_RSS", "VIRTIO_NET_F_HASH_REPORT"},
    {"supported_tunnel_types", 0x118, 4, "VIRTIO_NET_F_HASH_TUNNEL"},
};

struct FeatureSpec {
  unsigned bit;
  const char *name;
};

// Virtio 1.3 section 2.2 lists transport-independent feature bit numbers.
// Section 4.2.2 says DeviceFeatures at 0x010 returns the 32-bit word selected
// by DeviceFeaturesSel at 0x014. Thus a global feature bit N is physically in
// selector N/32 and has node-local bit N%32; normalization applies that modulo
// after preserving the standardized feature name.
constexpr FeatureSpec kVirtio13CommonFeatures[] = {
    {24, "VIRTIO_F_NOTIFY_ON_EMPTY"},
    {27, "VIRTIO_F_ANY_LAYOUT"},
    {28, "VIRTIO_F_INDIRECT_DESC"},
    {29, "VIRTIO_F_EVENT_IDX"},
    {32, "VIRTIO_F_VERSION_1"},
    {33, "VIRTIO_F_ACCESS_PLATFORM"},
    {34, "VIRTIO_F_RING_PACKED"},
    {35, "VIRTIO_F_IN_ORDER"},
    {36, "VIRTIO_F_ORDER_PLATFORM"},
    {37, "VIRTIO_F_SR_IOV"},
    {38, "VIRTIO_F_NOTIFICATION_DATA"},
    {39, "VIRTIO_F_NOTIF_CONFIG_DATA"},
    {40, "VIRTIO_F_RING_RESET"},
    {41, "VIRTIO_F_ADMIN_VQ"},
};

// Virtio 1.3 section 5.1.3 explicitly assigns these virtio-net feature bits.
// Legacy-only feature aliases are intentionally excluded because this catalog
// models the modern Virtio 1.3 MMIO interface.
constexpr FeatureSpec kVirtio13NetFeatures[] = {
    {0, "VIRTIO_NET_F_CSUM"},
    {1, "VIRTIO_NET_F_GUEST_CSUM"},
    {2, "VIRTIO_NET_F_CTRL_GUEST_OFFLOADS"},
    {3, "VIRTIO_NET_F_MTU"},
    {5, "VIRTIO_NET_F_MAC"},
    {7, "VIRTIO_NET_F_GUEST_TSO4"},
    {8, "VIRTIO_NET_F_GUEST_TSO6"},
    {9, "VIRTIO_NET_F_GUEST_ECN"},
    {10, "VIRTIO_NET_F_GUEST_UFO"},
    {11, "VIRTIO_NET_F_HOST_TSO4"},
    {12, "VIRTIO_NET_F_HOST_TSO6"},
    {13, "VIRTIO_NET_F_HOST_ECN"},
    {14, "VIRTIO_NET_F_HOST_UFO"},
    {15, "VIRTIO_NET_F_MRG_RXBUF"},
    {16, "VIRTIO_NET_F_STATUS"},
    {17, "VIRTIO_NET_F_CTRL_VQ"},
    {18, "VIRTIO_NET_F_CTRL_RX"},
    {19, "VIRTIO_NET_F_CTRL_VLAN"},
    {20, "VIRTIO_NET_F_CTRL_RX_EXTRA"},
    {21, "VIRTIO_NET_F_GUEST_ANNOUNCE"},
    {22, "VIRTIO_NET_F_MQ"},
    {23, "VIRTIO_NET_F_CTRL_MAC_ADDR"},
    {51, "VIRTIO_NET_F_HASH_TUNNEL"},
    {52, "VIRTIO_NET_F_VQ_NOTF_COAL"},
    {53, "VIRTIO_NET_F_NOTF_COAL"},
    {54, "VIRTIO_NET_F_GUEST_USO4"},
    {55, "VIRTIO_NET_F_GUEST_USO6"},
    {56, "VIRTIO_NET_F_HOST_USO"},
    {57, "VIRTIO_NET_F_HASH_REPORT"},
    {59, "VIRTIO_NET_F_GUEST_HDRLEN"},
    {60, "VIRTIO_NET_F_RSS"},
    {61, "VIRTIO_NET_F_RSC_EXT"},
    {62, "VIRTIO_NET_F_STANDBY"},
    {63, "VIRTIO_NET_F_SPEED_DUPLEX"},
};

} // namespace

SourceCatalog::SourceCatalog() { registerDefaultSchemas(); }

void SourceCatalog::setTelemetryEvents(
    std::map<const llvm::Function *, std::vector<TelemetryEvidence>> events) {
  telemetryEvents_ = std::move(events);
}

void SourceCatalog::registerDefaultSchemas() {
  for (const MmioRegisterSpec &reg : kVirtio13MmioRegisters) {
    StringRef direction = mmioDirection(reg.offset);
    // RW registers return driver-owned protocol state (for example Status and
    // QueueReady), so they are not device-controlled input sources.
    if (direction != "R")
      continue;
    SourceSchema schema{std::string("MmioTransport.") + reg.name, "Mmio",
                        "transport", reg.offset, llvm::None, reg.sizeBytes,
                        reg.name};
    schema.direction = direction.str();
    schema.evidence = "virtio-1.3:4.2.2";
    schema.valueType.widthBits = reg.sizeBytes * 8;
    if (reg.offset == 0x004)
      schema.validValues = {2};
    if (reg.offset == 0x060)
      schema.validMask = 0x3;
    schemas_.push_back(std::move(schema));
  }
  for (const MmioRegisterSpec &field : kVirtio13NetConfigFields) {
    SourceSchema schema{std::string("MmioConfig.") + field.name, "Mmio",
                        "config", field.offset, llvm::None, field.sizeBytes,
                        field.name};
    schema.direction = "R";
    schema.valueType.widthBits = field.sizeBytes * 8;
    if (field.requiredFeatureA)
      schema.requiredFeaturesAnyOf.push_back(field.requiredFeatureA);
    if (field.requiredFeatureB)
      schema.requiredFeaturesAnyOf.push_back(field.requiredFeatureB);
    schema.evidence = "virtio-1.3:5.1.4";
    if (StringRef(field.name) == "status")
      schema.validMask = 0x3;
    if (StringRef(field.name) == "duplex")
      schema.validValues = {0, 1, 0xff};
    schemas_.push_back(std::move(schema));
  }

  // Virtio 1.3 section 2.7.8 says the split used ring begins with driver-owned
  // notification flags followed by the device-written le16 idx. Therefore idx
  // is two bytes wide at region-relative offset 2. The variable-size ring[]
  // that follows cannot receive a fixed physical offset here; its element
  // index must be recovered from LLVM before it can become a resolvable rule.
  for (const char *name : {"struct.vring_used", "struct.__vring_used"}) {
    structFieldSchemas_[{name, 1}] = {
        "Dma.coherent.used_idx", "Dma", "coherent", 2,
        llvm::None, 2, "used_idx"};
    structFieldSchemas_[{name, 1}].valueType.widthBits = 16;
  }

  // Virtio 1.3 section 2.8 defines packed descriptor offsets, but ownership
  // changes with the AVAIL/USED wrap bits. A type-only load is therefore not
  // sufficient evidence that len/id/flags are device-controlled. Packed
  // fields are intentionally not registered until ownership analysis proves
  // that a load observes a USED descriptor.

  // Virtio 1.3 section 5.1.6 says every network packet is preceded by
  // virtio_net_hdr. Its ordered fields are u8 flags, u8 gso_type, then four
  // le16 values. Consequently their streaming-buffer offsets are 0,1,2,4,6,8.
  const SourceSchema netHeaderFields[] = {
      {"Dma.streaming.net_flags", "Dma", "streaming", 0,
       llvm::None, 1, "virtio_net_hdr.flags"},
      {"Dma.streaming.gso_type", "Dma", "streaming", 1,
       llvm::None, 1, "virtio_net_hdr.gso_type"},
      {"Dma.streaming.hdr_len", "Dma", "streaming", 2,
       llvm::None, 2, "virtio_net_hdr.hdr_len"},
      {"Dma.streaming.gso_size", "Dma", "streaming", 4,
       llvm::None, 2, "virtio_net_hdr.gso_size"},
      {"Dma.streaming.csum_start", "Dma", "streaming", 6,
       llvm::None, 2, "virtio_net_hdr.csum_start"},
      {"Dma.streaming.csum_offset", "Dma", "streaming", 8,
       llvm::None, 2, "virtio_net_hdr.csum_offset"},
  };
  for (unsigned index = 0; index < 6; ++index) {
    structFieldSchemas_[{"struct.virtio_net_hdr", index}] =
        netHeaderFields[index];
    structFieldSchemas_[{"struct.virtio_net_hdr", index}].valueType.widthBits =
        netHeaderFields[index].widthBytes.hasValue()
            ? netHeaderFields[index].widthBytes.getValue() * 8
            : 0;
  }
  for (unsigned index = 0; index < 4; ++index) {
    structFieldSchemas_[{"struct.virtio_net_hdr_v1", index}] =
        netHeaderFields[index];
    structFieldSchemas_[{"struct.virtio_net_hdr_v1", index}].valueType.widthBits =
        netHeaderFields[index].widthBytes.hasValue()
            ? netHeaderFields[index].widthBytes.getValue() * 8
            : 0;
  }

  // Section 5.1.6 appends le16 num_buffers after the 10-byte base header,
  // yielding offset 10 when VIRTIO_NET_F_MRG_RXBUF is negotiated.
  structFieldSchemas_[{"struct.virtio_net_hdr_mrg_rxbuf", 1}] = {
      "Dma.streaming.num_buffers", "Dma", "streaming", 10,
      llvm::None, 2, "virtio_net_hdr.num_buffers"};
  structFieldSchemas_[{"struct.virtio_net_hdr_mrg_rxbuf", 1}].valueType.widthBits = 16;
  structFieldSchemas_[{"struct.virtio_net_hdr_v1", 5}] = {
      "Dma.streaming.num_buffers", "Dma", "streaming", 10,
      llvm::None, 2, "virtio_net_hdr.num_buffers"};
  structFieldSchemas_[{"struct.virtio_net_hdr_v1", 5}].valueType.widthBits = 16;

  // With VIRTIO_NET_F_HASH_REPORT, section 5.1.6 appends le32 hash_value and
  // le16 hash_report after the 12-byte v1 header. Linux represents hash_value
  // as two le16 halves, so field indices 1/2 cover offsets 12/14 and index 3
  // is the report at offset 16. The padding at offset 18 is intentionally not
  // a semantic source.
  structFieldSchemas_[{"struct.virtio_net_hdr_v1_hash", 1}] = {
      "Dma.streaming.hash_value_lo", "Dma", "streaming", 12,
      llvm::None, 2, "virtio_net_hdr.hash_value_lo"};
  structFieldSchemas_[{"struct.virtio_net_hdr_v1_hash", 1}].valueType.widthBits = 16;
  structFieldSchemas_[{"struct.virtio_net_hdr_v1_hash", 2}] = {
      "Dma.streaming.hash_value_hi", "Dma", "streaming", 14,
      llvm::None, 2, "virtio_net_hdr.hash_value_hi"};
  structFieldSchemas_[{"struct.virtio_net_hdr_v1_hash", 2}].valueType.widthBits = 16;
  structFieldSchemas_[{"struct.virtio_net_hdr_v1_hash", 3}] = {
      "Dma.streaming.hash_report", "Dma", "streaming", 16,
      llvm::None, 2, "virtio_net_hdr.hash_report"};
  structFieldSchemas_[{"struct.virtio_net_hdr_v1_hash", 3}].valueType.widthBits = 16;

  // Virtio 1.3 section 5.1.6.1 defines the control-virtqueue formats:
  // struct virtio_net_ctrl_hdr { u8 class; u8 cmd; } precedes each control
  // request and is driver-to-device, so it is not a device-controlled input
  // source and is not registered. struct virtio_net_ctrl_ack { u8 ack; }
  // carries the device's reply; its streaming-buffer offset is 0.
  structFieldSchemas_[{"struct.virtio_net_ctrl_ack", 0}] = {
      "Dma.streaming.ctrl_ack", "Dma", "streaming", 0,
      llvm::None, 1, "virtio_net_ctrl_ack.ack"};
  structFieldSchemas_[{"struct.virtio_net_ctrl_ack", 0}].valueType.widthBits = 8;

  for (auto &entry : structFieldSchemas_) {
    SourceSchema &schema = entry.second;
    // Ownership is provenance, not type metadata: the split used ring is
    // device-written by the specification (section 2.7.8), but a net header
    // load is device-written on RX and driver-written on TX, so type alone
    // does not prove ownership. Direction claims are only kept where the
    // specification proves them.
    schema.direction = StringRef(schema.field).find("virtio_net_hdr") == 0 ||
                               StringRef(schema.field).find("virtio_net_ctrl_hdr") == 0
                           ? "unknown"
                           : "device-writable";
    schema.evidence = StringRef(schema.field).find("virtio_net_ctrl") == 0
                          ? "virtio-1.3:5.1.6.1"
                          : (StringRef(schema.field).find("virtio_net_hdr") == 0
                                 ? "virtio-1.3:5.1.6"
                                 : "virtio-1.3:2.7-2.8");
    if (schema.accessKind == "streaming")
      schema.slot = 0;
    if (schema.field == "virtio_net_hdr.flags")
      schema.validMask = 0x7;
    if (schema.field == "virtio_net_hdr.gso_type")
      schema.validMask = 0x87;
  }

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
  return llvm::None;
}

/// Strip constant-offset GEPs and pointer casts down to the base value.
static const Value *pointerBase(const Value *V) {
  if (auto *gep = dyn_cast<GEPOperator>(V))
    return pointerBase(gep->getPointerOperand());
  if (auto *bc = dyn_cast<BitCastOperator>(V))
    return pointerBase(bc->getOperand(0));
  if (auto *pti = dyn_cast<PtrToIntOperator>(V))
    return pointerBase(pti->getOperand(0));
  if (auto *ii = dyn_cast<IntToPtrInst>(V))
    return pointerBase(ii->getOperand(0));
  return V;
}

/// Return the base value and constant byte offset of a pointer expression,
/// or None when any index is non-constant.
static Optional<std::pair<const Value *, int64_t>>
baseAndConstantOffset(const Value *value, const DataLayout &dl) {
  if (!value)
    return llvm::None;
  int64_t total = 0;
  const Value *current = value;
  while (true) {
    current = pointerBase(current);
    auto *gep = dyn_cast<GEPOperator>(current);
    if (!gep)
      return std::make_pair(current, total);
    if (!gep->hasAllConstantIndices())
      return llvm::None;
    APInt offset(64, 0);
    if (!gep->accumulateConstantOffset(dl, offset) ||
        offset.getSignificantBits() > 63)
      return llvm::None;
    total += offset.getSExtValue();
    current = gep->getPointerOperand();
  }
}

namespace {

// Recognized MMIO mapping calls (kernel API): the region returned by one of
// these calls is the Virtio MMIO transport access base. Evidence: the
// kernel's device-to-MMIO mapping API; a volatile load from an arbitrary
// pointer is not a transport access.
bool isMmioMapCallee(llvm::StringRef name) {
  return name == "ioremap" || name == "ioremap_cache" ||
         name == "ioremap_wc" || name == "ioremap_nocache" ||
         name.startswith("devm_ioremap") ||
         name.startswith("devm_platform_ioremap_resource") ||
         name == "pci_iomap" || name == "pci_ioremap_bar";
}

// Recognized MMIO access calls: a volatile load whose base aliases a pointer
// that feeds one of these calls reads the same transport region.
bool isMmioAccessCallee(llvm::StringRef name) {
  return name.startswith("readl") || name.startswith("readw") ||
         name.startswith("readb") || name.startswith("readq") ||
         name.startswith("ioread");
}

// Recognized virtqueue buffer-producing calls: the returned buffer is owned
// by a virtqueue (Virtio 1.3 section 2.6/2.7).
bool isVirtqueueBufferCallee(llvm::StringRef name) {
  return name == "virtqueue_get_buf" || name == "virtqueue_get_buf_ctx" ||
         name == "virtqueue_detach_buf" ||
         name == "virtqueue_detach_buf_in_order";
}

// Recognized DMA mapping calls: the mapped address belongs to a DMA surface.
bool isDmaMapCallee(llvm::StringRef name) {
  return name.startswith("dma_map_single") ||
         name.startswith("dma_map_page") ||
         name.startswith("virtqueue_map_single") ||
         name.startswith("virtqueue_map_page");
}

// Virtio 1.3 section 2.7.8: the split used ring is device-written, so
// loads into it observe queue-written state. The avail ring is
// driver-written and the packed descriptors change ownership with the
// AVAIL/USED wrap bits, so neither is a source-owned type; packed fields
// remain omitted without wrap-bit ownership proof. Exact catalog type
// names, not substring heuristics.
constexpr const char *kVringOwnedStructTypes[] = {
    "struct.vring_used",
    "struct.__vring_used",
};

/// Whether a struct type is a specification-owned virtqueue structure.
static bool isVringOwnedStructType(const std::string &name) {
  for (const char *owned : kVringOwnedStructTypes)
    if (name == owned)
      return true;
  return false;
}

/// Walk the backward provenance closure of V looking for `target` through
/// transparent pointer operations and same-function store/load forwarding.
static bool sharesProvenanceWalkBase(const Value *V, const Value *target,
                                     const DataLayout &dl,
                                     std::set<const Value *> &seen,
                                     unsigned depth) {
  if (!V || !target || depth == 0 || !seen.insert(V).second)
    return false;
  if (V == target)
    return true;
  if (auto *gep = dyn_cast<GEPOperator>(V))
    return sharesProvenanceWalkBase(gep->getPointerOperand(), target, dl,
                                    seen, depth - 1);
  if (auto *cast = dyn_cast<CastInst>(V))
    return sharesProvenanceWalkBase(cast->getOperand(0), target, dl, seen,
                                    depth - 1);
  if (auto *sel = dyn_cast<SelectInst>(V)) {
    return sharesProvenanceWalkBase(sel->getTrueValue(), target, dl, seen,
                                    depth - 1) ||
           sharesProvenanceWalkBase(sel->getFalseValue(), target, dl, seen,
                                    depth - 1);
  }
  if (auto *phi = dyn_cast<PHINode>(V)) {
    for (const Use &use : phi->incoming_values())
      if (sharesProvenanceWalkBase(use.get(), target, dl, seen, depth - 1))
        return true;
    return false;
  }
  if (auto *load = dyn_cast<LoadInst>(V)) {
    if (sharesProvenanceWalkBase(load->getPointerOperand(), target, dl, seen,
                                 depth - 1))
      return true;
    auto location = baseAndConstantOffset(load->getPointerOperand(), dl);
    if (!location)
      return false;
    for (const User *user : location->first->users()) {
      auto *store = dyn_cast<StoreInst>(user);
      if (!store || store->getFunction() != load->getFunction())
        continue;
      auto storedAt = baseAndConstantOffset(store->getPointerOperand(), dl);
      if (storedAt && storedAt->first == location->first &&
          storedAt->second == location->second &&
          sharesProvenanceWalkBase(store->getValueOperand(), target, dl, seen,
                                   depth - 1))
        return true;
    }
  }
  return false;
}

/// The telemetry event in the function that shares provenance with `base`:
/// the traced address (or virtqueue pointer) and the loaded value must trace
/// back to a common SSA value. Same-function presence alone never confirms;
/// telemetry is supporting evidence and never creates a source.
static Optional<std::string>
telemetryConfirmingEvent(const Value *base, const Function *F,
                         const DataLayout &dl,
                         const std::map<const llvm::Function *,
                                        std::vector<TelemetryEvidence>>
                             *events) {
  if (!F || !base || !events)
    return llvm::None;
  auto it = events->find(F);
  if (it == events->end())
    return llvm::None;
  for (const TelemetryEvidence &event : it->second) {
    if (!event.root)
      continue;
    if (event.root->stripPointerCasts() == base)
      return event.event;
    std::set<const Value *> seen;
    if (sharesProvenanceWalkBase(event.root, base, dl, seen, 6))
      return event.event;
    // A queue-owned field load derives from the virtqueue pointer, so the
    // base's own closure may contain the event root.
    std::set<const Value *> seenBase;
    if (sharesProvenanceWalkBase(base, event.root, dl, seenBase, 6))
      return event.event;
  }
  return llvm::None;
}

/// Whether CB calls a function matching `isRoot`.
static bool callMatchesRoot(const Value *V, bool (*isRoot)(llvm::StringRef)) {
  const auto *CB = dyn_cast<CallBase>(V);
  if (!CB || !CB->getCalledFunction())
    return false;
  return isRoot(CB->getCalledFunction()->getName());
}

/// Trace a pointer expression back through transparent operations and
/// same-function store/load forwarding to a root call matching `isRoot`.
static bool tracesToRoot(const Value *V, bool (*isRoot)(llvm::StringRef),
                         const DataLayout &dl,
                         std::set<const Value *> &seen, unsigned depth) {
  if (!V || depth == 0 || !seen.insert(V).second)
    return false;
  if (callMatchesRoot(V, isRoot))
    return true;
  if (auto *gep = dyn_cast<GEPOperator>(V))
    return tracesToRoot(gep->getPointerOperand(), isRoot, dl, seen, depth - 1);
  if (auto *cast = dyn_cast<CastInst>(V))
    return tracesToRoot(cast->getOperand(0), isRoot, dl, seen, depth - 1);
  if (auto *sel = dyn_cast<SelectInst>(V)) {
    return tracesToRoot(sel->getTrueValue(), isRoot, dl, seen, depth - 1) ||
           tracesToRoot(sel->getFalseValue(), isRoot, dl, seen, depth - 1);
  }
  if (auto *phi = dyn_cast<PHINode>(V)) {
    for (const Value *incoming : phi->incoming_values())
      if (tracesToRoot(incoming, isRoot, dl, seen, depth - 1))
        return true;
    return false;
  }
  if (auto *load = dyn_cast<LoadInst>(V)) {
    // Same-function store/load forwarding: the loaded value is whatever was
    // stored to the same base+offset.
    auto location = baseAndConstantOffset(load->getPointerOperand(), dl);
    if (!location)
      return false;
    const Function *function = load->getFunction();
    for (const User *user : location->first->users()) {
      auto *store = dyn_cast<StoreInst>(user);
      if (!store || store->getFunction() != function)
        continue;
      auto storedAt = baseAndConstantOffset(store->getPointerOperand(), dl);
      if (storedAt && storedAt->first == location->first &&
          storedAt->second == location->second &&
          tracesToRoot(store->getValueOperand(), isRoot, dl, seen, depth - 1))
        return true;
    }
  }
  return false;
}

/// Whether the pointer expression traces to a provenance root call.
static bool tracesToRoot(const Value *V, bool (*isRoot)(llvm::StringRef),
                         const DataLayout &dl) {
  std::set<const Value *> seen;
  return tracesToRoot(V, isRoot, dl, seen, 6);
}

} // namespace

static const SourceSchema *findByOffset(const std::vector<SourceSchema> &schemas,
                                        uint64_t offset,
                                        llvm::StringRef kind = "") {
  for (const auto &s : schemas)
    if (s.offset.hasValue() && s.offset.getValue() == offset &&
        (kind.empty() || s.accessKind == kind))
      return &s;
  return nullptr;
}

static uint64_t absoluteConfigOffset(uint64_t relativeOffset) {
  return kMmioConfigBase + relativeOffset;
}

static Optional<uint64_t> configOffsetFromFunction(const Function *function) {
  if (!function || function->isDeclaration())
    return llvm::None;
  for (const BasicBlock &block : *function) {
    for (const Instruction &instruction : block) {
      auto *call = dyn_cast<CallBase>(&instruction);
      if (!call || call->getCalledFunction() || call->arg_size() < 4)
        continue;
      auto *offset = dyn_cast<ConstantInt>(call->getArgOperand(1));
      auto *size = dyn_cast<ConstantInt>(call->getArgOperand(3));
      if (!offset || !size || !function->getReturnType()->isIntegerTy())
        continue;
      if (size->getZExtValue() !=
          function->getReturnType()->getIntegerBitWidth() / 8)
        continue;
      return offset->getZExtValue();
    }
  }
  return llvm::None;
}

/// Access width in bytes implied by a virtio_cread* callee, or 0 when the
/// callee does not fix a width (for example the byte-string helper).
static unsigned creadWidthBytes(llvm::StringRef callee) {
  if (callee == "virtio_cread8") return 1;
  if (callee == "virtio_cread16") return 2;
  if (callee == "virtio_cread32") return 4;
  if (callee == "virtio_cread64") return 8;
  return 0;
}

static std::string nameForFeatureBit(unsigned bit) {
  for (const FeatureSpec &feature : kVirtio13NetFeatures)
    if (feature.bit == bit)
      return feature.name;
  for (const FeatureSpec &feature : kVirtio13CommonFeatures)
    if (feature.bit == bit)
      return feature.name;
  return {};
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

/// Recognized Virtio MMIO transport device struct types: the device whose
/// region field carries the mapped MMIO base (Virtio 1.3 section 4.2 MMIO
/// transport). Exact catalog type names, not substring heuristics.
constexpr const char *kVirtioMmioDeviceTypes[] = {
    "struct.virtio_mmio_device",
};

/// Whether a struct type is a recognized Virtio MMIO transport device.
static bool isVirtioMmioDeviceType(const std::string &name) {
  for (const char *type : kVirtioMmioDeviceTypes)
    if (name == type)
      return true;
  return false;
}

/// The struct type name of a pointer's pointee, when it is a named struct
/// accessed at field granularity or a struct-typed object address.
static Optional<std::string> pointeeStructType(const Value *V) {
  if (auto *GV = dyn_cast<GlobalVariable>(V)) {
    if (auto *st = dyn_cast<StructType>(GV->getValueType()))
      if (st->hasName())
        return st->getName().str();
    return llvm::None;
  }
  if (auto *AI = dyn_cast<AllocaInst>(V)) {
    if (auto *st = dyn_cast<StructType>(AI->getAllocatedType()))
      if (st->hasName())
        return st->getName().str();
    return llvm::None;
  }
  auto sfi = getStructFieldInfo(V);
  if (sfi)
    return sfi->first;
  return llvm::None;
}

/// Whether a mapping-call result X is stored into a field of a recognized
/// Virtio MMIO transport device.
static bool mappingStoredIntoVirtioDevice(const Value *X) {
  for (const User *U : X->users()) {
    auto *store = dyn_cast<StoreInst>(U);
    if (!store || store->getValueOperand() != X)
      continue;
    auto type = pointeeStructType(store->getPointerOperand());
    if (type.hasValue() && isVirtioMmioDeviceType(type.getValue()))
      return true;
  }
  return false;
}

/// Virtio MMIO provenance: the base traces back through transparent pointer
/// operations and same-function store/load forwarding to a recognized
/// Virtio MMIO transport device's region field, or to a mapping-call result
/// stored into such a device. A generic ioremap of an unrelated region, or
/// two arbitrary reads on the same unproven base, never prove this.
static bool tracesToVirtioMmioRoot(const Value *V, const DataLayout &dl,
                                   std::set<const Value *> &seen,
                                   unsigned depth) {
  if (!V || depth == 0 || !seen.insert(V).second)
    return false;
  if (auto *gep = dyn_cast<GEPOperator>(V))
    return tracesToVirtioMmioRoot(gep->getPointerOperand(), dl, seen,
                                  depth - 1);
  if (auto *cast = dyn_cast<CastInst>(V))
    return tracesToVirtioMmioRoot(cast->getOperand(0), dl, seen, depth - 1);
  if (auto *sel = dyn_cast<SelectInst>(V)) {
    return tracesToVirtioMmioRoot(sel->getTrueValue(), dl, seen, depth - 1) ||
           tracesToVirtioMmioRoot(sel->getFalseValue(), dl, seen, depth - 1);
  }
  if (auto *phi = dyn_cast<PHINode>(V)) {
    for (const Use &use : phi->incoming_values())
      if (tracesToVirtioMmioRoot(use.get(), dl, seen, depth - 1))
        return true;
    return false;
  }
  if (auto *load = dyn_cast<LoadInst>(V)) {
    // A load of a Virtio MMIO transport device's region field.
    auto type = pointeeStructType(load->getPointerOperand());
    if (type.hasValue() && isVirtioMmioDeviceType(type.getValue()))
      return true;
    // Same-function store/load forwarding.
    auto location = baseAndConstantOffset(load->getPointerOperand(), dl);
    if (!location)
      return false;
    for (const User *user : location->first->users()) {
      auto *store = dyn_cast<StoreInst>(user);
      if (!store || store->getFunction() != load->getFunction())
        continue;
      auto storedAt = baseAndConstantOffset(store->getPointerOperand(), dl);
      if (storedAt && storedAt->first == location->first &&
          storedAt->second == location->second &&
          tracesToVirtioMmioRoot(store->getValueOperand(), dl, seen,
                                 depth - 1))
        return true;
    }
    return false;
  }
  if (callMatchesRoot(V, isMmioMapCallee))
    return mappingStoredIntoVirtioDevice(V);
  return false;
}



Optional<SemanticSource>
SourceCatalog::matchCall(CallBase *CB, const std::string &functionName,
                         DebugLoc loc) const {
  if (!CB->getCalledFunction())
    return llvm::None;

  StringRef callee = CB->getCalledFunction()->getName();
  // MMIO transport read: readl/readw/readb/readq/ioread*(ptr). Provenance
  // is required: the pointer must trace to a recognized MMIO mapping call
  // result (the Virtio transport access base) or alias a pointer that feeds
  // a recognized MMIO access call in the same function. An arbitrary
  // function argument is not a transport access.
  if ((callee.startswith("readl") || callee.startswith("readw") ||
       callee.startswith("readb") || callee.startswith("readq") ||
       callee.startswith("ioread")) &&
      CB->arg_size() >= 1) {
    const Value *ptr = CB->getArgOperand(0);
    const DataLayout &dl = CB->getModule()->getDataLayout();
    auto off = getPointerOffset(ptr, dl);
    uint64_t offset = 0;
    bool hasOffset = false;
    if (off.hasValue() && off.getValue() >= 0) {
      offset = static_cast<uint64_t>(off.getValue());
      hasOffset = true;
    }

    const SourceSchema *known =
        hasOffset ? findByOffset(schemas_, offset) : nullptr;
    if (!known)
      return llvm::None;

    const Value *base = pointerBase(ptr);
    std::set<const Value *> seen;
    if (!tracesToVirtioMmioRoot(base, dl, seen, 6))
      return llvm::None;

    SemanticSource src;
    src.schema = *known;
    src.rootValue = CB;
    src.site = CB;
    src.function = functionName;
    src.loc = loc;
    return src;
  }

  // Feature test: virtio_has_feature(vdev, bit) and related helpers.
  if ((callee == "virtio_has_feature" || callee == "__virtio_test_bit" ||
       callee == "virtio_check_driver_offered_feature") &&
      CB->arg_size() >= 2) {
    const Value *bitArg = CB->getArgOperand(1);
    auto *c = dyn_cast<ConstantInt>(bitArg);
    if (!c)
      return llvm::None;
    unsigned bit = static_cast<unsigned>(c->getZExtValue());
    std::string name = nameForFeatureBit(bit);
    if (name.empty())
      return llvm::None;
    SourceSchema schema{"MmioFeature." + name, "Mmio", "feature",
                        0x010, bit, 4, name};
    schema.featureWordSelector = bit / 32;
    schema.nodeLocalBit = bit % 32;
    schema.direction = "R";
    schema.evidence = "virtio-1.3:2.2,5.1.3";
    schema.valueType.widthBits = 32;
    SemanticSource src;
    src.schema = schema;
    src.rootValue = CB;
    src.site = CB;
    src.function = functionName;
    src.loc = loc;
    return src;
  }

  // Direct value-returning config reads. Constant-specialized helpers can
  // retain the offset only inside their function body, so inspect both the
  // call argument and the helper body. The callee width must match the
  // catalog access width.
  if (callee.startswith("virtio_cread") && !CB->getType()->isVoidTy()) {
    Optional<uint64_t> relativeOffset;
    if (CB->arg_size() >= 2)
      if (auto *constant = dyn_cast<ConstantInt>(CB->getArgOperand(1)))
        relativeOffset = constant->getZExtValue();
    if (!relativeOffset.hasValue())
      relativeOffset = configOffsetFromFunction(CB->getCalledFunction());
    if (!relativeOffset.hasValue())
      return llvm::None;
    uint64_t offset = absoluteConfigOffset(relativeOffset.getValue());
    const SourceSchema *known = findByOffset(schemas_, offset, "config");
    if (!known)
      return llvm::None;
    if (unsigned width = creadWidthBytes(callee)) {
      if (!known->widthBytes.hasValue() ||
          known->widthBytes.getValue() != width)
        return llvm::None;
    }
    SemanticSource src;
    src.schema = *known;
    src.rootValue = CB;
    src.site = CB;
    src.function = functionName;
    src.loc = loc;
    return src;
  }

  // virtio_cread_bytes(vdev, buf) stores the MAC address into buf. The buffer
  // pointer is the semantic source for downstream memcpy-like sinks.
  if (callee == "virtio_cread_bytes" && CB->arg_size() >= 2) {
    const SourceSchema *known =
        findByOffset(schemas_, absoluteConfigOffset(0), "config");
    if (known) {
      SemanticSource src;
      src.schema = *known;
      src.rootValue = CB->getArgOperand(1);
    src.site = CB;
      src.function = functionName;
      src.loc = loc;
      return src;
    }
  }

  // Buffer-style virtio_cread* and indirect vdev->config->get are handled by
  // matchConfigGetLoad because the value is stored into a caller buffer.

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
  if (auto *f = CB->getCalledFunction()) {
    StringRef name = f->getName();
    if (name == "virtio_cread_bytes" && CB->arg_size() >= 2) {
      offset = 0;
      bufArgNo = 1;
      return true;
    }
    if (name.startswith("virtio_cread") && CB->arg_size() >= 3) {
      auto *constant = dyn_cast<ConstantInt>(CB->getArgOperand(1));
      if (!constant)
        return false;
      offset = constant->getZExtValue();
      bufArgNo = 2;
      return true;
    }
    return false;
  }

  if (CB->arg_size() < 3)
    return false;
  auto *constant = dyn_cast<ConstantInt>(CB->getArgOperand(1));
  if (!constant)
    return false;
  offset = constant->getZExtValue();

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
      offset = absoluteConfigOffset(offset);
      const SourceSchema *known = findByOffset(schemas_, offset, "config");
      if (!known)
        continue;
      SemanticSource src;
      src.schema = *known;
      src.rootValue = LI;
      src.site = LI;
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

  // Virtio config space reads via vdev->config->get(...): the config-ops
  // call pattern is the provenance.
  if (auto src = matchConfigGetLoad(LI, functionName, loc))
    return src;

  const DataLayout &dl = LI->getModule()->getDataLayout();

  // After inlining, MMIO reads become volatile loads from base + constant.
  // Provenance is required: the base must trace to a recognized MMIO mapping
  // call result or alias a pointer that feeds a recognized MMIO access call
  // in the same function. An arbitrary base + catalog offset is not a
  // transport access.
  if (LI->isVolatile() && LI->getType()->isIntegerTy()) {
    auto off = getPointerOffset(ptr, dl);
    if (off.hasValue() && off.getValue() >= 0) {
      const Value *base = pointerBase(ptr);
      std::set<const Value *> seen;
      if (tracesToVirtioMmioRoot(base, dl, seen, 6)) {
        const SourceSchema *known =
            findByOffset(schemas_, static_cast<uint64_t>(off.getValue()));
        if (known) {
          SemanticSource src;
          src.schema = *known;
          src.rootValue = LI;
          src.site = LI;
          src.function = functionName;
          src.loc = loc;
          return src;
        }
      }
    }
  }

  // Virtio-defined DMA structure fields. Provenance is required: loads into
  // the vring and virtqueue structures are queue-owned by the specification;
  // other DMA payloads (for example virtio_net_hdr) must trace to a
  // virtqueue buffer call or a DMA mapping call. A plain struct pointer
  // parameter with no provenance is not a DMA source.
  if (auto sfi = getStructFieldInfo(ptr)) {
    auto it = structFieldSchemas_.find(*sfi);
    if (it != structFieldSchemas_.end()) {
      const Value *base = pointerBase(ptr);
      bool queueOwned = isVringOwnedStructType(sfi->first);
      bool proven = queueOwned ||
                    tracesToRoot(base, isVirtqueueBufferCallee, dl) ||
                    tracesToRoot(base, isDmaMapCallee, dl);
      Optional<std::string> telemetry =
          telemetryConfirmingEvent(base, LI->getFunction(), dl,
                                   &telemetryEvents_);
      if (proven || telemetry.hasValue()) {
        SemanticSource src;
        src.schema = it->second;
        if (telemetry.hasValue())
          src.schema.telemetryEvent = telemetry.getValue();
        src.rootValue = LI;
        src.site = LI;
        src.function = functionName;
        src.loc = loc;
        return src;
      }
    }
  }

  return llvm::None;
}
