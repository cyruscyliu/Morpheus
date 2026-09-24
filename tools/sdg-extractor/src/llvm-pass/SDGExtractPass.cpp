//===- SDGExtractPass.cpp - Extract SDG rules from bitcode --------------===//
//
// This pass extracts Semantic Dependency Graph (SDG) rules from LLVM bitcode.
// It targets guest-controlled value flows in virtio device drivers:
//   - MMIO transport/config reads
//   - feature-bit checks
//   - DMA surface accesses (with optional telemetry hints)
//   - Internal state derived from the above
//
// The output is a JSON document with three sections:
//   nodes, edges (self + cross), and rules.
//
//===----------------------------------------------------------------------===//

#include "llvm/ADT/StringRef.h"
#include "llvm/ADT/Twine.h"
#include "llvm/Analysis/DominanceFrontier.h"
#include "llvm/Analysis/PostDominators.h"
#include "llvm/IR/BasicBlock.h"
#include "llvm/IR/CFG.h"
#include "llvm/IR/Constant.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/DerivedTypes.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/InstrTypes.h"
#include "llvm/IR/Instruction.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Value.h"
#include "llvm/Pass.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"
#include "llvm/Support/Casting.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/raw_ostream.h"

#include <cmath>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <tuple>
#include <vector>

using namespace llvm;

static cl::opt<std::string> SDGOutputPath(
    "sdg-output",
    cl::desc("Path to write SDG extraction JSON output"),
    cl::value_desc("filename"),
    cl::init("sdg-rules.json"));

static cl::opt<std::string> SDGEntryList(
    "sdg-entry-list",
    cl::desc("Path to file listing entry function names"),
    cl::value_desc("filename"),
    cl::init(""));

namespace {

//===----------------------------------------------------------------------===//
// Data model
//===----------------------------------------------------------------------===//

struct DebugLoc {
  std::string file;
  unsigned line = 0;
};

struct Source {
  std::string class_;
  std::string access_kind;
  unsigned width_bytes = 0;
  Optional<uint64_t> offset;
  Optional<std::string> field;
  Optional<unsigned> feature_bit;
  Optional<std::string> telemetry_event;
};

struct Node {
  std::string id;
  Source source;
  std::string llvm_value;
  std::string function;
  DebugLoc loc;
};

struct Predicate {
  std::string kind;
  Optional<uint64_t> value;
  Optional<unsigned> bit;
  Optional<uint64_t> min;
  Optional<uint64_t> max;
};

struct Edge {
  std::string src;
  std::string dst;
  std::string head;
  Predicate pred;
  std::string function;
  DebugLoc loc;
  bool self = false;
};

struct Sink {
  std::string function;
  unsigned arg_index;
  std::string role;
};

struct SinkCall {
  const CallBase *call;
  Sink sink;
};

struct MutationHint {
  std::string op;
  std::string var;
  Optional<std::string> side;
  Optional<uint64_t> value;
  Optional<unsigned> bit;
  Optional<uint64_t> mask;
  Optional<uint64_t> delta;
  Optional<uint64_t> min;
  Optional<uint64_t> max;
};

struct Rule {
  std::string id;
  std::vector<Node> vars;
  std::vector<Edge> preconditions;
  Edge trigger;
  MutationHint mutation;
  std::vector<Sink> sinks;
  float confidence = 0.0f;
  std::string function;
};

//===----------------------------------------------------------------------===//
// JSON writer (minimal, no external deps)
//===----------------------------------------------------------------------===//

static std::string escapeJSON(StringRef s) {
  std::string out;
  out.reserve(s.size() + 2);
  out.push_back('"');
  for (char c : s) {
    switch (c) {
    case '"': out += "\\\""; break;
    case '\\': out += "\\\\"; break;
    case '\b': out += "\\b"; break;
    case '\f': out += "\\f"; break;
    case '\n': out += "\\n"; break;
    case '\r': out += "\\r"; break;
    case '\t': out += "\\t"; break;
    default:
      if (static_cast<unsigned char>(c) < 0x20)
        out += "\\u00" + Twine(static_cast<int>(c)).str();
      else
        out.push_back(c);
    }
  }
  out.push_back('"');
  return out;
}

static std::string toJSON(const DebugLoc &loc) {
  std::string s = "{\"file\":" + escapeJSON(loc.file) + ",\"line\":";
  s += Twine(loc.line).str() + "}";
  return s;
}

static std::string toJSON(const Source &src) {
  std::string s = "{\"class\":" + escapeJSON(src.class_);
  s += ",\"access_kind\":" + escapeJSON(src.access_kind);
  s += ",\"width_bytes\":" + Twine(src.width_bytes).str();
  if (src.offset.hasValue())
    s += ",\"offset\":" + Twine(src.offset.getValue()).str();
  if (src.field.hasValue())
    s += ",\"field\":" + escapeJSON(src.field.getValue());
  if (src.feature_bit.hasValue())
    s += ",\"feature_bit\":" + Twine(src.feature_bit.getValue()).str();
  if (src.telemetry_event.hasValue())
    s += ",\"telemetry_event\":" + escapeJSON(src.telemetry_event.getValue());
  s += "}";
  return s;
}

static std::string toJSON(const Node &n) {
  std::string s = "{\"id\":" + escapeJSON(n.id);
  s += ",\"source\":" + toJSON(n.source);
  s += ",\"llvm_value\":" + escapeJSON(n.llvm_value);
  s += ",\"function\":" + escapeJSON(n.function);
  s += ",\"debug_loc\":" + toJSON(n.loc);
  s += "}";
  return s;
}

static std::string toJSON(const Predicate &p) {
  std::string s = "{\"kind\":" + escapeJSON(p.kind);
  if (p.value.hasValue())
    s += ",\"value\":" + Twine(p.value.getValue()).str();
  if (p.bit.hasValue())
    s += ",\"bit\":" + Twine(p.bit.getValue()).str();
  if (p.min.hasValue())
    s += ",\"min\":" + Twine(p.min.getValue()).str();
  if (p.max.hasValue())
    s += ",\"max\":" + Twine(p.max.getValue()).str();
  s += "}";
  return s;
}

static std::string toJSON(const Edge &e) {
  std::string s = "{\"src\":" + escapeJSON(e.src);
  s += ",\"dst\":" + escapeJSON(e.dst);
  s += ",\"head\":" + escapeJSON(e.head);
  s += ",\"predicate\":" + toJSON(e.pred);
  s += ",\"function\":" + escapeJSON(e.function);
  s += ",\"debug_loc\":" + toJSON(e.loc);
  s += "}";
  return s;
}

static std::string toJSON(const Sink &k) {
  std::string s = "{\"function\":" + escapeJSON(k.function);
  s += ",\"arg_index\":" + Twine(k.arg_index).str();
  s += ",\"role\":" + escapeJSON(k.role);
  s += "}";
  return s;
}

static std::string toJSON(const MutationHint &m) {
  std::string s = "{\"operator\":" + escapeJSON(m.op);
  s += ",\"var\":" + escapeJSON(m.var);
  if (m.side.hasValue())
    s += ",\"side\":" + escapeJSON(m.side.getValue());
  if (m.value.hasValue())
    s += ",\"value\":" + Twine(m.value.getValue()).str();
  if (m.bit.hasValue())
    s += ",\"bit\":" + Twine(m.bit.getValue()).str();
  if (m.mask.hasValue())
    s += ",\"mask\":" + Twine(m.mask.getValue()).str();
  if (m.delta.hasValue())
    s += ",\"delta\":" + Twine(m.delta.getValue()).str();
  if (m.min.hasValue())
    s += ",\"min\":" + Twine(m.min.getValue()).str();
  if (m.max.hasValue())
    s += ",\"max\":" + Twine(m.max.getValue()).str();
  s += "}";
  return s;
}

static std::string toJSON(const Rule &r) {
  std::string s = "{\"id\":" + escapeJSON(r.id);
  s += ",\"function\":" + escapeJSON(r.function);
  s += ",\"vars\":[";
  for (size_t i = 0; i < r.vars.size(); ++i) {
    if (i) s += ",";
    s += toJSON(r.vars[i]);
  }
  s += "],\"preconditions\":[";
  for (size_t i = 0; i < r.preconditions.size(); ++i) {
    if (i) s += ",";
    s += toJSON(r.preconditions[i]);
  }
  s += "],\"trigger\":" + toJSON(r.trigger);
  s += ",\"mutation\":" + toJSON(r.mutation);
  s += ",\"sinks\":[";
  for (size_t i = 0; i < r.sinks.size(); ++i) {
    if (i) s += ",";
    s += toJSON(r.sinks[i]);
  }
  {
    std::ostringstream oss;
    oss << r.confidence;
    s += "],\"confidence\":" + oss.str();
  }
  s += "}";
  return s;
}

static void writeJSON(const std::string &path,
                      const std::vector<Node> &nodes,
                      const std::vector<Edge> &selfEdges,
                      const std::vector<Edge> &crossEdges,
                      const std::vector<Rule> &rules) {
  std::error_code ec;
  raw_fd_ostream os(path, ec, sys::fs::OF_Text);
  if (ec) {
    errs() << "SDGExtract: cannot open output " << path << ": " << ec.message() << "\n";
    return;
  }

  os << "{\"version\":\"0.2.0\"";
  os << ",\"nodes\":{\"count\":" << nodes.size() << ",\"nodes\":[";
  for (size_t i = 0; i < nodes.size(); ++i) {
    if (i) os << ",";
    os << toJSON(nodes[i]);
  }
  os << "]}";

  os << ",\"edges\":{\"self_count\":" << selfEdges.size()
     << ",\"cross_count\":" << crossEdges.size()
     << ",\"self_edges\":[";
  for (size_t i = 0; i < selfEdges.size(); ++i) {
    if (i) os << ",";
    os << toJSON(selfEdges[i]);
  }
  os << "],\"cross_edges\":[";
  for (size_t i = 0; i < crossEdges.size(); ++i) {
    if (i) os << ",";
    os << toJSON(crossEdges[i]);
  }
  os << "]}";

  os << ",\"rules\":{\"count\":" << rules.size() << ",\"rules\":[";
  for (size_t i = 0; i < rules.size(); ++i) {
    if (i) os << ",";
    os << toJSON(rules[i]);
  }
  os << "]}}\n";
}

//===----------------------------------------------------------------------===//
// Catalogs
//===----------------------------------------------------------------------===//

static std::string mmioTransportName(uint64_t offset) {
  switch (offset) {
  case 0x000: return "magic_value";
  case 0x004: return "version";
  case 0x008: return "device_id";
  case 0x00c: return "vendor_id";
  case 0x010: return "host_features";
  case 0x014: return "host_features_sel";
  case 0x020: return "guest_features";
  case 0x024: return "guest_features_sel";
  case 0x028: return "guest_page_size";
  case 0x030: return "queue_sel";
  case 0x034: return "queue_num_max";
  case 0x038: return "queue_num";
  case 0x03c: return "queue_align";
  case 0x040: return "queue_pfn";
  case 0x044: return "queue_ready";
  case 0x050: return "queue_notify";
  case 0x060: return "interrupt_status";
  case 0x064: return "interrupt_ack";
  case 0x070: return "status";
  case 0x100: return "config_base";
  default: return (Twine("offset_") + Twine(offset)).str();
  }
}

static std::string featureBitName(unsigned bit) {
  switch (bit) {
  case 0: return "VIRTIO_NET_F_CSUM";
  case 1: return "VIRTIO_NET_F_GUEST_CSUM";
  case 3: return "VIRTIO_NET_F_MTU";
  case 5: return "VIRTIO_NET_F_MAC";
  case 15: return "VIRTIO_NET_F_MRG_RXBUF";
  case 16: return "VIRTIO_NET_F_STATUS";
  case 17: return "VIRTIO_NET_F_CTRL_VQ";
  case 22: return "VIRTIO_NET_F_MQ";
  case 23: return "VIRTIO_NET_F_CTRL_MAC_ADDR";
  case 57: return "VIRTIO_NET_F_HASH_REPORT";
  case 60: return "VIRTIO_NET_F_RSS";
  case 62: return "VIRTIO_NET_F_STANDBY";
  case 63: return "VIRTIO_NET_F_SPEED_DUPLEX";
  default: return (Twine("feature_bit_") + Twine(bit)).str();
  }
}

static bool isSinkFunction(StringRef name, unsigned &argIdx, std::string &role) {
  struct SinkInfo { const char *name; unsigned idx; const char *role; };
  static const SinkInfo sinks[] = {
    {"memcpy", 2, "size"},
    {"memmove", 2, "size"},
    {"memset", 2, "size"},
    {"skb_put", 1, "size"},
    {"__skb_put", 1, "size"},
    {"kmalloc", 0, "size"},
    {"kzalloc", 0, "size"},
    {"kmalloc_noprof", 0, "size"},
    {"kzalloc_noprof", 0, "size"},
    {"__kmalloc", 0, "size"},
    {"krealloc", 1, "size"},
    {"krealloc_noprof", 1, "size"},
    {"kvzalloc", 0, "size"},
    {"kvcalloc", 1, "size"},
    {"alloc_pages_exact", 0, "size"},
    {"alloc_pages_exact_noprof", 0, "size"},
    {"__get_free_pages", 1, "size"},
    {"dma_alloc_coherent", 1, "size"},
    {"dma_alloc_attrs", 1, "size"},
    {"dma_map_sg_attrs", 2, "size"},
    {"dma_map_page_attrs", 3, "len"},
    {"dma_map_single_attrs", 2, "size"},
    {"vring_map_one_sg", 3, "len"},
    {"vring_map_single", 2, "size"},
    {"virtqueue_map_single_attrs", 2, "size"},
    {"virtqueue_map_page_attrs", 3, "len"},
  };
  for (const auto &si : sinks) {
    if (name == si.name) {
      argIdx = si.idx;
      role = si.role;
      return true;
    }
  }
  return false;
}

//===----------------------------------------------------------------------===//
// Utility helpers
//===----------------------------------------------------------------------===//

static DebugLoc getDebugLoc(const Instruction *I) {
  DebugLoc dl;
  if (const DILocation *loc = I->getDebugLoc()) {
    dl.file = loc->getFilename().str();
    dl.line = loc->getLine();
  }
  return dl;
}

static std::string valueRef(const Value *V) {
  if (!V) return "<null>";
  if (V->hasName()) return V->getName().str();
  std::string s;
  raw_string_ostream os(s);
  V->printAsOperand(os, false);
  return s;
}

static const ConstantInt *getConstantInt(const Value *V) {
  if (auto *c = dyn_cast<ConstantInt>(V))
    return c;
  if (auto *ci = dyn_cast<ConstantInt>(V->stripPointerCasts()))
    return ci;
  return nullptr;
}

static Optional<std::pair<const Value *, int64_t>>
getPointerOffset(const Value *V) {
  if (auto *gep = dyn_cast<GetElementPtrInst>(V)) {
    if (gep->getNumOperands() >= 2) {
      if (auto *c = dyn_cast<ConstantInt>(gep->getOperand(1)))
        return std::make_pair(gep->getPointerOperand(), c->getSExtValue());
    }
  }
  // Plain pointer is treated as offset 0.
  return std::make_pair(V, int64_t{0});
}

//===----------------------------------------------------------------------===//
// Source extraction
//===----------------------------------------------------------------------===//

static const std::set<StringRef> MMIO_READ_FUNCS = {
  "readl", "readw", "readb", "ioread32", "ioread16", "ioread8"
};

static Optional<Node> tryExtractMMIORead(const Value *Ptr, Type *Ty,
                                          const std::string &valueRefStr,
                                          const std::string &funcName,
                                          const DebugLoc &loc) {
  if (!Ty->isIntegerTy())
    return None;
  unsigned width = Ty->getIntegerBitWidth() / 8;
  if (width == 0)
    return None;

  auto off = getPointerOffset(Ptr);
  int64_t offset = off.hasValue() ? off.getValue().second : 0;
  std::string regName = mmioTransportName(static_cast<uint64_t>(offset));

  Node n;
  n.id = "MmioTransport." + regName;
  n.source.class_ = "Mmio";
  n.source.access_kind = "transport";
  n.source.width_bytes = width;
  n.source.offset = static_cast<uint64_t>(offset);
  n.source.field = regName;
  n.llvm_value = valueRefStr;
  n.function = funcName;
  n.loc = loc;
  return n;
}

static Optional<Node> tryExtractSource(CallBase *CB, const std::string &funcName) {
  Function *callee = CB->getCalledFunction();
  if (!callee)
    return None;
  StringRef name = callee->getName();

  // MMIO transport read: base + offset
  if (MMIO_READ_FUNCS.count(name)) {
    unsigned width = 0;
    if (name.endswith("l") || name == "ioread32") width = 4;
    else if (name.endswith("w") || name == "ioread16") width = 2;
    else width = 1;

    if (CB->arg_size() >= 1) {
      Value *ptrArg = CB->getArgOperand(0);
      if (auto n = tryExtractMMIORead(ptrArg, CB->getType(),
                                       valueRef(CB), funcName, getDebugLoc(CB)))
        return n;
    }
  }

  // Feature bit test
  if (name == "virtio_has_feature") {
    if (CB->arg_size() >= 2) {
      if (auto *c = getConstantInt(CB->getArgOperand(1))) {
        unsigned bit = static_cast<unsigned>(c->getZExtValue());
        std::string bitName = featureBitName(bit);
        Node n;
        n.id = "MmioFeature." + bitName;
        n.source.class_ = "Mmio";
        n.source.access_kind = "feature";
        n.source.width_bytes = 4;
        n.source.feature_bit = bit;
        n.llvm_value = valueRef(CB);
        n.function = funcName;
        n.loc = getDebugLoc(CB);
        return n;
      }
    }
  }

  // Config read helpers (macros sometimes survive as calls)
  if (name.startswith("virtio_cread")) {
    unsigned width = 1;
    if (name == "virtio_cread16") width = 2;
    else if (name == "virtio_cread32") width = 4;
    else if (name == "virtio_cread64") width = 8;
    if (CB->arg_size() >= 2) {
      if (auto *c = getConstantInt(CB->getArgOperand(1))) {
        uint64_t offset = c->getZExtValue();
        // Map to known config fields (only for virtio-net in this pass)
        std::string fieldName = "unknown";
        if (offset == 0) fieldName = "mac";
        else if (offset == 6) fieldName = "status";
        else if (offset == 8) fieldName = "max_virtqueue_pairs";
        else if (offset == 10) fieldName = "mtu";
        else if (offset == 12) fieldName = "speed";
        else if (offset == 16) fieldName = "duplex";
        else if (offset == 17) fieldName = "rss_max_key_size";
        Node n;
        n.id = "MmioConfig." + fieldName;
        n.source.class_ = "Mmio";
        n.source.access_kind = "config";
        n.source.width_bytes = width;
        n.source.offset = offset;
        n.source.field = fieldName;
        n.llvm_value = valueRef(CB);
        n.function = funcName;
        n.loc = getDebugLoc(CB);
        return n;
      }
    }
  }

  return None;
}

//===----------------------------------------------------------------------===//
// Def-use and reachability
//===----------------------------------------------------------------------===//

static bool isFlowInstruction(const Instruction *I) {
  return isa<PHINode>(I) || isa<SelectInst>(I) || isa<CastInst>(I) ||
         isa<UnaryInstruction>(I) || isa<BinaryOperator>(I) ||
         isa<GetElementPtrInst>(I);
}

static void collectReachableUsers(const Value *root,
                                  std::set<const Instruction *> &out,
                                  unsigned maxDepth = 12) {
  std::set<const Value *> seen;
  std::vector<std::pair<const Value *, unsigned>> work;
  work.emplace_back(root, 0);
  while (!work.empty()) {
    auto [cur, depth] = work.back();
    work.pop_back();
    if (depth > maxDepth || !seen.insert(cur).second)
      continue;
    for (const User *u : cur->users()) {
      if (auto *ui = dyn_cast<Instruction>(u)) {
        out.insert(ui);
        work.emplace_back(ui, depth + 1);
      }
    }
  }
}

//===----------------------------------------------------------------------===//
// Edge extraction
//===----------------------------------------------------------------------===//

static std::string icmpPredicateName(ICmpInst::Predicate pred) {
  switch (pred) {
  case ICmpInst::ICMP_EQ: return "Eq";
  case ICmpInst::ICMP_NE: return "Ne";
  case ICmpInst::ICMP_UGT:
  case ICmpInst::ICMP_SGT: return "Gt";
  case ICmpInst::ICMP_ULT:
  case ICmpInst::ICMP_SLT: return "Lt";
  case ICmpInst::ICMP_UGE:
  case ICmpInst::ICMP_SGE: return "Ge";
  case ICmpInst::ICMP_ULE:
  case ICmpInst::ICMP_SLE: return "Le";
  default: return "Unknown";
  }
}

static std::string invertPredicateKind(const std::string &kind) {
  if (kind == "Eq") return "Ne";
  if (kind == "Ne") return "Eq";
  if (kind == "Lt") return "Ge";
  if (kind == "Le") return "Gt";
  if (kind == "Gt") return "Le";
  if (kind == "Ge") return "Lt";
  if (kind == "BitSet") return "BitClear";
  if (kind == "BitClear") return "BitSet";
  return kind;
}

static Predicate invertPredicate(const Predicate &p) {
  Predicate r = p;
  r.kind = invertPredicateKind(p.kind);
  return r;
}

static Optional<Predicate> predicateForICmp(
    const ICmpInst *icmp,
    const Value *root,
    const std::set<const Instruction *> &reached) {
  const ConstantInt *cst = nullptr;
  const Value *derivedOp = nullptr;
  for (unsigned i = 0; i < 2; ++i) {
    Value *op = icmp->getOperand(i);
    if (auto *c = getConstantInt(op)) {
      cst = c;
    } else if (op == root ||
               (isa<Instruction>(op) && reached.count(cast<Instruction>(op)))) {
      derivedOp = op;
    }
  }
  if (!cst || !derivedOp)
    return None;

  uint64_t constVal = cst->getZExtValue();
  std::string predKind = icmpPredicateName(icmp->getPredicate());

  // Bit test pattern: (x & (1<<b)) == 0 / != 0
  // or ((x >> b) & 1) == 0 / != 0
  if (constVal == 0 && (predKind == "Eq" || predKind == "Ne")) {
    if (auto *andI = dyn_cast<BinaryOperator>(derivedOp)) {
      if (andI->getOpcode() == Instruction::And) {
        const ConstantInt *mask = nullptr;
        for (unsigned i = 0; i < 2; ++i) {
          if (auto *c = dyn_cast<ConstantInt>(andI->getOperand(i))) {
            mask = c;
            break;
          }
        }
        if (mask) {
          uint64_t m = mask->getZExtValue();
          unsigned bit = UINT_MAX;
          if (m > 0 && (m & (m - 1)) == 0) {
            bit = static_cast<unsigned>(__builtin_ctzll(m));
          } else if (m == 1) {
            // Look for (x >> b) & 1
            for (unsigned i = 0; i < 2; ++i) {
              if (auto *shr = dyn_cast<BinaryOperator>(andI->getOperand(i))) {
                if (shr->getOpcode() == Instruction::LShr) {
                  if (auto *c = dyn_cast<ConstantInt>(shr->getOperand(1))) {
                    bit = static_cast<unsigned>(c->getZExtValue());
                    break;
                  }
                }
              }
            }
          }
          if (bit != UINT_MAX) {
            Predicate p;
            p.kind = (predKind == "Ne") ? "BitSet" : "BitClear";
            p.bit = bit;
            return p;
          }
        }
      }
    }
  }

  Predicate p;
  p.kind = predKind;
  p.value = constVal;
  return p;
}

static bool blockLeadsToSink(const BasicBlock *start,
                             const std::set<const CallBase *> &sinkCalls) {
  std::set<const BasicBlock *> visited;
  std::vector<const BasicBlock *> work = {start};
  while (!work.empty()) {
    const BasicBlock *BB = work.back();
    work.pop_back();
    if (!visited.insert(BB).second)
      continue;
    for (const auto &I : *BB) {
      if (auto *CB = dyn_cast<CallBase>(&I)) {
        if (sinkCalls.count(CB))
          return true;
      }
    }
    for (const BasicBlock *succ : successors(BB))
      work.push_back(succ);
  }
  return false;
}

static std::vector<Edge> extractSelfEdges(
    const std::vector<Node> &nodes,
    Function &F,
    const std::map<std::string, std::set<const CallBase *>> &sinkCalls) {
  std::vector<Edge> edges;
  std::map<std::string, const Value *> nodeDef;

  for (const Node &n : nodes) {
    if (n.function != F.getName().str())
      continue;
    for (auto &BB : F) {
      for (auto &I : BB) {
        if (valueRef(&I) == n.llvm_value) {
          nodeDef[n.id] = &I;
          break;
        }
      }
      if (nodeDef.count(n.id))
        break;
    }
  }

  for (const Node &n : nodes) {
    if (n.function != F.getName().str())
      continue;
    auto it = nodeDef.find(n.id);
    if (it == nodeDef.end())
      continue;
    const Value *defVal = it->second;

    std::set<const Instruction *> reached;
    collectReachableUsers(defVal, reached);

    for (const Instruction *I : reached) {
      const ICmpInst *icmp = dyn_cast<ICmpInst>(I);
      if (!icmp)
        continue;
      auto pred = predicateForICmp(icmp, defVal, reached);
      if (!pred.hasValue())
        continue;

      Predicate p = pred.getValue();

      // If this icmp drives a conditional branch, orient the predicate
      // towards the branch on which the sink is reachable.
      const BranchInst *br = nullptr;
      for (const User *u : icmp->users()) {
        if (auto *b = dyn_cast<BranchInst>(u)) {
          br = b;
          break;
        }
      }
      auto scIt = sinkCalls.find(n.id);
      if (br && scIt != sinkCalls.end()) {
        bool trueSink = blockLeadsToSink(br->getSuccessor(0), scIt->second);
        bool falseSink = blockLeadsToSink(br->getSuccessor(1), scIt->second);
        if (!trueSink && falseSink)
          p = invertPredicate(p);
        // If both or neither side reaches a sink, keep the predicate as-is.
      }

      std::string head = "head_bound";
      std::set<const Instruction *> icmpReached;
      collectReachableUsers(icmp, icmpReached, 4);
      for (const Instruction *u : icmpReached) {
        if (isa<GetElementPtrInst>(u)) {
          head = "head_offset";
          break;
        }
        if (const CallBase *ucb = dyn_cast<CallBase>(u)) {
          Function *uc = ucb->getCalledFunction();
          if (uc) {
            unsigned idx; std::string role;
            if (isSinkFunction(uc->getName(), idx, role)) {
              head = "head_call";
              break;
            }
          }
        }
      }

      Edge e;
      e.src = n.id;
      e.dst = n.id;
      e.head = head;
      e.pred = p;
      e.function = F.getName().str();
      e.loc = getDebugLoc(icmp);
      e.self = true;
      edges.push_back(e);
    }
  }
  return edges;
}

static std::vector<Edge> extractCrossEdges(const std::vector<Node> &nodes,
                                            Function &F) {
  std::vector<Edge> edges;
  std::map<std::string, const Value *> valueByNodeId;

  for (const Node &n : nodes) {
    if (n.function != F.getName().str())
      continue;
    // Find the defining instruction by matching the llvm_value operand name.
    for (auto &BB : F) {
      for (auto &I : BB) {
        std::string ref = valueRef(&I);
        if (ref == n.llvm_value) {
          valueByNodeId[n.id] = &I;
          break;
        }
      }
    }
  }

  // For each source node, look at its reachable users for branch conditions.
  for (const Node &n : nodes) {
    if (n.function != F.getName().str())
      continue;
    auto vit = valueByNodeId.find(n.id);
    if (vit == valueByNodeId.end())
      continue;

    std::set<const Instruction *> reached;
    collectReachableUsers(vit->second, reached);

    auto addGuardEdge = [&](const ICmpInst *icmp, const DebugLoc &loc) {
      auto pred = predicateForICmp(icmp, vit->second, reached);
      if (!pred.hasValue())
        return;
      Edge e;
      e.src = n.id;
      e.dst = n.id;  // placeholder, refined below if possible
      e.head = "head_guard";
      e.pred = pred.getValue();
      e.function = F.getName().str();
      e.loc = loc;
      edges.push_back(e);
    };

    for (const Instruction *I : reached) {
      if (const BranchInst *br = dyn_cast<BranchInst>(I)) {
        if (!br->isConditional())
          continue;
        Value *cond = br->getCondition();
        if (const ICmpInst *icmp = dyn_cast<ICmpInst>(cond)) {
          addGuardEdge(icmp, getDebugLoc(icmp));
        }
      } else if (const SelectInst *sel = dyn_cast<SelectInst>(I)) {
        const Value *cond = sel->getCondition();
        if (const ICmpInst *icmp = dyn_cast<ICmpInst>(cond)) {
          addGuardEdge(icmp, getDebugLoc(icmp));
        }
      }
    }
  }

  return edges;
}

//===----------------------------------------------------------------------===//
// Sink extraction
//===----------------------------------------------------------------------===//

static std::vector<SinkCall> collectAllSinkCalls(Module &M) {
  std::vector<SinkCall> out;
  for (Function &F : M) {
    for (auto &BB : F) {
      for (auto &I : BB) {
        auto *CB = dyn_cast<CallBase>(&I);
        if (!CB)
          continue;
        Function *callee = CB->getCalledFunction();
        if (!callee)
          continue;
        unsigned idx;
        std::string role;
        if (!isSinkFunction(callee->getName(), idx, role))
          continue;
        if (idx >= CB->arg_size())
          continue;
        SinkCall sc;
        sc.call = CB;
        sc.sink.function = callee->getName().str();
        sc.sink.arg_index = idx;
        sc.sink.role = role;
        out.push_back(sc);
      }
    }
  }
  return out;
}

static std::map<std::string, std::vector<Sink>>
extractSinks(const std::vector<Node> &nodes, Function &F,
             std::map<std::string, std::set<const CallBase *>> *sinkCallsOut = nullptr) {
  std::map<std::string, std::vector<Sink>> sinks;

  for (const Node &n : nodes) {
    if (n.function != F.getName().str())
      continue;
    const Value *root = nullptr;
    for (auto &BB : F) {
      for (auto &I : BB) {
        if (valueRef(&I) == n.llvm_value) {
          root = &I;
          break;
        }
      }
      if (root) break;
    }
    if (!root) continue;

    std::set<const Instruction *> reached;
    collectReachableUsers(root, reached);

    for (const Instruction *I : reached) {
      const CallBase *CB = dyn_cast<CallBase>(I);
      if (!CB) continue;
      Function *callee = CB->getCalledFunction();
      if (!callee) continue;
      unsigned idx; std::string role;
      if (!isSinkFunction(callee->getName(), idx, role))
        continue;
      if (idx >= CB->arg_size()) continue;
      Value *arg = CB->getArgOperand(idx);
      // crude: arg text contains our source value name
      std::string rootName = valueRef(root);
      std::string argStr;
      raw_string_ostream rs(argStr);
      arg->print(rs);
      if (argStr.find(rootName) != std::string::npos ||
          reached.count(dyn_cast<Instruction>(arg))) {
        Sink k;
        k.function = callee->getName().str();
        k.arg_index = idx;
        k.role = role;
        sinks[n.id].push_back(k);
        if (sinkCallsOut)
          (*sinkCallsOut)[n.id].insert(CB);
      }
    }
  }
  return sinks;
}

//===----------------------------------------------------------------------===//
// Rule assembly
//===----------------------------------------------------------------------===//

static MutationHint hintForPredicate(const Predicate &p, const std::string &var) {
  MutationHint m;
  m.var = var;
  if (p.kind == "Gt" || p.kind == "Ge") {
    m.op = "SetBoundary"; m.side = "Above";
  } else if (p.kind == "Lt" || p.kind == "Le") {
    m.op = "SetBoundary"; m.side = "Below";
  } else if (p.kind == "Eq") {
    m.op = "SetValue"; m.value = p.value;
  } else if (p.kind == "Ne") {
    if (p.value.hasValue() && p.value.getValue() == 0) {
      m.op = "SetBoundary"; m.side = "Above";
    } else {
      m.op = "SampleRange";
    }
  } else if (p.kind == "BitSet") {
    m.op = "FlipBit"; m.bit = p.bit;
  } else if (p.kind == "BitClear") {
    m.op = "ClearBits"; m.bit = p.bit;
  } else {
    m.op = "SampleRange";
  }
  return m;
}

static bool predicatesEqual(const Predicate &a, const Predicate &b) {
  if (a.kind != b.kind)
    return false;
  if (a.value.hasValue() != b.value.hasValue())
    return false;
  if (a.value.hasValue() && a.value.getValue() != b.value.getValue())
    return false;
  if (a.bit.hasValue() != b.bit.hasValue())
    return false;
  if (a.bit.hasValue() && a.bit.getValue() != b.bit.getValue())
    return false;
  return true;
}

static bool predicatesNegate(const Predicate &a, const Predicate &b) {
  if (a.kind != invertPredicateKind(b.kind))
    return false;
  if (a.value.hasValue() && b.value.hasValue())
    return a.value.getValue() == b.value.getValue();
  if (a.bit.hasValue() && b.bit.hasValue())
    return a.bit.getValue() == b.bit.getValue();
  return false;
}

static std::vector<Rule> assembleRules(const std::vector<Node> &nodes,
                                        const std::vector<Edge> &selfEdges,
                                        const std::vector<Edge> &crossEdges,
                                        const std::map<std::string, std::vector<Sink>> &sinks) {
  std::vector<Rule> rules;
  std::map<std::string, Node> nodeById;
  for (const Node &n : nodes) nodeById[n.id] = n;

  for (const Edge &trigger : selfEdges) {
    auto sit = sinks.find(trigger.src);
    if (sit == sinks.end() || sit->second.empty())
      continue;

    std::vector<Edge> pre;
    for (const Edge &e : crossEdges) {
      if ((e.src == trigger.src || e.dst == trigger.src) && e.head == "head_guard") {
        // A guard that is the exact negation of the trigger is the early-exit
        // branch, not a precondition for reaching the sink.
        if (predicatesNegate(e.pred, trigger.pred))
          continue;
        pre.push_back(e);
      }
    }

    float score = 0.5f;
    if (trigger.pred.value.hasValue() || trigger.pred.bit.hasValue())
      score += 0.2f;
    if (!pre.empty()) score += 0.15f;
    if (!sit->second.empty()) score += 0.15f;
    if (score > 1.0f) score = 1.0f;

    Rule r;
    r.id = trigger.function + "-" + trigger.src;
    r.function = trigger.function;
    r.vars.push_back(nodeById[trigger.src]);
    r.preconditions = pre;
    r.trigger = trigger;
    r.mutation = hintForPredicate(trigger.pred, trigger.src);
    r.sinks = sit->second;
    r.confidence = score;
    rules.push_back(r);
  }
  return rules;
}

//===----------------------------------------------------------------------===//
// Global, cross-function rule builder
//===----------------------------------------------------------------------===//

static std::vector<Rule> buildGlobalRules(
    const std::vector<Node> &nodes,
    const std::map<std::string, std::vector<const Value *>> &nodeValues,
    const std::vector<Edge> &selfEdges,
    const std::vector<Edge> &crossEdges,
    Module &M) {
  std::vector<Rule> rules;
  std::map<std::string, Node> nodeById;
  for (const Node &n : nodes)
    nodeById[n.id] = n;

  // Forward dataflow edges: operand -> result.
  std::map<const Value *, std::set<const Value *>> fwd;
  for (Function &F : M) {
    for (auto &BB : F) {
      for (auto &I : BB) {
        for (unsigned i = 0; i < I.getNumOperands(); ++i) {
          if (const Value *op = I.getOperand(i))
            fwd[op].insert(&I);
        }
      }
    }
  }

  // Call argument edges: actual -> formal.
  for (Function &F : M) {
    for (auto &BB : F) {
      for (auto &I : BB) {
        auto *CB = dyn_cast<CallBase>(&I);
        if (!CB)
          continue;
        Function *callee = CB->getCalledFunction();
        if (!callee || callee->isDeclaration())
          continue;
        unsigned limit = std::min<unsigned>(CB->arg_size(), callee->arg_size());
        for (unsigned i = 0; i < limit; ++i)
          fwd[CB->getArgOperand(i)].insert(callee->getArg(i));
      }
    }
  }

  // Collect return values per function.
  std::map<const Function *, std::set<const Value *>> retVals;
  for (Function &F : M) {
    for (auto &BB : F) {
      for (auto &I : BB) {
        if (auto *RI = dyn_cast<ReturnInst>(&I)) {
          if (Value *rv = RI->getReturnValue())
            retVals[&F].insert(rv);
        }
      }
    }
  }

  // Return edges: return value -> call result.
  for (Function &F : M) {
    for (auto &BB : F) {
      for (auto &I : BB) {
        auto *CB = dyn_cast<CallBase>(&I);
        if (!CB)
          continue;
        Function *callee = CB->getCalledFunction();
        if (!callee)
          continue;
        auto it = retVals.find(callee);
        if (it != retVals.end()) {
          for (const Value *rv : it->second)
            fwd[rv].insert(CB);
        }
      }
    }
  }

  // Collect all sink calls.
  std::vector<SinkCall> sinkCalls = collectAllSinkCalls(M);
  std::map<const Value *, std::vector<std::pair<const CallBase *, unsigned>>> sinkArgMap;
  for (const SinkCall &sc : sinkCalls) {
    Value *arg = sc.call->getArgOperand(sc.sink.arg_index);
    sinkArgMap[arg].push_back({sc.call, sc.sink.arg_index});
  }

  // BFS from each source value and record reached sink arguments.
  std::set<std::tuple<std::string, const CallBase *, unsigned>> records;
  for (const auto &kv : nodeValues) {
    const std::string &nid = kv.first;
    for (const Value *src : kv.second) {
      std::set<const Value *> visited;
      std::vector<const Value *> work = {src};
      while (!work.empty()) {
        const Value *cur = work.back();
        work.pop_back();
        if (!visited.insert(cur).second)
          continue;

        auto sIt = sinkArgMap.find(cur);
        if (sIt != sinkArgMap.end()) {
          for (const auto &p : sIt->second)
            records.insert(std::make_tuple(nid, p.first, p.second));
        }

        auto fIt = fwd.find(cur);
        if (fIt != fwd.end()) {
          for (const Value *nxt : fIt->second)
            work.push_back(nxt);
        }
      }
    }
  }

  // Group by (node id, sink call) to collect all reached argument positions.
  std::map<std::pair<std::string, const CallBase *>, std::set<unsigned>> callArgs;
  for (const auto &rec : records) {
    const std::string &nid = std::get<0>(rec);
    const CallBase *CB = std::get<1>(rec);
    unsigned argIdx = std::get<2>(rec);
    callArgs[{nid, CB}].insert(argIdx);
  }

  // Index self edges by source node id.
  std::map<std::string, std::vector<Edge>> selfEdgesByNode;
  for (const Edge &e : selfEdges) {
    if (e.self)
      selfEdgesByNode[e.src].push_back(e);
  }

  std::set<std::string> ruleIds;
  for (const auto &kv : callArgs) {
    const std::string &nid = kv.first.first;
    const CallBase *CB = kv.first.second;

    auto nit = nodeById.find(nid);
    if (nit == nodeById.end())
      continue;

    // Build sink list for this rule.
    std::vector<Sink> ruleSinks;
    for (unsigned argIdx : kv.second) {
      for (const SinkCall &sc : sinkCalls) {
        if (sc.call == CB && sc.sink.arg_index == argIdx) {
          ruleSinks.push_back(sc.sink);
          break;
        }
      }
    }

    // Choose a trigger for this source.
    Edge trigger;
    trigger.src = nid;
    trigger.dst = nid;
    trigger.function = CB->getFunction()->getName().str();
    trigger.loc = getDebugLoc(CB);

    std::string sourceFunction = nit->second.function;
    auto sIt = selfEdgesByNode.find(nid);
    if (sIt != selfEdgesByNode.end() && !sIt->second.empty()) {
      trigger = sIt->second.front();
      // Prefer a self edge located in the same function as the source node and
      // with a concrete predicate.
      for (const Edge &e : sIt->second) {
        if (e.function == sourceFunction &&
            (e.pred.value.hasValue() || e.pred.bit.hasValue())) {
          trigger = e;
          break;
        }
      }
      // Otherwise pick any concrete-predicate edge.
      if (!(trigger.pred.value.hasValue() || trigger.pred.bit.hasValue())) {
        for (const Edge &e : sIt->second) {
          if (e.pred.value.hasValue() || e.pred.bit.hasValue()) {
            trigger = e;
            break;
          }
        }
      }
    } else {
      trigger.head = "head_bound";
      Predicate p;
      if (nit->second.source.feature_bit.hasValue()) {
        p.kind = "BitSet";
        p.bit = nit->second.source.feature_bit.getValue();
      } else {
        p.kind = "Ne";
        p.value = 0;
      }
      trigger.pred = p;
    }

    // If the source reaches a sink and the chosen trigger matches an
    // early-exit guard, flip it so the mutation targets the sink-reaching
    // branch.
    bool reachesSink = false;
    for (const auto &rec : records) {
      if (std::get<0>(rec) == nid) {
        reachesSink = true;
        break;
      }
    }
    if (reachesSink) {
      for (const Edge &e : crossEdges) {
        if (e.head == "head_guard" && e.src == nid &&
            predicatesEqual(e.pred, trigger.pred)) {
          trigger.pred = invertPredicate(trigger.pred);
          break;
        }
      }
    }

    // Filter preconditions that are just the negation of the trigger.
    std::vector<Edge> pre;
    for (const Edge &e : crossEdges) {
      if ((e.src == nid || e.dst == nid) && e.head == "head_guard") {
        if (predicatesNegate(e.pred, trigger.pred))
          continue;
        pre.push_back(e);
      }
    }

    Rule r;
    r.id = trigger.function + "-" + nid;
    if (ruleIds.count(r.id))
      continue;
    ruleIds.insert(r.id);
    r.function = trigger.function;
    r.vars.push_back(nit->second);
    r.preconditions = pre;
    r.trigger = trigger;
    r.mutation = hintForPredicate(trigger.pred, nid);
    r.sinks = ruleSinks;
    r.confidence = 0.5f;
    if (trigger.pred.value.hasValue() || trigger.pred.bit.hasValue())
      r.confidence += 0.2f;
    if (!pre.empty())
      r.confidence += 0.15f;
    if (!ruleSinks.empty())
      r.confidence += 0.15f;
    if (r.confidence > 1.0f)
      r.confidence = 1.0f;
    rules.push_back(r);
  }

  return rules;
}

//===----------------------------------------------------------------------===//
// Pass
//===----------------------------------------------------------------------===//

struct SDGExtractPass : public PassInfoMixin<SDGExtractPass> {
  std::vector<Node> allNodes;
  std::vector<Edge> allSelfEdges;
  std::vector<Edge> allCrossEdges;
  std::map<std::string, std::vector<Sink>> allSinks;
  std::map<std::string, std::set<const CallBase *>> allSinkCalls;
  std::map<std::string, std::vector<const Value *>> nodeValues;

  PreservedAnalyses run(Module &M, ModuleAnalysisManager &) {
    // Load optional entry list to scope analysis.
    std::set<std::string> entries;
    if (!SDGEntryList.empty()) {
      if (auto buf = MemoryBuffer::getFile(SDGEntryList)) {
        StringRef data = buf.get()->getBuffer();
        SmallVector<StringRef, 8> lines;
        data.split(lines, '\n');
        for (StringRef line : lines) {
          line = line.trim();
          if (!line.empty())
            entries.insert(line.str());
        }
      }
    }

    for (Function &F : M) {
      if (F.isDeclaration())
        continue;
      if (!entries.empty() && !entries.count(F.getName().str()))
        continue;

      std::vector<Node> nodes;
      for (auto &BB : F) {
        for (auto &I : BB) {
          if (auto *CB = dyn_cast<CallBase>(&I)) {
            if (auto n = tryExtractSource(CB, F.getName().str())) {
              nodes.push_back(n.getValue());
              nodeValues[n.getValue().id].push_back(CB);
            }
          } else if (auto *LI = dyn_cast<LoadInst>(&I)) {
            // In kernel bitcode readl() and friends are usually inlined into
            // volatile integer loads from a base + const offset pointer.
            if (LI->isVolatile()) {
              if (auto n = tryExtractMMIORead(LI->getPointerOperand(),
                                              LI->getType(), valueRef(LI),
                                              F.getName().str(), getDebugLoc(LI))) {
                nodes.push_back(n.getValue());
                nodeValues[n.getValue().id].push_back(LI);
              }
            }
          }
        }
      }

      std::map<std::string, std::set<const CallBase *>> sinkCalls;
      auto sinks = extractSinks(nodes, F, &sinkCalls);
      auto selfEdges = extractSelfEdges(nodes, F, sinkCalls);
      auto crossEdges = extractCrossEdges(nodes, F);

      allNodes.insert(allNodes.end(), nodes.begin(), nodes.end());
      allSelfEdges.insert(allSelfEdges.end(), selfEdges.begin(), selfEdges.end());
      allCrossEdges.insert(allCrossEdges.end(), crossEdges.begin(), crossEdges.end());
      allSinks.insert(sinks.begin(), sinks.end());
      allSinkCalls.insert(sinkCalls.begin(), sinkCalls.end());
    }

    auto rules = buildGlobalRules(allNodes, nodeValues, allSelfEdges, allCrossEdges, M);
    writeJSON(SDGOutputPath, allNodes, allSelfEdges, allCrossEdges, rules);

    return PreservedAnalyses::all();
  }
};

} // end anonymous namespace

//===----------------------------------------------------------------------===//
// Plugin registration
//===----------------------------------------------------------------------===//

extern "C" LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "SDGExtractPass", LLVM_VERSION_STRING,
          [](PassBuilder &PB) {
            PB.registerPipelineParsingCallback(
                [](StringRef Name, ModulePassManager &MPM,
                   ArrayRef<PassBuilder::PipelineElement>) {
                  if (Name == "sdg-extract") {
                    MPM.addPass(SDGExtractPass());
                    return true;
                  }
                  return false;
                });
          }};
}
