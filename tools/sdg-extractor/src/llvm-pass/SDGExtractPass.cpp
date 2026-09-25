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
#include "Util/ExtAPI.h"
#include "WPA/Andersen.h"

#include "llvm/IR/Function.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_ostream.h"

#include <algorithm>
#include <filesystem>
#include <map>
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

static cl::opt<std::string> SDGEntryList(
    "sdg-entry-list",
    cl::desc("Path to file listing entry function names (optional)"),
    cl::value_desc("filename"),
    cl::init(""));

static cl::opt<std::string> SDGExtAPIPath(
    "sdg-extapi",
    cl::desc("Path to SVF extapi.bc (default: tool third_party install)"),
    cl::value_desc("filename"),
    cl::init(""));

namespace {

//===----------------------------------------------------------------------===//
// JSON serialization helpers
//===----------------------------------------------------------------------===//

static json::Value toJSON(const Predicate &p) {
  json::Object obj;
  obj["kind"] = p.kind;
  if (p.value.hasValue())
    obj["value"] = static_cast<int64_t>(p.value.getValue());
  if (p.bit.hasValue())
    obj["bit"] = static_cast<int64_t>(p.bit.getValue());
  return json::Value(std::move(obj));
}

static json::Value toJSON(const Mutation &m) {
  json::Object obj;
  obj["op"] = m.op;
  if (m.value.hasValue())
    obj["value"] = static_cast<int64_t>(m.value.getValue());
  if (m.bit.hasValue())
    obj["bit"] = static_cast<int64_t>(m.bit.getValue());
  if (m.side.hasValue())
    obj["side"] = m.side.getValue();
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
  obj["width_bytes"] =
      src.widthBytes.hasValue()
          ? json::Value(static_cast<int64_t>(src.widthBytes.getValue()))
          : json::Value(nullptr);
  obj["field"] = src.field.empty() ? json::Value(nullptr) : json::Value(src.field);
  obj["telemetry_event"] = json::Value(nullptr);
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

  obj["trigger"] = toJSON(r.trigger);
  obj["mutation"] = toJSON(r.mutation);
  obj["confidence"] = r.confidence;
  return json::Value(std::move(obj));
}

static void writeJSON(const std::string &path,
                      const std::vector<SemanticSource> &nodes,
                      const std::vector<Rule> &rules) {
  json::Object root;
  root["version"] = "0.3.0-svf";

  json::Object nodesObj;
  json::Array nodeArr;
  for (const SemanticSource &n : nodes)
    nodeArr.push_back(toJSON(n));
  nodesObj["count"] = static_cast<int64_t>(nodeArr.size());
  nodesObj["nodes"] = json::Value(std::move(nodeArr));
  root["nodes"] = json::Value(std::move(nodesObj));

  // Edges are derived from rule triggers/preconditions plus one self edge
  // per discovered source so that isolated MMIO reads are still represented.
  json::Object edgesObj;
  json::Array selfArr, crossArr;
  for (const SemanticSource &n : nodes) {
    Edge e;
    e.src = n.schema.id;
    e.dst = n.schema.id;
    e.head = heads::kBound;
    e.pred = Predicate{"Ne", 0, llvm::None};
    e.function = n.function;
    e.loc = n.loc;
    selfArr.push_back(toJSON(e));
  }
  for (const Rule &r : rules) {
    selfArr.push_back(toJSON(r.trigger));
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
  for (const Rule &r : rules)
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

    SVFGBuilder svfBuilder;
    SVFG *svfg = svfBuilder.buildFullSVFG(ander);

    SemanticValueFlowGraph svfGraph(svfg);
    SourceCatalog srcCatalog;
    SinkCatalog sinkCatalog;

    // Discover sources and sinks by scanning the module.
    std::vector<SemanticSource> sources;
    std::vector<SemanticSink> sinks;
    for (Function &F : M) {
      if (F.isDeclaration())
        continue;
      std::string funcName = F.getName().str();
      for (auto &A : F.args()) {
        auto argSrcs = srcCatalog.matchArgument(&A, funcName, A.getArgNo(),
                                                llvm::DebugLoc());
        sources.insert(sources.end(), argSrcs.begin(), argSrcs.end());
      }
      for (auto &BB : F) {
        for (auto &I : BB) {
          if (auto *CB = dyn_cast<CallBase>(&I)) {
            if (auto src = srcCatalog.matchCall(CB, funcName, I.getDebugLoc())) {
              sources.push_back(*src);
              for (const SemanticSource &extra :
                   srcCatalog.extraSourcesForCall(CB, *src))
                sources.push_back(extra);
            }
            auto matchedSinks = sinkCatalog.match(CB);
            sinks.insert(sinks.end(), matchedSinks.begin(), matchedSinks.end());
          } else if (auto *LI = dyn_cast<LoadInst>(&I)) {
            if (auto src = srcCatalog.matchLoad(LI, funcName, I.getDebugLoc()))
              sources.push_back(*src);
          }
        }
      }
    }

    // Role-preserving taint analysis over SVFG.
    RoleTaintAnalysis taint(svfGraph, sources, sinkCatalog);
    // Use a very high depth bound for recall-first soundness. The BFS is still
    // bounded by the finite SVFG.
    taint.run(/*maxDepth=*/1024);

    // Control dependency: source branch conditions that gate sink calls.
    ControlDependencyAnalysis ctrl(icfg, &svfGraph, M, sinkCatalog);
    std::vector<ControlResult> ctrlResults;
    for (const SemanticSource &src : sources) {
      auto found = ctrl.analyze(src, sinkCatalog);
      ctrlResults.insert(ctrlResults.end(), found.begin(), found.end());
    }

    RuleAssembler assembler;
    auto rules = assembler.assemble(taint.result(), ctrlResults);

    // Self-check rules: when a function argument is both a source and a sink
    // (e.g. vring_mapping_error(addr) checks a DMA address), emit the rule
    // directly because SVFG taint has no CallBase to consume the argument.
    for (const SemanticSource &src : sources) {
      if (!src.rootValue || !isa<Argument>(src.rootValue))
        continue;
      auto *A = cast<Argument>(src.rootValue);
      if (sinkCatalog.isArgumentSink(src.function, A->getArgNo())) {
        Rule r;
        r.id = src.function + "-" + src.schema.id;
        r.function = src.function;
        r.vars.push_back(src);
        CallBase *dummy = nullptr;
        r.sinks.push_back(
            SemanticSink{src.function, Role::Address,
                         static_cast<unsigned>(A->getArgNo()), dummy});
        r.trigger.src = src.schema.id;
        r.trigger.dst = src.schema.id;
        r.trigger.function = src.function;
        r.trigger.head = heads::kBound;
        r.trigger.pred = Predicate{"Ne", 0, llvm::None};
        r.trigger.loc = src.loc;
        r.mutation = Mutation{"SampleRange", llvm::None, llvm::None,
                               llvm::None};
        r.confidence = 0.7f;
        rules.push_back(r);
      }
    }

    // Source-level modeled sinks for relationships that are guaranteed by the
    // protocol / source code but not visible as IR dataflow in this build.
    for (const SemanticSource &src : sources) {
      if (auto modeled = srcCatalog.modeledSinkForSourceId(src.schema.id)) {
        Rule r;
        r.id = src.function + "-" + src.schema.id + "-modeled-" +
               modeled->function;
        r.function = src.function;
        r.vars.push_back(src);
        r.sinks.push_back(*modeled);
        r.trigger.src = src.schema.id;
        r.trigger.dst = src.schema.id;
        r.trigger.function = src.function;
        r.trigger.head = heads::kBound;
        r.trigger.pred = Predicate{"Ne", 0, llvm::None};
        r.trigger.loc = src.loc;
        r.mutation = Mutation{"SampleRange", llvm::None, llvm::None,
                              llvm::None};
        r.confidence = 0.5f;
        rules.push_back(r);
      }
    }

    // Modeled external-API sinks: some public kernel APIs (e.g.
    // dma_map_sg_attrs, VIRTQUEUE_CALL) are not in the merged bitcode, but we
    // know the virtio helpers that call them. Emit modeled rules at those
    // call sites so that no LLM-meaningful rule is lost.
    std::vector<Rule> expanded;
    expanded.reserve(rules.size() * 2);
    for (const Rule &r : rules) {
      expanded.push_back(r);
      if (r.vars.empty())
        continue;
      const std::string &sid = r.vars.front().schema.id;
      for (const SemanticSink &sink : r.sinks) {
        for (const SemanticSink &m : sinkCatalog.modeledSinks(sink)) {
          Rule mr = r;
          mr.id = r.function + "-" + sid + "-modeled-" + m.function;
          mr.sinks = {m};
          mr.confidence = std::min(mr.confidence, 0.6f);
          expanded.push_back(mr);
        }
        // Integer sources that reach memcpy are semantically the size
        // argument (arg2), even if SVFG places them on a src/dst pointer
        // operand due to pointer arithmetic.
        if (sink.function == "memcpy") {
          bool sourceIsInteger =
              r.vars.front().rootValue &&
              r.vars.front().rootValue->getType()->isIntegerTy();
          if (sourceIsInteger) {
            Rule mr = r;
            mr.id = r.function + "-" + sid + "-modeled-memcpy-size";
            mr.sinks = {SemanticSink{"memcpy", Role::Size, 2, nullptr}};
            mr.confidence = std::min(mr.confidence, 0.55f);
            expanded.push_back(mr);
          }
        }
      }
    }

    rules = std::move(expanded);

    // Drop generic pure control edges that do not reach a real sink.
    // Feature-bit checks (BitSet/BitClear) are kept even without a sink because
    // they encode meaningful guest-visible behavior.
    rules.erase(std::remove_if(rules.begin(), rules.end(),
                               [](const Rule &r) {
                                 bool hasEmptySink = std::any_of(
                                     r.sinks.begin(), r.sinks.end(),
                                     [](const SemanticSink &s) {
                                       return s.function.empty();
                                     });
                                 if (!hasEmptySink)
                                   return false;
                                 return r.trigger.pred.kind != "BitSet" &&
                                        r.trigger.pred.kind != "BitClear";
                               }),
                rules.end());

    // Drop control-dependency rules whose only sinks are endian-conversion
    // helpers. The real security-relevant sink is usually reached through a
    // separate data-flow rule. Data-flow rules with conversion-helper sinks
    // are kept (e.g. desc_len -> cpu_to_virtio32).
    rules.erase(std::remove_if(rules.begin(), rules.end(),
                               [](const Rule &r) {
                                 if (!StringRef(r.id).endswith("-ctrl"))
                                   return false;
                                 if (r.sinks.empty())
                                   return false;
                                 return std::all_of(
                                     r.sinks.begin(), r.sinks.end(),
                                     [](const SemanticSink &s) {
                                       return
                                           s.function == "cpu_to_virtio16" ||
                                           s.function == "cpu_to_virtio32" ||
                                           s.function == "cpu_to_virtio64" ||
                                           s.function == "virtio16_to_cpu" ||
                                           s.function == "virtio32_to_cpu" ||
                                           s.function == "virtio64_to_cpu";
                                     });
                                }),
                 rules.end());

    // Deduplicate virtio_has_feature self-check rules globally by source id.
    // The same feature bit is checked in many functions; one self-check rule
    // per bit is enough for the recall-first output.
    {
      std::set<std::string> seenSelfCheck;
      rules.erase(
          std::remove_if(
              rules.begin(), rules.end(),
              [&seenSelfCheck](const Rule &r) {
                if (r.sinks.size() != 1)
                  return false;
                const SemanticSink &s = r.sinks.front();
                if (s.function != "virtio_has_feature" || s.argIndex != 1)
                  return false;
                std::string sourceId =
                    r.vars.empty() ? std::string() : r.vars.front().schema.id;
                return !seenSelfCheck.insert(sourceId).second;
              }),
          rules.end());
    }

    // Aggressive global deduplication: keep only the first occurrence of each
    // (source id, sink function, sink arg index) pair. Control-dependency rules
    // are kept per-function because the branch location matters.
    {
      std::set<std::tuple<std::string, std::string, unsigned>> seenPairs;
      rules.erase(
          std::remove_if(
              rules.begin(), rules.end(),
              [&seenPairs](const Rule &r) {
                if (StringRef(r.id).endswith("-ctrl"))
                  return false;
                if (r.vars.empty() || r.sinks.empty())
                  return false;
                const std::string &sourceId = r.vars.front().schema.id;
                bool allDup = true;
                for (const SemanticSink &s : r.sinks) {
                  auto key = std::make_tuple(sourceId, s.function, s.argIndex);
                  if (seenPairs.insert(key).second)
                    allDup = false;
                }
                return allDup;
              }),
          rules.end());
    }

    // Blocklist low-value sinks for feature-bit control-dependency rules.
    // Internal virtqueue/vring helpers and conversion routines are rarely the
    // security-relevant endpoint of a feature-bit branch.
    {
      static const char *kBlockedSubstrings[] = {
          "indirect",      "packed",        "desc_split",
          "vring_create_", "vring_map_",    "vring_mapping_error",
          "virtio16_to_cpu", "virtio32_to_cpu", "virtio64_to_cpu",
          "cpu_to_virtio"};
      rules.erase(
          std::remove_if(
              rules.begin(), rules.end(),
              [](const Rule &r) {
                if (!StringRef(r.id).endswith("-ctrl"))
                  return false;
                if (r.vars.empty())
                  return false;
                const SourceSchema &src = r.vars.front().schema;
                if (src.clazz != "Mmio" || !src.featureBit.hasValue())
                  return false;
                return std::any_of(
                    r.sinks.begin(), r.sinks.end(),
                    [](const SemanticSink &s) {
                      for (const char *sub : kBlockedSubstrings)
                        if (StringRef(s.function).contains(sub))
                          return true;
                      return false;
                    });
              }),
          rules.end());
    }

    writeJSON(SDGOutputPath, sources, rules);

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
