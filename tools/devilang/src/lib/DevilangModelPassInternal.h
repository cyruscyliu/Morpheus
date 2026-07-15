#include "DevilangModelPass.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <tuple>
#include <map>
#include <optional>
#include <set>
#include <cstdlib>
#include <functional>
#include <limits>
#include <string>
#include <sstream>
#include <cstdio>
#include <utility>
#include <vector>

#include "llvm/ADT/SmallString.h"
#include "llvm/ADT/SmallPtrSet.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/ADT/ScopeExit.h"
#include "llvm/ADT/StringRef.h"
#include "llvm/Analysis/LoopInfo.h"
#include "llvm/Analysis/ScalarEvolution.h"
#include "llvm/BinaryFormat/Dwarf.h"
#include "llvm/IR/InstIterator.h"
#include "llvm/IR/DataLayout.h"
#include "llvm/IR/BasicBlock.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/DebugInfoMetadata.h"
#include "llvm/IR/DebugInfo.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/InstrTypes.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/IntrinsicInst.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Operator.h"
#include "llvm/IR/PassManager.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Support/Path.h"
#include "llvm/ADT/SmallPtrSet.h"
#include "llvm/ADT/SmallVector.h"

namespace devilang {
namespace {

using llvm::BasicBlock;
using llvm::BranchInst;
using llvm::CallBase;
using llvm::ConstantInt;
using llvm::DataLayout;
using llvm::Function;
using llvm::GetElementPtrInst;
using llvm::Instruction;
using llvm::DbgValueInst;
using llvm::LoadInst;
using llvm::Loop;
using llvm::Module;
using llvm::PHINode;
using llvm::StoreInst;
using llvm::SwitchInst;
using llvm::StringRef;
using llvm::Type;
using llvm::User;
using llvm::Value;

struct TraceBlock {
  std::string label;
  std::vector<std::string> lines;
};

struct TraceModel {
  std::string name;
  bool entry = false;
  std::vector<TraceBlock> blocks;
};

struct MachineModel {
  std::string name;
  std::set<std::string> scratchVars;
  std::vector<TraceModel> traces;
  std::set<std::string> emittedTraceBases;
  std::set<std::string> schemaTypes;
  std::map<std::string, std::set<std::string>> schemaHeadPositions;
  std::map<std::string, std::set<std::string>> schemaObservedFields;
  std::map<std::string, std::set<uint64_t>> schemaLengthImmediates;
  std::map<std::string, std::set<std::pair<uint64_t, uint64_t>>>
      schemaImmediateRanges;
  std::set<std::string> mmioOpNames;
  std::map<std::string, std::set<std::pair<unsigned, unsigned>>>
      mmioObservedBitRanges;
  std::map<std::string,
           std::map<unsigned, std::set<std::pair<unsigned, unsigned>>>>
      mmioObservedBitRangesBySelector;
  struct ExplicitSchemaField {
    std::string name;
    std::string typeName;
  };
  struct ExplicitSchemaDecl {
    std::vector<ExplicitSchemaField> fields;
  };
  struct DynamicMmioOp {
    std::string name;
    std::string schemaName;
    bool isRead = false;
    uint64_t offset = 0;
    unsigned size = 0;
  };
  std::map<std::string, ExplicitSchemaDecl> explicitSchemas;
  std::vector<DynamicMmioOp> dynamicMmioOps;
};

struct DmaPayloadInfo {
  std::string kind = "sg_buffer";
  std::string type = "unknown";
  std::vector<std::string> fields;
};

struct PayloadSourceInfo {
  const Value *value = nullptr;
  const CallBase *originCall = nullptr;
  std::string originCallee;
  unsigned originArgIndex = 0;
  const Value *lengthValue = nullptr;
  std::optional<int64_t> slotIndex;
};

struct PayloadTraceState {
  llvm::SmallPtrSet<const Value *, 32> values;
  std::optional<int64_t> sgSlot;
};

struct DmaPayloadVariant {
  DmaPayloadInfo payload;
  const Value *lengthValue = nullptr;
  const Function *lengthContext = nullptr;
  std::optional<uint64_t> inferredLength;
};

struct PayloadPatternBranch {
  std::vector<std::string> guards;
  std::vector<DmaPayloadInfo> payloads;
};

struct PointerAccessPath {
  const Value *base = nullptr;
  std::vector<int64_t> indices;
  bool exact = false;
};

struct VirtioMmioRegisterInfo {
  uint64_t offset = 0;
  const char *schemaName = nullptr;
  const char *readOpName = nullptr;
  const char *writeOpName = nullptr;
  enum class ValueKind {
    Plain,
    Immediate,
    Flags,
  } valueKind = ValueKind::Plain;
};

struct MmioValueSlice {
  const Value *value = nullptr;
  int bitBase = 0;

  bool operator<(const MmioValueSlice &other) const {
    return std::tie(value, bitBase) < std::tie(other.value, other.bitBase);
  }
};

std::string sanitizeToken(StringRef input) {
  std::string out;
  out.reserve(input.size());
  bool lastUnderscore = false;
  for (char ch : input) {
    if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_') {
      out.push_back(ch);
      lastUnderscore = false;
      continue;
    }
    if (!lastUnderscore) {
      out.push_back('_');
      lastUnderscore = true;
    }
  }
  if (out.empty()) {
    out = "unnamed";
  }
  if (std::isdigit(static_cast<unsigned char>(out.front()))) {
    out.insert(out.begin(), '_');
  }
  return out;
}

static std::optional<VirtioMmioRegisterInfo>
lookupVirtioMmioRegisterInfo(uint64_t offset) {
  using Kind = VirtioMmioRegisterInfo::ValueKind;
  switch (offset) {
    case 0:
      return VirtioMmioRegisterInfo{
          0, "virtio_mmio_magic_value", "virtio_mmio_magic_value_read",
          "virtio_mmio_magic_value_write", Kind::Immediate};
    case 4:
      return VirtioMmioRegisterInfo{
          4, "virtio_mmio_version", "virtio_mmio_version_read",
          "virtio_mmio_version_write", Kind::Immediate};
    case 8:
      return VirtioMmioRegisterInfo{
          8, "virtio_mmio_device_id", "virtio_mmio_device_id_read",
          "virtio_mmio_device_id_write", Kind::Plain};
    case 12:
      return VirtioMmioRegisterInfo{
          12, "virtio_mmio_vendor_id", "virtio_mmio_vendor_id_read",
          "virtio_mmio_vendor_id_write", Kind::Plain};
    case 16:
      return VirtioMmioRegisterInfo{
          16, "virtio_mmio_device_features", "virtio_mmio_device_features_read",
          "virtio_mmio_device_features_write", Kind::Flags};
    case 20:
      return VirtioMmioRegisterInfo{
          20, "virtio_mmio_device_features_sel",
          "virtio_mmio_device_features_sel_read",
          "virtio_mmio_device_features_sel_write", Kind::Immediate};
    case 32:
      return VirtioMmioRegisterInfo{
          32, "virtio_mmio_driver_features", "virtio_mmio_driver_features_read",
          "virtio_mmio_driver_features_write", Kind::Flags};
    case 36:
      return VirtioMmioRegisterInfo{
          36, "virtio_mmio_driver_features_sel",
          "virtio_mmio_driver_features_sel_read",
          "virtio_mmio_driver_features_sel_write", Kind::Immediate};
    case 40:
      return VirtioMmioRegisterInfo{
          40, "virtio_mmio_guest_page_size",
          "virtio_mmio_guest_page_size_read",
          "virtio_mmio_guest_page_size_write", Kind::Immediate};
    case 48:
      return VirtioMmioRegisterInfo{
          48, "virtio_mmio_queue_sel", "virtio_mmio_queue_sel_read",
          "virtio_mmio_queue_sel_write", Kind::Immediate};
    case 52:
      return VirtioMmioRegisterInfo{
          52, "virtio_mmio_queue_num_max", "virtio_mmio_queue_num_max_read",
          "virtio_mmio_queue_num_max_write", Kind::Plain};
    case 56:
      return VirtioMmioRegisterInfo{
          56, "virtio_mmio_queue_num", "virtio_mmio_queue_num_read",
          "virtio_mmio_queue_num_write", Kind::Immediate};
    case 60:
      return VirtioMmioRegisterInfo{
          60, "virtio_mmio_queue_align", "virtio_mmio_queue_align_read",
          "virtio_mmio_queue_align_write", Kind::Immediate};
    case 64:
      return VirtioMmioRegisterInfo{
          64, "virtio_mmio_queue_pfn", "virtio_mmio_queue_pfn_read",
          "virtio_mmio_queue_pfn_write", Kind::Plain};
    case 68:
      return VirtioMmioRegisterInfo{
          68, "virtio_mmio_queue_ready", "virtio_mmio_queue_ready_read",
          "virtio_mmio_queue_ready_write", Kind::Flags};
    case 80:
      return VirtioMmioRegisterInfo{
          80, "virtio_mmio_queue_notify", "virtio_mmio_queue_notify_read",
          "virtio_mmio_queue_notify_write", Kind::Immediate};
    case 96:
      return VirtioMmioRegisterInfo{
          96, "virtio_mmio_interrupt_status",
          "virtio_mmio_interrupt_status_read",
          "virtio_mmio_interrupt_status_write", Kind::Flags};
    case 100:
      return VirtioMmioRegisterInfo{
          100, "virtio_mmio_interrupt_ack", "virtio_mmio_interrupt_ack_read",
          "virtio_mmio_interrupt_ack_write", Kind::Flags};
    case 112:
      return VirtioMmioRegisterInfo{
          112, "virtio_mmio_status", "virtio_mmio_status_read",
          "virtio_mmio_status_write", Kind::Flags};
    case 128:
      return VirtioMmioRegisterInfo{
          128, "virtio_mmio_queue_desc_low", "virtio_mmio_queue_desc_low_read",
          "virtio_mmio_queue_desc_low_write", Kind::Plain};
    case 132:
      return VirtioMmioRegisterInfo{
          132, "virtio_mmio_queue_desc_high",
          "virtio_mmio_queue_desc_high_read",
          "virtio_mmio_queue_desc_high_write", Kind::Plain};
    case 144:
      return VirtioMmioRegisterInfo{
          144, "virtio_mmio_queue_avail_low",
          "virtio_mmio_queue_avail_low_read",
          "virtio_mmio_queue_avail_low_write", Kind::Plain};
    case 148:
      return VirtioMmioRegisterInfo{
          148, "virtio_mmio_queue_avail_high",
          "virtio_mmio_queue_avail_high_read",
          "virtio_mmio_queue_avail_high_write", Kind::Plain};
    case 160:
      return VirtioMmioRegisterInfo{
          160, "virtio_mmio_queue_used_low", "virtio_mmio_queue_used_low_read",
          "virtio_mmio_queue_used_low_write", Kind::Plain};
    case 164:
      return VirtioMmioRegisterInfo{
          164, "virtio_mmio_queue_used_high",
          "virtio_mmio_queue_used_high_read",
          "virtio_mmio_queue_used_high_write", Kind::Plain};
    case 172:
      return VirtioMmioRegisterInfo{
          172, "virtio_mmio_shm_sel", "virtio_mmio_shm_sel_read",
          "virtio_mmio_shm_sel_write", Kind::Immediate};
    case 176:
      return VirtioMmioRegisterInfo{
          176, "virtio_mmio_shm_len_low", "virtio_mmio_shm_len_low_read",
          "virtio_mmio_shm_len_low_write", Kind::Plain};
    case 180:
      return VirtioMmioRegisterInfo{
          180, "virtio_mmio_shm_len_high", "virtio_mmio_shm_len_high_read",
          "virtio_mmio_shm_len_high_write", Kind::Plain};
    case 184:
      return VirtioMmioRegisterInfo{
          184, "virtio_mmio_shm_base_low", "virtio_mmio_shm_base_low_read",
          "virtio_mmio_shm_base_low_write", Kind::Plain};
    case 188:
      return VirtioMmioRegisterInfo{
          188, "virtio_mmio_shm_base_high", "virtio_mmio_shm_base_high_read",
          "virtio_mmio_shm_base_high_write", Kind::Plain};
    case 252:
      return VirtioMmioRegisterInfo{
          252, "virtio_mmio_config_generation",
          "virtio_mmio_config_generation_read",
          "virtio_mmio_config_generation_write", Kind::Plain};
    default:
      return std::nullopt;
  }
}

static std::optional<VirtioMmioRegisterInfo>
lookupVirtioMmioRegisterInfoBySchemaName(StringRef schemaName) {
  for (uint64_t offset : {0ULL,   4ULL,   8ULL,   12ULL,  16ULL,  20ULL,
                          32ULL,  36ULL,  40ULL,  48ULL,  52ULL,  56ULL,
                          60ULL,  64ULL,  68ULL,  80ULL,  96ULL,  100ULL,
                          112ULL, 128ULL, 132ULL, 144ULL, 148ULL, 160ULL,
                          164ULL, 172ULL, 176ULL, 180ULL, 184ULL, 188ULL,
                          252ULL}) {
    auto info = lookupVirtioMmioRegisterInfo(offset);
    if (!info) {
      continue;
    }
    if (sanitizeToken(info->schemaName) == sanitizeToken(schemaName)) {
      return info;
    }
  }
  return std::nullopt;
}

static bool isQueueTransportFunctionName(StringRef name) {
  return name.startswith("virtqueue_") || name.startswith("vring_") ||
         name.startswith("sg_") || name.startswith("dma_") ||
         name.startswith("__dma") || name.startswith("page_pool_") ||
         name.startswith("skb_") || name.startswith("__skb");
}

static void insertMaskBitRanges(
    std::set<std::pair<unsigned, unsigned>> &out,
    uint64_t mask,
    int bitBase = 0) {
  if (mask == 0) {
    return;
  }
  for (unsigned bit = 0; bit < 64; ++bit) {
    if (((mask >> bit) & 1ULL) == 0) {
      continue;
    }
    unsigned end = bit;
    while (end + 1 < 64 && ((mask >> (end + 1)) & 1ULL) != 0) {
      ++end;
    }
    if (bitBase + static_cast<int>(bit) < 0) {
      bit = end;
      continue;
    }
    const unsigned lo = static_cast<unsigned>(bitBase + static_cast<int>(bit));
    const unsigned hi = static_cast<unsigned>(bitBase + static_cast<int>(end));
    out.insert({lo, hi});
    bit = end;
  }
}

std::string sanitizeFunctionName(const Function &function) {
  return sanitizeToken(function.getName());
}

std::string traceNameFor(const Function &function) {
  return sanitizeFunctionName(function) + "_trace";
}

std::string traceNameForBase(StringRef name) {
  return sanitizeToken(name) + "_trace";
}

std::string buildPointsToHintKey(StringRef callsite,
                                 StringRef callee,
                                 unsigned argIndex) {
  return (callsite + "|" + callee + "|" + llvm::Twine(argIndex)).str();
}

bool isReadLeaf(StringRef name) {
  return name.startswith("readb") || name.startswith("readw") ||
         name.startswith("readl") || name.startswith("readq") ||
         name.startswith("ioread8") || name.startswith("ioread16") ||
         name.startswith("ioread32") || name.startswith("ioread64") ||
         name.startswith("__raw_readb") || name.startswith("__raw_readw") ||
         name.startswith("__raw_readl") || name.startswith("__raw_readq");
}

bool isWriteLeaf(StringRef name) {
  return name.startswith("writeb") || name.startswith("writew") ||
         name.startswith("writel") || name.startswith("writeq") ||
         name.startswith("iowrite8") || name.startswith("iowrite16") ||
         name.startswith("iowrite32") || name.startswith("iowrite64") ||
         name.startswith("__raw_writeb") || name.startswith("__raw_writew") ||
         name.startswith("__raw_writel") || name.startswith("__raw_writeq");
}

bool isSgFunction(StringRef name) {
  return name == "sg_init_one" || name == "sg_init_table" || name == "sg_set_buf" ||
         name == "sg_next";
}

bool isPrunedHelper(StringRef name) {
  return name.startswith("kzalloc_noprof") ||
         name.startswith("kmalloc") ||
         name.startswith("__kmalloc") ||
         name.startswith("__kzalloc") ||
         name.startswith("kfree") ||
         name.startswith("memset") ||
         name.startswith("memcpy") ||
         name == "netdev_priv" ||
         name == "INIT_LIST_HEAD";
}

bool isSyntheticDmaTraceTarget(StringRef name) {
  return name == "vring_map_one_sg" || name == "vring_map_single" ||
         name == "vring_unmap_one_split" || name == "vring_unmap_extra_packed" ||
         name == "sg_fill_dma";
}

unsigned ioWidthFromName(StringRef name) {
  if (name.contains("64") || name.endswith("q")) {
    return 64;
  }
  if (name.contains("32") || name.endswith("l")) {
    return 32;
  }
  if (name.contains("16") || name.endswith("w")) {
    return 16;
  }
  return 8;
}

std::optional<unsigned> passthroughArgumentIndexForPrunedHelper(StringRef name) {
  if (name == "netdev_priv") {
    return 0;
  }
  if (name.startswith("memset") || name.startswith("memcpy")) {
    return 0;
  }
  return std::nullopt;
}

std::string trimPath(StringRef path) {
  return path.trim().str();
}

bool parseLocationToken(StringRef token, std::string &path, unsigned &line) {
  const size_t colon = token.rfind(':');
  if (colon == StringRef::npos) {
    return false;
  }
  StringRef pathPart = token.substr(0, colon).trim();
  StringRef linePart = token.substr(colon + 1).trim();
  unsigned parsed = 0;
  if (pathPart.empty() || linePart.getAsInteger(10, parsed)) {
    return false;
  }
  path = pathPart.str();
  line = parsed;
  return true;
}

