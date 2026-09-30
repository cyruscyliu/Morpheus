//===- SDGExtractPass.cpp - Extract SDG rules via SdgSvfCore ------------===//
//
// This pass extracts Semantic Dependency Graph (SDG) rules from LLVM bitcode
// using the SdgSvfCore infrastructure on top of SVF 3.3.
//
// Architecture:
//   SDGExtractPass  -> orchestration + JSON output
//   SdgSvfCore      -> source/sink catalogs, role taint, control dep, rules
//   SVF 3.3         -> SVFG, pointer analysis, ICFG
//
// No legacy hand-rolled value-flow graph remains in this file.
//
//===----------------------------------------------------------------------===//

#include "sdg/core/ControlDependencyAnalysis.h"
#include "sdg/core/Predicate.h"
#include "sdg/core/Role.h"
#include "sdg/core/RoleTaintAnalysis.h"
#include "sdg/core/Rule.h"
#include "sdg/core/RuleAssembler.h"
#include "sdg/core/SemanticSink.h"
#include "sdg/core/SemanticSource.h"
#include "sdg/core/SemanticValueFlowGraph.h"
#include "sdg/core/SinkCatalog.h"
#include "sdg/core/SourceCatalog.h"

#include "Graphs/SVFG.h"
#include "SVF-LLVM/LLVMModule.h"
#include "SVF-LLVM/SVFIRBuilder.h"
#include "SVFIR/SVFIR.h"
#include "llvm/IR/DataLayout.h"
#include "Util/ExtAPI.h"
#include "Util/Options.h"
#include "WPA/Andersen.h"

#include "llvm/IR/Dominators.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/ErrorHandling.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_ostream.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <map>
#include <queue>
#include <set>
#include <string>
#include <tuple>
#include <vector>

using namespace llvm;
using namespace SVF;
using namespace sdg::core;

static cl::opt<std::string> SDGOutputPath(
    "sdg-output",
    cl::desc("Path to write SDG extraction JSON output"),
    cl::value_desc("filename"),
    cl::init("sdg-rules.json"));

static cl::opt<std::string> SDGExtAPIPath(
    "sdg-extapi",
    cl::desc("Path to SVF extapi.bc (default: tool third_party install)"),
    cl::value_desc("filename"),
    cl::init(""));

namespace {

//===----------------------------------------------------------------------===//
// Partial DMA telemetry patch recognition
//===----------------------------------------------------------------------===//

static Optional<std::pair<const Value *, int64_t>>
baseAndConstantOffset(const Value *value, const DataLayout &dl);
static bool sharesProvenanceWalk(const Value *V,
                                 const std::set<const Value *> &roots,
                                 const DataLayout &dl,
                                 std::set<const Value *> &seen,
                                 unsigned depth);

// Evidence: the partial DMA telemetry patch
// (tools/linux/patches/linaro-cca-public-linux-upstream-v2-1558aa1d-sdg-extractor/
//  0001-hyperarm-virtio-dma-telemetry-partial.patch). HP_DMA_TRACE expands to
// hp_dma_trace_publish(vdev, op, dir, size, addr, use_dma) and
// hp_dma_trace_vq_state(vq, op, aux, kind); the opcode argument carries the
// HP_DMA_EVENT_OP_* constants listed below. Telemetry events never create
// nodes and never replace static sink detection; they confirm that a loaded
// value belongs to a DMA surface, help disambiguate coherent from streaming
// accesses, and confirm the DMA lifecycle of sinks.
struct TelemetryOpcode {
  unsigned value;
  const char *event;
  bool coherent; ///< true for coherent-surface events, false for streaming.
};

constexpr TelemetryOpcode kTelemetryOpcodes[] = {
    {0x01, "alloc_success", true},  {0x02, "alloc_fail", true},
    {0x03, "free", true},           {0x04, "map", false},
    {0x05, "map_fail", false},      {0x06, "unmap", false},
    {0x09, "vq_poll_hit", true},    {0x0a, "vq_poll_miss", true},
    {0x0b, "vq_get_buf", true},     {0x0c, "vq_get_buf_empty", true},
};

constexpr const char *kPublishFn = "hp_dma_trace_publish";
constexpr const char *kVqStateFn = "hp_dma_trace_vq_state";
/// Address operand index for each telemetry publisher signature.
constexpr unsigned kPublishAddrArg = 4;
/// The vq_state publisher's aux operand (arg 2) is a descriptor index or
/// ring ordinal, not generally a DMA address; its associable root is the
/// virtqueue pointer at arg 0.
constexpr unsigned kVqStateVqArg = 0;

/// If CB is a telemetry publisher call, return its documented event name,
/// the associable provenance root, whether the event belongs to the
/// coherent surface, and whether the root is a traced DMA address. The root
/// is the traced address for the publish signature and the virtqueue
/// pointer for the vq-state signature; the vq-state aux operand is never
/// used for association.
static Optional<std::tuple<std::string, const Value *, bool, bool>>
telemetryEventForCall(const CallBase *CB) {
  if (!CB || !CB->getCalledFunction())
    return llvm::None;
  const StringRef callee = CB->getCalledFunction()->getName();
  unsigned opcodeArg = 0;
  unsigned rootArg = 0;
  if (callee == kPublishFn) {
    opcodeArg = 1;
    rootArg = kPublishAddrArg;
  } else if (callee == kVqStateFn) {
    opcodeArg = 1;
    rootArg = kVqStateVqArg;
  } else {
    return llvm::None;
  }
  if (CB->arg_size() <= opcodeArg)
    return llvm::None;
  const auto *opcode = dyn_cast<ConstantInt>(CB->getArgOperand(opcodeArg));
  if (!opcode)
    return llvm::None;
  for (const TelemetryOpcode &entry : kTelemetryOpcodes) {
    if (entry.value == opcode->getZExtValue()) {
      const Value *root =
          CB->arg_size() > rootArg ? CB->getArgOperand(rootArg) : nullptr;
      bool addressRoot = callee == kPublishFn;
      return std::make_tuple(std::string(entry.event), root, entry.coherent,
                             addressRoot);
    }
  }
  return llvm::None;
}

/// Record per-function telemetry events in instruction order. `root` is the
/// associable provenance value; `addressRoot` is true when the root is a
/// traced DMA address (false for the vq-state virtqueue pointer root).
struct TelemetryEvent {
  std::string event;
  const Value *root;
  bool coherent;
  bool addressRoot;
};

/// Whether `target` can be reached from `root` through transparent pointer
/// operations and same-function store/load forwarding. Used to prove that a
/// traced telemetry address and a loaded value name the same buffer.
static bool tracesToValueRoot(const Value *root, const Value *target,
                              const DataLayout &dl, unsigned depth = 6) {
  if (!root || !target || depth == 0)
    return false;
  if (root == target)
    return true;
  const Value *base = root;
  if (auto *gep = dyn_cast<GEPOperator>(base))
    return tracesToValueRoot(gep->getPointerOperand(), target, dl, depth - 1);
  if (auto *cast = dyn_cast<CastInst>(base))
    return tracesToValueRoot(cast->getOperand(0), target, dl, depth - 1);
  if (auto *load = dyn_cast<LoadInst>(base)) {
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
          tracesToValueRoot(store->getValueOperand(), target, dl, depth - 1))
        return true;
    }
  }
  return false;
}

/// Collect the backward provenance closure of V: the values it traces to
/// through transparent pointer operations and same-function store/load
/// forwarding. Call results and arguments are roots.
static void collectProvenanceRoots(const Value *V, const DataLayout &dl,
                                   std::set<const Value *> &seen,
                                   unsigned depth) {
  if (!V || depth == 0 || !seen.insert(V).second)
    return;
  if (isa<CallBase>(V) || isa<Argument>(V))
    return;
  if (auto *gep = dyn_cast<GEPOperator>(V)) {
    collectProvenanceRoots(gep->getPointerOperand(), dl, seen, depth - 1);
    return;
  }
  if (auto *cast = dyn_cast<CastInst>(V)) {
    collectProvenanceRoots(cast->getOperand(0), dl, seen, depth - 1);
    return;
  }
  if (auto *sel = dyn_cast<SelectInst>(V)) {
    collectProvenanceRoots(sel->getTrueValue(), dl, seen, depth - 1);
    collectProvenanceRoots(sel->getFalseValue(), dl, seen, depth - 1);
    return;
  }
  if (auto *phi = dyn_cast<PHINode>(V)) {
    for (const Use &use : phi->incoming_values())
      collectProvenanceRoots(use.get(), dl, seen, depth - 1);
    return;
  }
  if (auto *load = dyn_cast<LoadInst>(V)) {
    collectProvenanceRoots(load->getPointerOperand(), dl, seen, depth - 1);
    auto location = baseAndConstantOffset(load->getPointerOperand(), dl);
    if (!location)
      return;
    for (const User *user : location->first->users()) {
      auto *store = dyn_cast<StoreInst>(user);
      if (!store || store->getFunction() != load->getFunction())
        continue;
      auto storedAt = baseAndConstantOffset(store->getPointerOperand(), dl);
      if (storedAt && storedAt->first == location->first &&
          storedAt->second == location->second)
        collectProvenanceRoots(store->getValueOperand(), dl, seen, depth - 1);
    }
  }
}

/// Whether two values share a provenance root: both trace back to a common
/// SSA value through transparent pointer operations and same-function
/// store/load forwarding.
static bool sharesProvenanceRoot(const Value *a, const Value *b,
                                 const DataLayout &dl) {
  if (!a || !b)
    return false;
  if (a == b)
    return true;
  std::set<const Value *> roots;
  collectProvenanceRoots(a, dl, roots, 6);
  if (roots.empty())
    return false;
  std::set<const Value *> seen;
  return sharesProvenanceWalk(b, roots, dl, seen, 6);
}

/// Walk the backward provenance closure of V looking for a member of
/// `roots`.
static bool sharesProvenanceWalk(const Value *V,
                                 const std::set<const Value *> &roots,
                                 const DataLayout &dl,
                                 std::set<const Value *> &seen,
                                 unsigned depth) {
  if (!V || depth == 0 || !seen.insert(V).second)
    return false;
  if (roots.count(V))
    return true;
  if (auto *gep = dyn_cast<GEPOperator>(V))
    return sharesProvenanceWalk(gep->getPointerOperand(), roots, dl, seen,
                                depth - 1);
  if (auto *cast = dyn_cast<CastInst>(V))
    return sharesProvenanceWalk(cast->getOperand(0), roots, dl, seen,
                                depth - 1);
  if (auto *load = dyn_cast<LoadInst>(V)) {
    auto location = baseAndConstantOffset(load->getPointerOperand(), dl);
    if (location) {
      for (const User *user : location->first->users()) {
        auto *store = dyn_cast<StoreInst>(user);
        if (!store || store->getFunction() != load->getFunction())
          continue;
        auto storedAt = baseAndConstantOffset(store->getPointerOperand(), dl);
        if (storedAt && storedAt->first == location->first &&
            storedAt->second == location->second &&
            sharesProvenanceWalk(store->getValueOperand(), roots, dl, seen,
                                 depth - 1))
          return true;
      }
    }
  }
  return false;
}

static std::map<const Function *, std::vector<TelemetryEvent>>
collectTelemetryEvents(const Module &M) {
  std::map<const Function *, std::vector<TelemetryEvent>> events;
  for (const Function &F : M) {
    if (F.isDeclaration())
      continue;
    for (const BasicBlock &BB : F) {
      for (const Instruction &I : BB) {
        if (auto *CB = dyn_cast<CallBase>(&I)) {
          if (auto found = telemetryEventForCall(CB)) {
            auto [event, root, coherent, addressRoot] = *found;
            events[&F].push_back({std::move(event), root, coherent,
                                  addressRoot});
          }
        }
      }
    }
  }
  return events;
}

/// Set telemetry_event metadata on DMA sources. An event confirms a source
/// when it lives in the same function and its surface family matches the
/// source's access kind, or when the traced address is the source value
/// itself. Events never create nodes or change source classes.
/// Set telemetry_event metadata on DMA sources. Association requires
/// address/value-flow evidence: the traced address must be the source value
/// itself or trace to it through transparent pointer operations and
/// same-function store/load forwarding. Same-function presence alone never
/// associates an event; telemetry never creates a source.
static void annotateSourceTelemetry(
    std::vector<SemanticSource> &sources,
    const std::map<const Function *, std::vector<TelemetryEvent>> &events,
    const Module &M) {
  const DataLayout &dl = M.getDataLayout();
  for (SemanticSource &src : sources) {
    if (src.schema.clazz != "Dma" || src.schema.telemetryEvent.hasValue())
      continue;
    if (!src.rootValue)
      continue;
    auto it = events.find(src.site ? src.site->getFunction() : nullptr);
    if (it == events.end())
      continue;
    for (const TelemetryEvent &event : it->second) {
      if (!event.root)
        continue;
      bool addressMatches =
          event.root->stripPointerCasts() == src.rootValue ||
          sharesProvenanceRoot(event.root, src.rootValue, dl);
      if (addressMatches) {
        src.schema.telemetryEvent = event.event;
        break;
      }
    }
  }
}

/// Confirm the DMA lifecycle of a sink: a MAP/UNMAP-family event whose traced
/// address flows into the sink marks the sink as telemetry confirmed.
static void annotateSinkTelemetry(
    SemanticSink &sink,
    const std::map<const Function *, std::vector<TelemetryEvent>> &events) {
  if (!sink.call)
    return;
  auto it = events.find(sink.call->getFunction());
  if (it == events.end())
    return;
  for (const TelemetryEvent &event : it->second) {
    // Only a MAP/UNMAP-family event whose traced address provably flows
    // into the sink confirms its DMA lifecycle; the vq-state virtqueue
    // pointer root does not confirm sinks.
    if (event.coherent || !event.addressRoot || !event.root)
      continue;
    const Value *addrBase = event.root->stripPointerCasts();
    bool flowsIn = false;
    for (unsigned i = 0, e = sink.call->arg_size(); i < e; ++i) {
      const Value *arg = sink.call->getArgOperand(i);
      if (arg->stripPointerCasts() == addrBase ||
          sharesProvenanceRoot(event.root, arg, sink.call->getModule()->getDataLayout())) {
        flowsIn = true;
        break;
      }
    }
    if (flowsIn) {
      sink.telemetryConfirmed = true;
      break;
    }
  }
}

//===----------------------------------------------------------------------===//
// JSON serialization helpers
//===----------------------------------------------------------------------===//

static json::Value toJSON(const Predicate &p) {
  json::Object obj;
  obj["kind"] = p.kind;
  // Numeric fields are two-complement bit patterns limited to the declared
  // width; serialize them as unsigned decimal so signed 64-bit constants
  // survive the round trip.
  if (p.value.hasValue())
    obj["value"] = static_cast<uint64_t>(p.value.getValue());
  if (p.bit.hasValue())
    obj["bit"] = static_cast<uint64_t>(p.bit.getValue());
  if (p.min.hasValue())
    obj["min"] = static_cast<uint64_t>(p.min.getValue());
  if (p.max.hasValue())
    obj["max"] = static_cast<uint64_t>(p.max.getValue());
  if (p.kind == "Lt" || p.kind == "Gt" || p.kind == "Le" ||
      p.kind == "Ge" || p.kind == "InRange")
    obj["signedness"] = sdg::core::signednessName(p.signedness);
  return json::Value(std::move(obj));
}

static json::Value toJSON(const Mutation &m) {
  json::Object obj;
  obj["operator"] = m.op;
  // Serialize as uint64 so large masks and 64-bit constants round-trip.
  if (m.value.hasValue())
    obj["value"] = static_cast<uint64_t>(m.value.getValue());
  if (m.bit.hasValue())
    obj["bit"] = static_cast<uint64_t>(m.bit.getValue());
  if (m.min.hasValue())
    obj["min"] = static_cast<uint64_t>(m.min.getValue());
  if (m.max.hasValue())
    obj["max"] = static_cast<uint64_t>(m.max.getValue());
  if (m.side.hasValue())
    obj["side"] = m.side.getValue();
  if (!m.var.empty())
    obj["var"] = m.var;
  return json::Value(std::move(obj));
}

static json::Value debugLocJSON(const DebugLoc &loc) {
  json::Object obj;
  if (loc) {
    obj["file"] = loc->getFilename().str();
    obj["line"] = static_cast<int64_t>(loc->getLine());
  } else {
    obj["file"] = "";
    obj["line"] = 0;
  }
  return json::Value(std::move(obj));
}

static json::Value toJSON(const SourceSchema &src) {
  json::Object obj;
  obj["class"] = src.clazz;
  obj["access_kind"] = src.accessKind;
  obj["offset"] = src.offset.hasValue()
                      ? json::Value(static_cast<int64_t>(src.offset.getValue()))
                      : json::Value(nullptr);
  obj["feature_bit"] =
      src.featureBit.hasValue()
          ? json::Value(static_cast<int64_t>(src.featureBit.getValue()))
          : json::Value(nullptr);
  obj["feature_word_selector"] =
      src.featureWordSelector.hasValue()
          ? json::Value(static_cast<int64_t>(src.featureWordSelector.getValue()))
          : json::Value(nullptr);
  obj["node_local_bit"] =
      src.nodeLocalBit.hasValue()
          ? json::Value(static_cast<int64_t>(src.nodeLocalBit.getValue()))
          : json::Value(nullptr);
  obj["size_bytes"] =
      src.widthBytes.hasValue()
          ? json::Value(static_cast<int64_t>(src.widthBytes.getValue()))
          : json::Value(nullptr);
  json::Object valueType;
  valueType["width_bits"] = src.valueType.widthBits
                                  ? static_cast<int64_t>(src.valueType.widthBits)
                                  : (src.widthBytes.hasValue()
                                         ? static_cast<int64_t>(src.widthBytes.getValue() * 8)
                                         : static_cast<int64_t>(0));
  switch (src.valueType.signedness) {
  case ValueType::Signedness::Signed:
    valueType["signedness"] = "Signed";
    break;
  case ValueType::Signedness::Unsigned:
    valueType["signedness"] = "Unsigned";
    break;
  default:
    valueType["signedness"] = "Unknown";
    break;
  }
  obj["value_type"] = json::Value(std::move(valueType));
  obj["field"] = src.field.empty() ? json::Value(nullptr) : json::Value(src.field);
  obj["slot"] = src.slot.hasValue()
                    ? json::Value(static_cast<int64_t>(src.slot.getValue()))
                    : json::Value(nullptr);
  obj["direction"] = src.direction.empty() ? json::Value(nullptr)
                                             : json::Value(src.direction);
  json::Array requiredFeatures;
  for (const std::string &feature : src.requiredFeaturesAnyOf)
    requiredFeatures.push_back(feature);
  obj["required_features_any_of"] = json::Value(std::move(requiredFeatures));
  obj["evidence"] = src.evidence.empty() ? json::Value(nullptr)
                                           : json::Value(src.evidence);
  json::Array validValues;
  for (uint64_t value : src.validValues)
    validValues.push_back(static_cast<uint64_t>(value));
  obj["valid_values"] = json::Value(std::move(validValues));
  obj["valid_mask"] = src.validMask.hasValue()
                          ? json::Value(static_cast<uint64_t>(src.validMask.getValue()))
                          : json::Value(nullptr);
  obj["telemetry_event"] = src.telemetryEvent.hasValue()
                               ? json::Value(src.telemetryEvent.getValue())
                               : json::Value(nullptr);
  return json::Value(std::move(obj));
}

static json::Value toJSON(const SemanticSource &src) {
  json::Object obj;
  obj["id"] = src.schema.id;
  obj["source"] = toJSON(src.schema);
  obj["llvm_value"] = src.rootValue && src.rootValue->hasName()
                          ? src.rootValue->getName().str()
                          : std::string("");
  obj["function"] = src.function;
  obj["debug_loc"] = debugLocJSON(src.loc);
  return json::Value(std::move(obj));
}

static json::Value toJSON(const SemanticSink &sink) {
  json::Object obj;
  obj["function"] = sink.function;
  obj["arg_index"] = static_cast<int64_t>(sink.argIndex);
  obj["role"] = roleName(sink.role);
  obj["telemetry_confirmed"] = sink.telemetryConfirmed;
  return json::Value(std::move(obj));
}

static json::Value toJSON(const Edge &e) {
  json::Object obj;
  obj["src"] = e.src;
  obj["dst"] = e.dst;
  obj["head"] = e.head;
  obj["predicate"] = toJSON(e.pred);
  obj["function"] = e.function;
  obj["debug_loc"] = debugLocJSON(e.loc);
  obj["evidence"] = e.evidence;
  return json::Value(std::move(obj));
}

static json::Value toJSON(const Rule &r) {
  json::Object obj;
  obj["id"] = r.id;
  obj["function"] = r.function;

  json::Array vars;
  for (const SemanticSource &src : r.vars)
    vars.push_back(toJSON(src));
  obj["vars"] = json::Value(std::move(vars));

  json::Array sinks;
  for (const SemanticSink &sink : r.sinks)
    sinks.push_back(toJSON(sink));
  obj["sinks"] = json::Value(std::move(sinks));

  json::Array pre;
  for (const Edge &e : r.preconditions)
    pre.push_back(toJSON(e));
  obj["preconditions"] = json::Value(std::move(pre));

  obj["target_state"] = toJSON(r.trigger);
  obj["mutation"] = toJSON(r.mutation);
  obj["confidence"] = r.confidence;
  return json::Value(std::move(obj));
}

static std::string canonicalNodeId(const SourceSchema &src) {
  if (src.field.empty() &&
      (StringRef(src.id).startswith("mmio:") ||
       StringRef(src.id).startswith("coherent:") ||
       StringRef(src.id).startswith("streaming:") ||
       StringRef(src.id).startswith("internal:")))
    return src.id;
  const std::string field =
      src.field.empty() ? (src.id.empty() ? "value" : src.id) : src.field;
  if (src.clazz == "InternalState")
    return "internal:" + field;

  std::string kind;
  if (src.clazz == "Mmio") {
    kind = "mmio:";
    kind += src.offset.hasValue() ? std::to_string(src.offset.getValue()) : "unknown";
  } else if (src.clazz == "Dma") {
    kind = src.accessKind == "streaming"
               ? "streaming:" +
                     std::to_string(src.slot.hasValue() ? src.slot.getValue()
                                                        : 0) +
                     ":"
               : "coherent:";
    kind += src.offset.hasValue() ? std::to_string(src.offset.getValue()) : "unknown";
  }
  kind += ":";
  kind += src.widthBytes.hasValue() ? std::to_string(src.widthBytes.getValue()) : "0";
  kind += ":";
  kind += field;
  return kind;
}

static std::string predicateText(const Predicate &p) {
  // Canonical predicate serialization from the SDG document: decimal values
  // without leading zeroes and explicit signedness for relational predicates.
  if (p.kind == "BitSet")
    return "bit_set:" +
           std::to_string(p.bit.hasValue() ? p.bit.getValue() : 0);
  if (p.kind == "BitClear")
    return "bit_clear:" +
           std::to_string(p.bit.hasValue() ? p.bit.getValue() : 0);
  if (p.kind == "InRange")
    return "in_range:" +
           std::string(StringRef(sdg::core::signednessName(p.signedness)).lower()) +
           ":" + std::to_string(p.min.hasValue() ? p.min.getValue() : 0) + ":" +
           std::to_string(p.max.hasValue() ? p.max.getValue() : 0);
  if (p.kind == "Eq" || p.kind == "Ne") {
    std::string kind = p.kind;
    std::transform(kind.begin(), kind.end(), kind.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return kind + ":" +
           std::to_string(p.value.hasValue() ? p.value.getValue() : 0);
  }
  std::string kind = p.kind;
  std::transform(kind.begin(), kind.end(), kind.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return kind + ":" +
         std::string(StringRef(sdg::core::signednessName(p.signedness)).lower()) +
         ":" + std::to_string(p.value.hasValue() ? p.value.getValue() : 0);
}

static std::string canonicalRuleId(const Rule &r) {
  return "rule:" + r.function + "|target:" + r.trigger.dst +
         "|predicate:" + predicateText(r.trigger.pred);
}

//===----------------------------------------------------------------------===//
// Grammar-compliant self-edge and cross-edge extraction
//===----------------------------------------------------------------------===//

static bool isTransparentUse(const User *U) {
  if (isa<CastInst>(U) || isa<PHINode>(U) || isa<SelectInst>(U) ||
      isa<UnaryOperator>(U))
    return true;
  if (auto *BO = dyn_cast<BinaryOperator>(U)) {
    auto op = BO->getOpcode();
    return op == Instruction::And || op == Instruction::Or ||
           op == Instruction::Add || op == Instruction::Sub;
  }
  return false;
}

/// reachable_uses from grammar-extraction.md: traverse casts, phi, select,
/// zext/sext/trunc, and and/or bit operations, yielding other users.
static std::vector<const Value *>
reachableUses(const Value *root) {
  std::vector<const Value *> yielded;
  std::set<const Value *> seen;
  std::vector<const Value *> work = {root};
  while (!work.empty()) {
    const Value *v = work.back();
    work.pop_back();
    if (!seen.insert(v).second)
      continue;
    for (const User *U : v->users()) {
      if (isTransparentUse(U))
        work.push_back(U);
      else
        yielded.push_back(U);
    }
  }
  return yielded;
}

static Optional<std::pair<const Value *, int64_t>>
baseAndConstantOffset(const Value *value, const DataLayout &layout) {
  if (!value)
    return llvm::None;
  int64_t total = 0;
  const Value *current = value;
  while (true) {
    current = current->stripPointerCasts();
    auto *gep = dyn_cast<GEPOperator>(current);
    if (!gep)
      return std::make_pair(current, total);
    if (!gep->hasAllConstantIndices())
      return llvm::None;
    APInt offset(64, 0);
    if (!gep->accumulateConstantOffset(layout, offset) ||
        offset.getSignificantBits() > 63)
      return llvm::None;
    total += offset.getSExtValue();
    current = gep->getPointerOperand();
  }
}

static void collectLoadsForwardedThroughCalls(
    const Value *base, int64_t targetOffset, const DataLayout &layout,
    std::set<std::pair<const Value *, int64_t>> &seen,
    std::vector<const LoadInst *> &loads) {
  if (!base || !seen.insert({base, targetOffset}).second)
    return;
  const Function *function = nullptr;
  if (auto *argument = dyn_cast<Argument>(base))
    function = argument->getParent();
  else if (auto *instruction = dyn_cast<Instruction>(base))
    function = instruction->getFunction();
  if (!function)
    return;

  for (const BasicBlock &block : *function) {
    for (const Instruction &instruction : block) {
      if (auto *load = dyn_cast<LoadInst>(&instruction)) {
        auto location = baseAndConstantOffset(load->getPointerOperand(), layout);
        if (location && location->first == base &&
            location->second == targetOffset)
          loads.push_back(load);
      }
      auto *call = dyn_cast<CallBase>(&instruction);
      if (!call || !call->getCalledFunction() ||
          call->getCalledFunction()->isDeclaration())
        continue;
      Function *callee = call->getCalledFunction();
      for (unsigned index = 0; index < call->arg_size() &&
                               index < callee->arg_size();
           ++index) {
        auto actual = baseAndConstantOffset(call->getArgOperand(index), layout);
        if (!actual || actual->first != base || actual->second > targetOffset)
          continue;
        collectLoadsForwardedThroughCalls(
            callee->getArg(index), targetOffset - actual->second, layout,
            seen, loads);
      }
    }
  }
}

static SourceSchema internalStateSchema(const SourceSchema &physical,
                                        const std::string &field) {
  SourceSchema s;
  s.id = "InternalState." + field;
  s.clazz = "InternalState";
  s.accessKind = "state";
  s.widthBytes = physical.widthBytes;
  s.field = field;
  s.direction = physical.direction;
  s.evidence = physical.evidence;
  s.valueType = physical.valueType;
  return s;
}

static void expandStoredSourceAliases(std::vector<SemanticSource> &sources,
                                      std::vector<Edge> &crossDataflow,
                                      const Module &module) {
  const DataLayout &layout = module.getDataLayout();
  std::vector<SemanticSource> aliases;
  std::set<std::pair<std::string, const Value *>> emitted;
  for (const SemanticSource &source : sources) {
    std::set<const Value *> seenValues;
    std::queue<const Value *> work;
    seenValues.insert(source.rootValue);
    work.push(source.rootValue);
    while (!work.empty()) {
      const Value *value = work.front();
      work.pop();
      for (const User *user : value->users()) {
        if (isTransparentUse(user)) {
          if (seenValues.insert(user).second)
            work.push(user);
          continue;
        }
        auto *store = dyn_cast<StoreInst>(user);
        if (!store || store->getValueOperand() != value)
          continue;
        auto storedAt = baseAndConstantOffset(store->getPointerOperand(), layout);
        if (!storedAt)
          continue;
        std::set<std::pair<const Value *, int64_t>> seenLocations;
        std::vector<const LoadInst *> loads;
        collectLoadsForwardedThroughCalls(storedAt->first, storedAt->second,
                                          layout, seenLocations, loads);
        for (const LoadInst *load : loads) {
          if (!emitted.insert({source.schema.id, load}).second)
            continue;
          if (load->getFunction() == store->getFunction()) {
            // Same-function alias: preserve physical source identity.
            SemanticSource alias = source;
            alias.rootValue = load;
            alias.site = load;
            alias.function = load->getFunction()->getName().str();
            alias.loc = load->getDebugLoc();
            aliases.push_back(std::move(alias));
          } else {
            // Cross-function load: create an InternalState analysis node
            // and a head_dataflow edge back to the physical source.
            SemanticSource state = source;
            state.schema = internalStateSchema(source.schema, source.schema.field);
            state.schema.id = canonicalNodeId(state.schema);
            state.rootValue = load;
            state.site = load;
            state.function = load->getFunction()->getName().str();
            state.loc = load->getDebugLoc();

            Edge e;
            e.src = canonicalNodeId(source.schema);
            e.dst = canonicalNodeId(state.schema);
            e.head = heads::kDataflow;
            e.pred = Predicate{"Identity", llvm::None, llvm::None};
            e.function = state.function;
            e.loc = load->getDebugLoc();
            e.site = load;
            crossDataflow.push_back(std::move(e));

            aliases.push_back(std::move(state));
          }
        }
      }
    }
  }
  sources.insert(sources.end(), aliases.begin(), aliases.end());
}

/// A value is an error when it is a negative error-code constant, a null
/// pointer, a phi that merges negative error codes, or a call whose argument
/// is error-derived (the kernel convention is ERR_PTR-style error returns
/// built from negative codes). No function-name heuristics are used.
static bool valueIsError(const Value *V, unsigned depth = 4) {
  if (!V || depth == 0)
    return false;
  if (auto *CI = dyn_cast<ConstantInt>(V)) {
    if (CI->getSExtValue() < 0)
      return true;
  }
  if (isa<ConstantPointerNull>(V))
    return true;
  if (auto *PN = dyn_cast<PHINode>(V)) {
    if (!PN->getType()->isIntegerTy())
      return false;
    for (const Use &use : PN->incoming_values()) {
      if (auto *CI = dyn_cast<ConstantInt>(use.get()))
        if (CI->isNegative())
          return true;
    }
  }
  if (auto *CB = dyn_cast<CallBase>(V)) {
    for (const Use &use : CB->args())
      if (valueIsError(use.get(), depth - 1))
        return true;
  }
  if (auto *Cast = dyn_cast<CastInst>(V))
    return valueIsError(Cast->getOperand(0), depth - 1);
  return false;
}

static bool blockHasErrorCall(const BasicBlock *BB) {
  if (!BB)
    return false;
  for (const Instruction &I : *BB) {
    if (auto *CB = dyn_cast<CallBase>(&I)) {
      if (const Function *F = CB->getCalledFunction()) {
        if (F->doesNotReturn())
          return true;
      }
    }
    if (isa<UnreachableInst>(&I))
      return true;
  }
  return false;
}

/// A block reached from `pred` that merges a negative error-code constant
/// into a phi is an error path: the kernel convention is negative error
/// returns, and shared error blocks merge them into one phi.
static bool blockHasErrorPhi(const BasicBlock *BB, const BasicBlock *pred) {
  if (!BB || !pred)
    return false;
  for (const Instruction &I : *BB) {
    if (auto *PN = dyn_cast<PHINode>(&I)) {
      if (!PN->getType()->isIntegerTy())
        continue;
      int idx = PN->getBasicBlockIndex(pred);
      if (idx < 0)
        continue;
      if (auto *CI = dyn_cast<ConstantInt>(PN->getIncomingValue(idx)))
        if (CI->isNegative())
          return true;
    }
  }
  return false;
}

/// Return true if BB, when reached from pred, returns an error value, calls
/// an error handler, or merges a negative error code.  This handles phi nodes
/// in a shared return block.
static bool isErrorEdge(const BasicBlock *BB, const BasicBlock *pred) {
  if (!BB || !pred)
    return false;
  if (blockHasErrorCall(BB))
    return true;
  if (blockHasErrorPhi(BB, pred))
    return true;
  for (const Instruction &I : *BB) {
    if (auto *RI = dyn_cast<ReturnInst>(&I)) {
      const Value *rv = RI->getReturnValue();
      if (rv) {
        if (auto *PN = dyn_cast<PHINode>(rv)) {
          int idx = PN->getBasicBlockIndex(pred);
          if (idx >= 0)
            rv = PN->getIncomingValue(idx);
          else
            continue;
        }
        if (valueIsError(rv))
          return true;
      }
    }
  }
  return false;
}

/// Mask a constant to the semantic width of the source. Unknown/zero width
/// keeps the raw value.
static uint64_t normalizeToWidth(uint64_t value, unsigned widthBits) {
  if (widthBits == 0 || widthBits >= 64)
    return value;
  return value & ((1ull << widthBits) - 1);
}

/// Whether a compared constant is representable in the source's unsigned
/// width domain. A bound that cannot hold at the source width is tautological
/// and must be rejected rather than wrapped or truncated.
static bool constantFitsWidthDomain(uint64_t value, unsigned widthBits) {
  if (widthBits == 0 || widthBits >= 64)
    return true;
  return value <= ((1ull << widthBits) - 1);
}

/// Map an LLVM integer predicate to an SDG predicate kind.
static std::string predicateKindForICmp(ICmpInst::Predicate pred,
                                        bool invert) {
  switch (pred) {
  case ICmpInst::ICMP_EQ:
    return invert ? "Ne" : "Eq";
  case ICmpInst::ICMP_NE:
    return invert ? "Eq" : "Ne";
  case ICmpInst::ICMP_UGT:
  case ICmpInst::ICMP_SGT:
    return invert ? "Le" : "Gt";
  case ICmpInst::ICMP_ULT:
  case ICmpInst::ICMP_SLT:
    return invert ? "Ge" : "Lt";
  case ICmpInst::ICMP_UGE:
  case ICmpInst::ICMP_SGE:
    return invert ? "Lt" : "Ge";
  case ICmpInst::ICMP_ULE:
  case ICmpInst::ICMP_SLE:
    return invert ? "Gt" : "Le";
  default:
    return "Ne";
  }
}

/// If V is `X & (1 << b)` or `(1 << b) & X`, return (X, b).
static Optional<std::pair<const Value *, unsigned>>
extractBitAnd(const Value *V) {
  auto *BO = dyn_cast<BinaryOperator>(V);
  if (!BO || BO->getOpcode() != Instruction::And)
    return llvm::None;
  const Value *lhs = BO->getOperand(0);
  const Value *rhs = BO->getOperand(1);
  auto bitFromValue = [](const Value *C) -> Optional<unsigned> {
    if (auto *CI = dyn_cast<ConstantInt>(C)) {
      const APInt &v = CI->getValue();
      if (v.countPopulation() == 1)
        return v.countTrailingZeros();
    }
    return llvm::None;
  };
  if (auto b = bitFromValue(rhs))
    return std::make_pair(lhs, *b);
  if (auto b = bitFromValue(lhs))
    return std::make_pair(rhs, *b);
  return llvm::None;
}

/// Sign-extend a two-complement bit pattern of the given width to i128 so
/// signed bound comparisons follow signed ordering.
static int64_t signedPatternValue(uint64_t pattern, unsigned widthBits) {
  if (widthBits == 0 || widthBits >= 64)
    return static_cast<int64_t>(pattern);
  uint64_t signBit = 1ull << (widthBits - 1);
  if (pattern & signBit)
    return static_cast<int64_t>(pattern | ~((1ull << widthBits) - 1));
  return static_cast<int64_t>(pattern);
}

struct IcmpBound {
  const ICmpInst *inst;
  ICmpInst::Predicate predicate;
  uint64_t value;
  bool isLower;
  bool isUpper;
  sdg::core::Signedness signedness;
  const CallBase *contextCall = nullptr; ///< Call that motivated this bound.
};

/// Return true if `value` equals `root` or can be reached from `root` through
/// transparent operations (casts, zext/sext/trunc, and/or/add/sub).
static bool isDerivedFromRoot(const Value *value, const Value *root);

/// Return true if `value` can be reached from `root` through pure casts,
/// phi, select, and unary operators. Per the extraction document these are
/// traversal-only operations: arithmetic is a yielded user, not a transparent
/// intermediate.
static bool isCastDerivedFromRoot(const Value *value, const Value *root) {
  if (value == root)
    return true;
  std::set<const Value *> seen;
  std::vector<const Value *> work = {value};
  while (!work.empty()) {
    const Value *v = work.back();
    work.pop_back();
    if (!seen.insert(v).second)
      continue;
    if (v == root)
      return true;
    if (auto *I = dyn_cast<Instruction>(v)) {
      if (isa<CastInst>(I) || isa<PHINode>(I) || isa<SelectInst>(I) ||
          isa<UnaryOperator>(I)) {
        for (const Value *op : I->operand_values())
          work.push_back(op);
      }
    }
  }
  return false;
}

static bool isEqualityPredicate(ICmpInst::Predicate pred) {
  return pred == ICmpInst::ICMP_EQ || pred == ICmpInst::ICMP_NE;
}

static Optional<IcmpBound>
extractIcmpBound(const ICmpInst *ICI, const Value *root,
                 const std::vector<const Value *> &uses,
                 unsigned widthBits) {
  for (unsigned i = 0; i < 2; ++i) {
    const Value *candidate = ICI->getOperand(i);
    const Value *otherOp = ICI->getOperand(1 - i);
    auto *CI = dyn_cast<ConstantInt>(otherOp);
    if (!CI)
      continue;
    // Transparent operations (sext/zext/...) between the root and the
    // compared operand keep the derivation; arithmetic intermediates are
    // yielded users per the extraction document and are only admitted when
    // the comparison itself is a reachable use.
    if (candidate != root && !isCastDerivedFromRoot(candidate, root) &&
        std::find(uses.begin(), uses.end(), candidate) == uses.end())
      continue;

    IcmpBound b;
    b.inst = ICI;
    b.predicate = i == 0 ? ICI->getPredicate()
                         : ICmpInst::getSwappedPredicate(ICI->getPredicate());
    b.isLower = false;
    b.isUpper = false;
    b.signedness = ICI->isSigned() ? sdg::core::Signedness::Signed
                                   : sdg::core::Signedness::Unsigned;
    // A bound whose constant cannot hold in the source's unsigned width
    // domain is tautological at that width: reject it instead of wrapping or
    // truncating the constant into a fabricated rule. Signed thresholds keep
    // their two-complement pattern at the source width.
    if (b.signedness == sdg::core::Signedness::Signed)
      b.value = normalizeToWidth(static_cast<uint64_t>(CI->getZExtValue()), widthBits);
    else if (!constantFitsWidthDomain(static_cast<uint64_t>(CI->getZExtValue()), widthBits))
      return llvm::None;
    else
      b.value = static_cast<uint64_t>(CI->getZExtValue());
    switch (b.predicate) {
    case ICmpInst::ICMP_UGT:
    case ICmpInst::ICMP_SGT:
      b.isLower = true;
      break;
    case ICmpInst::ICMP_ULT:
    case ICmpInst::ICMP_SLT:
      b.isUpper = true;
      break;
    case ICmpInst::ICMP_UGE:
    case ICmpInst::ICMP_SGE:
      b.isLower = true;
      break;
    case ICmpInst::ICMP_ULE:
    case ICmpInst::ICMP_SLE:
      b.isUpper = true;
      break;
    case ICmpInst::ICMP_EQ:
    case ICmpInst::ICMP_NE:
      // Equality comparisons are valid self-edges but do not form InRange.
      return b;
    default:
      break;
    }
    if (b.isLower || b.isUpper)
      return b;
  }
  return llvm::None;
}

/// Return true if `value` equals `root` or can be reached from `root` through
/// transparent operations (casts, zext/sext/trunc, and/or/add/sub).
static bool isDerivedFromRoot(const Value *value, const Value *root) {
  if (value == root)
    return true;
  std::set<const Value *> seen;
  std::vector<const Value *> work = {value};
  while (!work.empty()) {
    const Value *v = work.back();
    work.pop_back();
    if (!seen.insert(v).second)
      continue;
    if (v == root)
      return true;
    if (auto *I = dyn_cast<Instruction>(v)) {
      if (isa<CastInst>(I) || isa<PHINode>(I) || isa<SelectInst>(I) ||
          isa<UnaryOperator>(I)) {
        for (const Value *op : I->operand_values())
          work.push_back(op);
      } else if (auto *BO = dyn_cast<BinaryOperator>(I)) {
        auto opcode = BO->getOpcode();
        if (opcode == Instruction::And || opcode == Instruction::Or ||
            opcode == Instruction::Add || opcode == Instruction::Sub) {
          for (const Value *op : BO->operand_values())
            work.push_back(op);
        }
      }
    }
  }
  return false;
}

/// Return true if V influences the helper's boolean result (used by a branch
/// or returned).
static bool icmpIsRelevant(const ICmpInst *ICI) {
  for (const User *U : ICI->users()) {
    if (isa<BranchInst>(U) || isa<ReturnInst>(U))
      return true;
    if (auto *Sel = dyn_cast<SelectInst>(U))
      if (Sel->getCondition() == ICI)
        return true;
  }
  return false;
}

/// If CB calls a boolean helper and one argument is derived from root,
/// look inside the helper for an icmp that bounds the corresponding formal
/// argument, supporting transparent operations around the formal. Only
/// consider icmps that are relevant to the helper's returned boolean.
static const ICmpInst *
findHelperComparison(const CallBase *CB, const Value *root,
                     const std::vector<const Value *> &uses) {
  Function *callee = CB->getCalledFunction();
  if (!callee || callee->isDeclaration() || callee->arg_empty())
    return nullptr;
  // Only treat explicitly noinline callees as helper-encapsulated checks;
  // inlined/tiny helpers should be analyzed at the expanded comparison site.
  if (!callee->hasFnAttribute(Attribute::NoInline))
    return nullptr;
  // Identify which actual argument is derived from the source.
  Optional<unsigned> argIdx;
  for (unsigned i = 0, e = CB->arg_size(); i < e; ++i) {
    if (isDerivedFromRoot(CB->getArgOperand(i), root)) {
      argIdx = i;
      break;
    }
  }
  if (!argIdx.hasValue() || argIdx.getValue() >= callee->arg_size())
    return nullptr;
  Argument *formal = callee->getArg(argIdx.getValue());
  if (!formal)
    return nullptr;
  const ICmpInst *fallback = nullptr;
  for (const BasicBlock &BB : *callee) {
    for (const Instruction &I : BB) {
      if (auto *ICI = dyn_cast<ICmpInst>(&I)) {
        if (isDerivedFromRoot(ICI->getOperand(0), formal) ||
            isDerivedFromRoot(ICI->getOperand(1), formal)) {
          if (icmpIsRelevant(ICI))
            return ICI;
          if (!fallback)
            fallback = ICI;
        }
      }
    }
  }
  return fallback;
}

/// Return true if `dom` (an instruction) dominates `target` within the same
/// function. Uses LLVM DominatorTree plus same-block instruction order.
static bool dominatesInstruction(const Instruction *dom,
                                 const Instruction *target) {
  if (!dom || !target)
    return false;
  if (dom->getFunction() != target->getFunction())
    return false;
  const Function *F = dom->getFunction();
  DominatorTree DT(const_cast<Function &>(*F));
  const BasicBlock *domBB = dom->getParent();
  const BasicBlock *targetBB = target->getParent();
  if (domBB == targetBB) {
    for (const Instruction &I : *domBB) {
      if (&I == dom)
        return true;
      if (&I == target)
        return false;
    }
    return false;
  }
  return DT.dominates(domBB, targetBB);
}

/// Scan a region starting at BB (bounded) for a CallBase where `src` is used
/// as argument, or a GEP where `src` is used as an index. Returns the head.
static const char *headForUseInRegion(const SemanticSource &src,
                                      const BasicBlock *BB,
                                      unsigned maxDepth = 16) {
  std::set<const BasicBlock *> seen;
  std::queue<std::pair<const BasicBlock *, unsigned>> q;
  seen.insert(BB);
  q.push({BB, 0});
  bool seenCall = false;
  bool seenOffset = false;
  while (!q.empty()) {
    auto [cur, depth] = q.front();
    q.pop();
    for (const Instruction &I : *cur) {
      if (auto *CB = dyn_cast<CallBase>(&I)) {
        for (unsigned i = 0, e = CB->arg_size(); i < e; ++i)
          if (isDerivedFromRoot(CB->getArgOperand(i), src.rootValue)) {
            seenCall = true;
            break;
          }
      }
      if (auto *GEP = dyn_cast<GetElementPtrInst>(&I)) {
        for (auto idxIt = GEP->idx_begin(); idxIt != GEP->idx_end(); ++idxIt)
          if (isDerivedFromRoot(idxIt->get(), src.rootValue)) {
            seenOffset = true;
            break;
          }
      }
      if (seenCall || seenOffset)
        break;
    }
    if (seenCall)
      return heads::kCall;
    if (seenOffset)
      return heads::kOffset;
    if (depth >= maxDepth)
      continue;
    for (const BasicBlock *succ : successors(cur))
      if (seen.insert(succ).second)
        q.push({succ, depth + 1});
  }
  return heads::kBound;
}

/// Determine the most specific head for a comparison that branches.
/// If the comparison guards a call use of the source, head_call; if it guards
/// an offset use, head_offset; otherwise head_bound.
static const char *headForComparison(const SemanticSource &src,
                                     const ICmpInst *ICI) {
  for (const User *U : ICI->users()) {
    auto *BI = dyn_cast<BranchInst>(U);
    if (!BI || !BI->isConditional())
      continue;
    // Prefer the non-error successor as the guarded region.
    const BasicBlock *nonError = BI->getSuccessor(0);
    const BasicBlock *error = BI->getSuccessor(1);
    if (isErrorEdge(nonError, BI->getParent()))
      std::swap(nonError, error);
    // Check the non-error side first.
    const char *h = headForUseInRegion(src, nonError);
    if (h != heads::kBound)
      return h;
    // Fall back to the error side for diagnostic completeness.
    h = headForUseInRegion(src, error);
    if (h != heads::kBound)
      return h;
  }
  return heads::kBound;
}

/// Choose the head for a missing-check edge based on the sink use.
static const char *headForMissingCheck(const SemanticSource &src,
                                       const CallBase *sinkCall,
                                       unsigned argIndex) {
  // Array index sinks are treated as offset heads; size sinks as call heads
  // when the source is also passed to the same call.
  if (sinkCall && argIndex < sinkCall->arg_size()) {
    const Value *arg = sinkCall->getArgOperand(argIndex);
    for (const User *U : arg->users()) {
      if (auto *GEP = dyn_cast<GetElementPtrInst>(U)) {
        for (auto idxIt = GEP->idx_begin(); idxIt != GEP->idx_end(); ++idxIt)
          if (idxIt->get() == arg)
            return heads::kOffset;
      }
    }
  }
  return heads::kCall;
}

/// Extract the self-edges and comparison bounds supported by a comparison or
/// feature test for one source instance.
struct SourceSelfEdges {
  std::vector<Edge> edges;
  std::vector<IcmpBound> bounds;
};

static SourceSelfEdges
extractSelfEdgesForSource(const SemanticSource &src, const SinkCatalog &sinks) {
  bool usedAsOffset = false;
  bool usedAsCallArg = false;
  auto uses = reachableUses(src.rootValue);
  std::vector<IcmpBound> bounds;

  for (const Value *U : uses) {
    if (auto *GEP = dyn_cast<GetElementPtrInst>(U)) {
      for (auto idxIt = GEP->idx_begin(); idxIt != GEP->idx_end(); ++idxIt)
        if (isDerivedFromRoot(idxIt->get(), src.rootValue))
          usedAsOffset = true;
    }
    if (auto *CB = dyn_cast<CallBase>(U)) {
      for (unsigned i = 0, e = CB->arg_size(); i < e; ++i)
        if (isDerivedFromRoot(CB->getArgOperand(i), src.rootValue)) {
          usedAsCallArg = true;
          // Pattern 2: helper-encapsulated check.
          if (const ICmpInst *helperIcmp =
                  findHelperComparison(CB, src.rootValue, uses)) {
            std::vector<const Value *> helperUses = {
                helperIcmp->getOperand(0), helperIcmp->getOperand(1)};
          if (auto b = extractIcmpBound(helperIcmp, nullptr, helperUses,
                                        src.schema.valueType.widthBits)) {
              b->contextCall = CB;
              bounds.push_back(*b);
          }
          }
        }
    }

    // Collect ICmp bounds; Pattern 1 single comparison and InRange are both
    // resolved in a second pass.
    if (auto *ICI = dyn_cast<ICmpInst>(U)) {
      if (auto b = extractIcmpBound(ICI, src.rootValue, uses,
                                    src.schema.valueType.widthBits))
        bounds.push_back(*b);
    }
  }

  auto newEdge = [&]() {
    Edge edge;
    edge.src = src.schema.id;
    edge.dst = src.schema.id;
    edge.function = src.function;
    edge.loc = src.loc;
    return edge;
  };

  std::vector<Edge> edges;

  // Individual comparison bounds are emitted after InRange synthesis, which
  // runs across all source instances sharing a canonical node id.

  // Helper-encapsulated bounds often come from a function whose predicate is
  // already oriented to the non-error path; do not invert them again.
  for (const IcmpBound &bound : bounds) {
    const BasicBlock *trueBB = nullptr;
    const BasicBlock *falseBB = nullptr;
    const BasicBlock *brBB = nullptr;
    for (const User *branchUser : bound.inst->users()) {
      if (auto *BI = dyn_cast<BranchInst>(branchUser)) {
        if (!BI->isConditional())
          continue;
        trueBB = BI->getSuccessor(0);
        falseBB = BI->getSuccessor(1);
        brBB = BI->getParent();
        break;
      }
    }
    bool invert = false;
    if (trueBB && falseBB && brBB) {
      if (isErrorEdge(trueBB, brBB) && !isErrorEdge(falseBB, brBB))
        invert = true;
    }

    Predicate p{predicateKindForICmp(bound.predicate, invert),
                llvm::None, llvm::None};
    p.value = bound.value;
    p.signedness = bound.signedness;
    p.widthBits = src.schema.valueType.widthBits;
    Edge edge = newEdge();
    if (bound.contextCall)
      edge.head = headForMissingCheck(src, bound.contextCall,
                                      /*argIndex=*/0);
    else
      edge.head = headForComparison(src, bound.inst);
    edge.site = bound.inst;
    edge.pred = p;
    // The guarded region is the direction that stays on the non-error path:
    // the raw predicate holds on the condition-true branch, the inverted
    // predicate holds on the condition-false branch.
    if (brBB && trueBB && falseBB) {
      edge.guardedRegion = invert ? falseBB : trueBB;
    }
    edge.loc = bound.inst->getDebugLoc();
    edges.push_back(std::move(edge));
  }

  if (src.schema.nodeLocalBit.hasValue()) {
    for (const User *U : src.rootValue->users()) {
      if (auto *BI = dyn_cast<BranchInst>(U)) {
        if (BI->getCondition() == src.rootValue) {
          // The raw feature result is nonzero when the bit is set, so the
          // predicate-holds region is successor(0); when successor(0) is the
          // error path the inverted BitClear holds on successor(1).
          bool errorOnThen = isErrorEdge(BI->getSuccessor(0), BI->getParent());
          Predicate p{errorOnThen ? "BitClear" : "BitSet", llvm::None,
                      src.schema.nodeLocalBit.getValue()};
          Edge edge = newEdge();
          edge.head = heads::kGuard;
          edge.pred = p;
          edge.guardedRegion = errorOnThen ? BI->getSuccessor(1)
                                           : BI->getSuccessor(0);
          edge.loc = BI->getDebugLoc();
          edges.push_back(std::move(edge));
          break;
        }
      }
    }
  }

  // Pattern 3: missing-check finding. If the source reaches a size or index
  // sink and no extracted comparison dominates that sink, emit a low-
  // confidence Gt(unknown) self-edge as an analysis finding.
  if (usedAsCallArg || usedAsOffset) {
    for (const Value *U : uses) {
      auto *CB = dyn_cast<CallBase>(U);
      if (!CB)
        continue;
      for (const SemanticSink &sink : sinks.match(CB)) {
        if (sink.role != Role::Size && sink.role != Role::Index)
          continue;
        Optional<unsigned> argIdx;
        for (unsigned i = 0, e = CB->arg_size(); i < e; ++i) {
          if (isDerivedFromRoot(CB->getArgOperand(i), src.rootValue)) {
            argIdx = i;
            break;
          }
        }
        if (!argIdx.hasValue() || argIdx.getValue() != sink.argIndex)
          continue;
        // Require that no concrete numeric bound dominates this sink call.
        // Eq/Ne guards do not provide a size/index bound, so they do not
        // suppress the missing-check finding.
        bool dominated = false;
        for (const IcmpBound &bound : bounds) {
          if (bound.predicate == ICmpInst::ICMP_EQ ||
              bound.predicate == ICmpInst::ICMP_NE)
            continue;
          if (dominatesInstruction(bound.inst, CB)) {
            dominated = true;
            break;
          }
        }
        if (!dominated) {
          Predicate p{"Gt", llvm::None, llvm::None};
          p.signedness = sdg::core::Signedness::Unknown;
          p.widthBits = src.schema.valueType.widthBits;
          Edge edge = newEdge();
          edge.head = headForMissingCheck(src, CB, sink.argIndex);
          edge.site = CB;
          edge.pred = p;
          edge.loc = CB->getDebugLoc();
          edges.push_back(std::move(edge));
        }
      }
    }
  }

  SourceSelfEdges result;
  result.edges = std::move(edges);
  result.bounds = std::move(bounds);
  return result;
}

/// Extract only self-edges supported by an actual comparison or feature test.
static SelfEdgeMap
extractSelfEdges(const std::vector<SemanticSource> &sources,
                 const SinkCatalog &sinks) {
  SelfEdgeMap out;
  // Bounds are merged per canonical node id because several source instances
  // (for example one per load of the same alloca) may each observe only one
  // side of a synthesized range.
  std::map<std::string, std::vector<IcmpBound>> boundsById;
  std::map<std::string, const SemanticSource *> sourceById;
  for (const SemanticSource &src : sources) {
    auto result = extractSelfEdgesForSource(src, sinks);
    auto &destination = out[src.schema.id];
    destination.insert(destination.end(), result.edges.begin(),
                       result.edges.end());
    boundsById[src.schema.id].insert(boundsById[src.schema.id].end(),
                                     result.bounds.begin(),
                                     result.bounds.end());
    sourceById.emplace(src.schema.id, &src);
  }

  // Synthesize InRange only when both comparisons feed the same conjunction.
  for (auto &entry : boundsById) {
    const std::string &id = entry.first;
    const std::vector<IcmpBound> &bounds = entry.second;
    if (bounds.size() < 2)
      continue;
    const SemanticSource &src = *sourceById.at(id);
    unsigned widthBits = src.schema.valueType.widthBits;

    // The first `and` instruction reached from V through transparent uses.
    auto andPartner = [](const Value *V) -> const BinaryOperator * {
      std::set<const Value *> seen;
      std::vector<const Value *> work = {V};
      while (!work.empty()) {
        const Value *x = work.back();
        work.pop_back();
        if (!seen.insert(x).second)
          continue;
        for (const User *U : x->users()) {
          if (auto *BO = dyn_cast<BinaryOperator>(U))
            if (BO->getOpcode() == Instruction::And)
              return BO;
          if (isTransparentUse(U))
            work.push_back(U);
        }
      }
      return nullptr;
    };

    auto newEdge = [&]() {
      Edge edge;
      edge.src = id;
      edge.dst = id;
      edge.function = src.function;
      edge.loc = src.loc;
      return edge;
    };

    for (const IcmpBound &lo : bounds) {
      if (!lo.isLower)
        continue;
      for (const IcmpBound &hi : bounds) {
        if (!hi.isUpper)
          continue;
        if (lo.signedness != hi.signedness)
          continue;
        // Compare the two-complement encoded bounds under the predicate's
        // signedness; unsigned bounds compare by raw pattern.
        if (lo.signedness == sdg::core::Signedness::Signed) {
          if (signedPatternValue(lo.value, widthBits) >
              signedPatternValue(hi.value, widthBits))
            continue;
        } else if (lo.value > hi.value) {
          continue;
        }
        // Both comparisons must feed the same `and` conjunction.
        const BinaryOperator *loAnd = andPartner(lo.inst);
        const BinaryOperator *hiAnd = andPartner(hi.inst);
        if (!loAnd || loAnd != hiAnd)
          continue;
        Predicate p{"InRange", llvm::None, llvm::None};
        p.min = lo.value;
        p.max = hi.value;
        p.signedness = lo.signedness;
        p.widthBits = widthBits;
        Edge edge = newEdge();
        edge.head = headForComparison(src, lo.inst);
        edge.site = lo.inst;
        edge.pred = p;
        // The guarded region is the direction that stays on the non-error
        // path of the lower-bound comparison.
        if (const BasicBlock *loBrBB = lo.inst->getParent()) {
          for (const User *branchUser : lo.inst->users()) {
            if (auto *BI = dyn_cast<BranchInst>(branchUser)) {
              if (!BI->isConditional())
                continue;
              const BasicBlock *thenBB = BI->getSuccessor(0);
              const BasicBlock *elseBB = BI->getSuccessor(1);
              bool invert = isErrorEdge(thenBB, BI->getParent());
              edge.guardedRegion = invert ? elseBB : thenBB;
              (void)loBrBB;
              break;
            }
          }
        }
        edge.loc = lo.inst->getDebugLoc();
        out[id].push_back(std::move(edge));
      }
    }
  }

  for (auto &entry : out) {
    auto &edges = entry.second;
    std::sort(edges.begin(), edges.end(), [](const Edge &a, const Edge &b) {
      int aSigned = static_cast<int>(a.pred.signedness);
      int bSigned = static_cast<int>(b.pred.signedness);
      return std::tie(a.head, a.pred.kind, a.pred.value, a.pred.bit,
                      a.pred.min, a.pred.max, aSigned, a.function) <
             std::tie(b.head, b.pred.kind, b.pred.value, b.pred.bit,
                      b.pred.min, b.pred.max, bSigned, b.function);
    });
    edges.erase(std::unique(edges.begin(), edges.end(),
                            [](const Edge &a, const Edge &b) {
                              int aSigned = static_cast<int>(a.pred.signedness);
                              int bSigned = static_cast<int>(b.pred.signedness);
                              return std::tie(a.head, a.pred.kind, a.pred.value,
                                              a.pred.bit, a.pred.min,
                                              a.pred.max, aSigned) ==
                                     std::tie(b.head, b.pred.kind, b.pred.value,
                                              b.pred.bit, b.pred.min,
                                              b.pred.max, bSigned);
                            }),
                edges.end());
  }
  return out;
}

/// For a VFG node that represents a store, the value being stored is the
/// meaningful source; for other nodes use the LLVM value directly.
static const Value *valueFlowingThroughNode(const SemanticValueFlowGraph &graph,
                                            const VFGNode *node) {
  if (const Instruction *I = graph.llvmInstruction(node)) {
    if (auto *SI = dyn_cast<StoreInst>(I))
      return SI->getValueOperand();
    if (auto *LI = dyn_cast<LoadInst>(I))
      return LI;
  }
  return graph.llvmValue(node);
}

/// Extract cross dataflow edges, including value flow through memory
/// (store/load pairs).  A small bounded BFS over the SVFG lets us connect a
/// config read stored into a struct field to the later load of that field.
static std::vector<Edge>
extractCrossDataflow(const std::vector<SemanticSource> &sources,
                     const SemanticValueFlowGraph &graph) {
  std::vector<Edge> out;
  std::map<const Value *, std::string> valueToSource;
  for (const SemanticSource &src : sources)
    if (src.rootValue)
      valueToSource[src.rootValue] = canonicalNodeId(src.schema);

  for (const SemanticSource &dst : sources) {
    if (!dst.rootValue)
      continue;
    for (const VFGNode *root : graph.nodesForValue(dst.rootValue)) {
      std::set<NodeID> seen;
      std::queue<const VFGNode *> q;
      seen.insert(root->getId());
      q.push(root);

      while (!q.empty()) {
        const VFGNode *node = q.front();
        q.pop();

        const Value *V = valueFlowingThroughNode(graph, node);
        if (V) {
          auto it = valueToSource.find(V);
          if (it != valueToSource.end() && it->second != dst.schema.id) {
            Edge e;
            e.src = it->second;
            e.dst = dst.schema.id;
            e.head = heads::kDataflow;
            e.pred = Predicate{"Identity", llvm::None, llvm::None};
            e.function = dst.function;
            e.loc = dst.loc;
            out.push_back(e);
          }
        }

        SmallVector<const VFGNode *, 8> preds;
        graph.backwardNeighbours(node, preds);
        for (const VFGNode *pred : preds) {
          if (seen.insert(pred->getId()).second)
            q.push(pred);
        }
      }
    }
  }

  // Deduplicate by (src, dst).
  auto cmp = [](const Edge &a, const Edge &b) {
    return std::tie(a.src, a.dst, a.head) <
           std::tie(b.src, b.dst, b.head);
  };
  std::sort(out.begin(), out.end(), cmp);
  out.erase(std::unique(out.begin(), out.end(),
                        [&cmp](const Edge &a, const Edge &b) {
                          return !cmp(a, b) && !cmp(b, a);
                        }),
            out.end());
  return out;
}

static void writeJSON(const std::string &path,
                       const std::vector<SemanticSource> &nodes,
                       const SelfEdgeMap &selfEdges,
                       const std::vector<Edge> &crossDataflow,
                       const std::vector<Rule> &rules) {
  std::map<std::string, std::string> ids;
  std::map<std::string, SemanticSource> uniqueNodes;
  for (const SemanticSource &node : nodes) {
    SemanticSource copy = node;
    const std::string old = copy.schema.id;
    copy.schema.id = canonicalNodeId(copy.schema);
    ids.emplace(old, copy.schema.id);
    auto [existing, inserted] = uniqueNodes.emplace(copy.schema.id, copy);
    if (!inserted) {
      const SourceSchema &a = existing->second.schema;
      const SourceSchema &b = copy.schema;
      if (std::tie(a.clazz, a.accessKind, a.offset, a.featureBit,
                   a.widthBytes, a.field, a.slot) !=
          std::tie(b.clazz, b.accessKind, b.offset, b.featureBit,
                   b.widthBytes, b.field, b.slot))
        report_fatal_error(Twine("SDG node identity conflict: ") +
                           copy.schema.id);
    }
  }
  std::vector<SemanticSource> canonicalNodes;
  canonicalNodes.reserve(uniqueNodes.size());
  for (auto &entry : uniqueNodes)
    canonicalNodes.push_back(std::move(entry.second));
  auto remapEdge = [&ids](Edge edge) {
    auto src = ids.find(edge.src);
    auto dst = ids.find(edge.dst);
    if (src != ids.end()) edge.src = src->second;
    if (dst != ids.end()) edge.dst = dst->second;
    return edge;
  };
  SelfEdgeMap canonicalSelf;
  for (const auto &entry : selfEdges)
    for (const Edge &edge : entry.second)
      canonicalSelf[ids.count(entry.first) ? ids.at(entry.first) : entry.first]
          .push_back(remapEdge(edge));
  std::vector<Edge> canonicalCross;
  canonicalCross.reserve(crossDataflow.size());
  for (const Edge &edge : crossDataflow)
    canonicalCross.push_back(remapEdge(edge));
  // Canonical edge identity keeps src, dst, head, signedness, and every
  // predicate field; equivalent edges from several source instances
  // collapse to one edge.
  {
    auto edgeCmp = [](const Edge &a, const Edge &b) {
      return std::tie(a.src, a.dst, a.head, a.pred.kind, a.pred.value,
                      a.pred.bit, a.pred.min, a.pred.max,
                      a.pred.signedness) <
             std::tie(b.src, b.dst, b.head, b.pred.kind, b.pred.value,
                      b.pred.bit, b.pred.min, b.pred.max,
                      b.pred.signedness);
    };
    std::sort(canonicalCross.begin(), canonicalCross.end(), edgeCmp);
    canonicalCross.erase(
        std::unique(canonicalCross.begin(), canonicalCross.end(),
                    [](const Edge &a, const Edge &b) {
                      return std::tie(a.src, a.dst, a.head, a.pred.kind,
                                      a.pred.value, a.pred.bit, a.pred.min,
                                      a.pred.max, a.pred.signedness) ==
                             std::tie(b.src, b.dst, b.head, b.pred.kind,
                                      b.pred.value, b.pred.bit, b.pred.min,
                                      b.pred.max, b.pred.signedness);
                    }),
        canonicalCross.end());
  }
  std::map<std::string, SemanticSource> nodesById;
  for (const SemanticSource &node : canonicalNodes)
    nodesById.emplace(node.schema.id, node);
  std::map<std::string, Rule> rulesById;
  for (const Rule &rule : rules) {
    Rule copy = rule;
    for (SemanticSource &var : copy.vars) {
      auto it = ids.find(var.schema.id);
      if (it != ids.end()) var.schema.id = it->second;
    }
    copy.trigger = remapEdge(copy.trigger);
    for (Edge &edge : copy.preconditions) edge = remapEdge(edge);
    std::sort(copy.preconditions.begin(), copy.preconditions.end(),
              [](const Edge &a, const Edge &b) {
                return std::tie(a.src, a.dst, a.head, a.pred.kind,
                                a.pred.value, a.pred.bit, a.pred.min,
                                a.pred.max, a.pred.signedness) <
                       std::tie(b.src, b.dst, b.head, b.pred.kind,
                                b.pred.value, b.pred.bit, b.pred.min,
                                b.pred.max, b.pred.signedness);
              });
    copy.id = canonicalRuleId(copy);
    for (const Edge &edge : copy.preconditions) {
      auto addVar = [&copy, &nodesById](const std::string &id) {
        if (std::any_of(copy.vars.begin(), copy.vars.end(),
                        [&id](const SemanticSource &var) {
                          return var.schema.id == id;
                        }))
          return;
        auto node = nodesById.find(id);
        if (node != nodesById.end())
          copy.vars.push_back(node->second);
      };
      addVar(edge.src);
      addVar(edge.dst);
    }
    auto existing = rulesById.find(copy.id);
    if (existing != rulesById.end())
      report_fatal_error(Twine("SDG rule identity conflict: ") + copy.id);
    rulesById.emplace(copy.id, std::move(copy));
  }
  std::vector<Rule> canonicalRules;
  canonicalRules.reserve(rulesById.size());
  for (auto &entry : rulesById) {
    Rule &rule = entry.second;
    std::sort(rule.vars.begin(), rule.vars.end(),
              [](const SemanticSource &a, const SemanticSource &b) {
                return a.schema.id < b.schema.id;
              });
    rule.vars.erase(std::unique(rule.vars.begin(), rule.vars.end(),
                                [](const SemanticSource &a,
                                   const SemanticSource &b) {
                                  return a.schema.id == b.schema.id;
                                }),
                    rule.vars.end());
    std::sort(rule.preconditions.begin(), rule.preconditions.end(),
              [](const Edge &a, const Edge &b) {
                return std::tie(a.src, a.dst, a.head, a.pred.kind,
                                a.pred.value, a.pred.bit, a.pred.min,
                                a.pred.max, a.pred.signedness) <
                       std::tie(b.src, b.dst, b.head, b.pred.kind,
                                b.pred.value, b.pred.bit, b.pred.min,
                                b.pred.max, b.pred.signedness);
              });
    rule.preconditions.erase(
        std::unique(rule.preconditions.begin(), rule.preconditions.end(),
                    [](const Edge &a, const Edge &b) {
                      return std::tie(a.src, a.dst, a.head, a.pred.kind,
                                      a.pred.value, a.pred.bit, a.pred.min,
                                      a.pred.max, a.pred.signedness) ==
                             std::tie(b.src, b.dst, b.head, b.pred.kind,
                                      b.pred.value, b.pred.bit, b.pred.min,
                                      b.pred.max, b.pred.signedness);
                    }),
        rule.preconditions.end());
    canonicalRules.push_back(std::move(rule));
  }
  std::sort(canonicalNodes.begin(), canonicalNodes.end(),
            [](const SemanticSource &a, const SemanticSource &b) {
              return a.schema.id < b.schema.id;
            });
  std::sort(canonicalRules.begin(), canonicalRules.end(),
            [](const Rule &a, const Rule &b) { return a.id < b.id; });

  json::Object root;
  root["version"] = "0.3.0-svf";

  json::Object nodesObj;
  json::Array nodeArr;
  for (const SemanticSource &n : canonicalNodes)
    nodeArr.push_back(toJSON(n));
  nodesObj["count"] = static_cast<int64_t>(nodeArr.size());
  nodesObj["nodes"] = json::Value(std::move(nodeArr));
  root["nodes"] = json::Value(std::move(nodesObj));

  // Edges come from grammar extraction (self + cross dataflow) and from
  // assembled rule preconditions (cross guards).
  json::Object edgesObj;
  json::Array selfArr, crossArr;
  for (const SemanticSource &n : canonicalNodes) {
    auto it = canonicalSelf.find(n.schema.id);
    if (it != canonicalSelf.end())
      for (const Edge &edge : it->second)
        selfArr.push_back(toJSON(edge));
  }
  for (const Edge &e : canonicalCross)
    crossArr.push_back(toJSON(e));
  for (const Rule &r : canonicalRules) {
    for (const Edge &e : r.preconditions)
      crossArr.push_back(toJSON(e));
  }
  edgesObj["self_count"] = static_cast<int64_t>(selfArr.size());
  edgesObj["cross_count"] = static_cast<int64_t>(crossArr.size());
  edgesObj["self_edges"] = json::Value(std::move(selfArr));
  edgesObj["cross_edges"] = json::Value(std::move(crossArr));
  root["edges"] = json::Value(std::move(edgesObj));

  json::Object rulesObj;
  json::Array ruleArr;
  for (const Rule &r : canonicalRules)
    ruleArr.push_back(toJSON(r));
  rulesObj["count"] = static_cast<int64_t>(ruleArr.size());
  rulesObj["rules"] = json::Value(std::move(ruleArr));
  root["rules"] = json::Value(std::move(rulesObj));

  std::error_code ec;
  raw_fd_ostream os(path, ec, sys::fs::OF_Text);
  if (ec) {
    errs() << "SDGExtract: cannot open output " << path << ": " << ec.message()
           << "\n";
    return;
  }
  os << json::Value(std::move(root)) << "\n";
}

//===----------------------------------------------------------------------===//
// Pass
//===----------------------------------------------------------------------===//

struct SDGExtractPass : public PassInfoMixin<SDGExtractPass> {
  PreservedAnalyses run(Module &M, ModuleAnalysisManager &) {
    // Networking scope includes nested aggregate memcpy operations. SVF's
    // flattened-field builder requires array offset modeling for those IR
    // shapes; leaving it disabled triggers an assertion in IRGraph.
    Options::ModelArrays.setValue(true);

    // SVF needs the extapi.bc path to resolve external functions.
    std::filesystem::path extapi = std::filesystem::current_path();
    if (!SDGExtAPIPath.empty()) {
      extapi = std::string(SDGExtAPIPath);
    } else {
      extapi /= ".morpheus";
      extapi /= "tools";
      extapi /= "sdg-extractor";
      extapi /= "third_party";
      extapi /= "SVF";
      extapi /= "install";
      extapi /= "lib";
      extapi /= "extapi.bc";
    }
    ExtAPI::getExtAPI()->setExtBcPath(extapi.string());

    LLVMModuleSet::buildSVFModule(M);

    SVFIRBuilder builder;
    SVFIR *pag = builder.build();

    Andersen *ander = AndersenWaveDiff::createAndersenWaveDiff(pag);
    ICFG *icfg = pag->getICFG();

    // Build the SVFG with indirect calls resolved by the pointer analysis so
    // value flow and control flow through indirect calls are represented.
    SVFGBuilder svfBuilder(/*SVFGWithIndCall=*/true);
    SVFG *svfg = svfBuilder.buildFullSVFG(ander);

    SemanticValueFlowGraph svfGraph(svfg);
    SourceCatalog srcCatalog;
    SinkCatalog sinkCatalog;

    // HP_DMA_TRACE telemetry recognition: collect the per-function evidence
    // first so DMA provenance at match time can use it. Telemetry never
    // creates a source by itself.
    std::map<const Function *, std::vector<TelemetryEvent>> telemetryEvents =
        collectTelemetryEvents(M);
    {
      std::map<const Function *, std::vector<TelemetryEvidence>> evidence;
      for (const auto &entry : telemetryEvents) {
        auto &items = evidence[entry.first];
        for (const TelemetryEvent &event : entry.second)
          items.push_back({event.event, event.root, event.addressRoot});
      }
      srcCatalog.setTelemetryEvents(std::move(evidence));
    }

    // Discover sources by scanning the module. Sinks are matched per call
    // site by the taint and control analyses; unmatched sinks are never
    // promoted into rules.
    std::vector<SemanticSource> sources;
    for (Function &F : M) {
      if (F.isDeclaration())
        continue;
      std::string funcName = F.getName().str();
      for (auto &BB : F) {
        for (auto &I : BB) {
          if (auto *CB = dyn_cast<CallBase>(&I)) {
            if (auto src = srcCatalog.matchCall(CB, funcName, I.getDebugLoc()))
              sources.push_back(*src);
          } else if (auto *LI = dyn_cast<LoadInst>(&I)) {
            if (auto src = srcCatalog.matchLoad(LI, funcName, I.getDebugLoc()))
              sources.push_back(*src);
          }
        }
      }
    }

    std::vector<Edge> crossDataflow;
    expandStoredSourceAliases(sources, crossDataflow, M);

    for (SemanticSource &source : sources) {
      if (source.schema.clazz == "Mmio" &&
          source.schema.accessKind == "feature" &&
          !source.schema.offset.hasValue())
        source.schema.offset = 16;
      source.schema.id = canonicalNodeId(source.schema);
    }
    sources.erase(
        std::remove_if(sources.begin(), sources.end(),
                       [](const SemanticSource &source) {
                         return !source.schema.widthBytes.hasValue() ||
                                source.schema.widthBytes.getValue() == 0;
                       }),
        sources.end());

    // Grammar-compliant self-edge and cross dataflow extraction.
    SelfEdgeMap selfEdges = extractSelfEdges(sources, sinkCatalog);
    {
      std::vector<Edge> svfCross = extractCrossDataflow(sources, svfGraph);
      crossDataflow.insert(crossDataflow.end(), svfCross.begin(), svfCross.end());
    }

    // Role-preserving taint analysis over SVFG.
    RoleTaintAnalysis taint(svfGraph, sources, sinkCatalog);
    taint.run();
    // Telemetry confirmation applies to the taint-result sinks that rules
    // consume.
    for (auto &entry : taint.result())
      for (auto &tuple : entry.second)
        annotateSinkTelemetry(std::get<0>(tuple), telemetryEvents);

    // Control dependency: source branch conditions that gate sink calls.
    ControlDependencyAnalysis ctrl(icfg, &svfGraph, M, sinkCatalog);
    std::vector<ControlResult> ctrlResults;
    for (const SemanticSource &src : sources) {
      auto found = ctrl.analyze(src, sinkCatalog);
      ctrlResults.insert(ctrlResults.end(), found.begin(), found.end());
    }

    RuleAssembler assembler;
    // Build the resolved call graph (direct + pointer-analysis indirect
    // callees) used to prove cross-function guard control. SVF call nodes are
    // mapped back to LLVM callsites and functions by identity, never by name.
    CallGraphInfo callGraph;
    {
      auto *moduleSet = LLVMModuleSet::getLLVMModuleSet();
      std::map<const SVF::CallICFGNode *, const CallBase *> icfgToCall;
      for (Function &F : M) {
        for (BasicBlock &BB : F) {
          for (Instruction &I : BB) {
            auto *CB = dyn_cast<CallBase>(&I);
            if (!CB)
              continue;
            callGraph.calls[&F].push_back(CB);
            if (const Function *direct = CB->getCalledFunction())
              callGraph.callees[CB].insert(direct);
            // Intrinsic debug calls have no ICFG call node; skip them.
            if (LLVMUtil::isNonInstricCallSite(CB))
              if (auto *callNode = moduleSet->getCallICFGNode(CB))
                icfgToCall[callNode] = CB;
          }
        }
      }
      for (const auto &entry : ander->getIndCallMap()) {
        auto callIt = icfgToCall.find(entry.first);
        if (callIt == icfgToCall.end())
          continue;
        for (const SVF::FunObjVar *callee : entry.second) {
          const Value *llvmFn = moduleSet->getLLVMValue(callee);
          if (const auto *fn = dyn_cast_or_null<Function>(llvmFn))
            callGraph.callees[callIt->second].insert(fn);
        }
      }
      // Reverse edges: every call site resolved to a function, so a
      // returned value can continue an exact chain into each caller.
      for (const auto &entry : callGraph.callees)
        for (const Function *callee : entry.second)
          callGraph.callersOf[callee].push_back(entry.first);
    }
    auto rules = assembler.assemble(taint.result(), ctrlResults, sources,
                                    selfEdges, crossDataflow, callGraph);

    writeJSON(SDGOutputPath, sources, selfEdges, crossDataflow, rules);

    // SVF's module set must be released before LLVM destroys the module.
    LLVMModuleSet::releaseLLVMModuleSet();
    return PreservedAnalyses::all();
  }
};

} // namespace

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
