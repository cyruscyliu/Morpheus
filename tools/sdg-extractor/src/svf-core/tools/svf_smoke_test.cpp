// svf_smoke_test: verify that SdgSvfCore can load a bitcode, build SVFG,
// and enumerate sinks using the public API.

#include "sdg/core/SemanticValueFlowGraph.h"
#include "sdg/core/SinkCatalog.h"
#include "SVF-LLVM/LLVMUtil.h"
#include "SVF-LLVM/SVFIRBuilder.h"
#include "Graphs/SVFG.h"
#include "SVFIR/SVFIR.h"
#include "Util/ExtAPI.h"
#include "Util/Options.h"
#include "WPA/Andersen.h"
#include <filesystem>
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/IRReader/IRReader.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/SourceMgr.h"
#include <iostream>

using namespace llvm;
using namespace SVF;
using namespace sdg::core;

static cl::opt<std::string> InputFile(cl::Positional, cl::Required,
                                      cl::desc("<input bitcode>"));
static cl::opt<std::string>
    ExtAPIPath("extapi", cl::desc("Path to extapi.bc"),
               cl::init(".morpheus/tools/sdg-extractor/third_party/SVF/install/"
                        "lib/extapi.bc"));

int main(int argc, char **argv) {
  cl::ParseCommandLineOptions(argc, argv, "SdgSvfCore smoke test");

  LLVMContext ctx;
  SMDiagnostic err;
  std::unique_ptr<Module> M = parseIRFile(InputFile, err, ctx);
  if (!M) {
    errs() << "Failed to parse " << InputFile << "\n";
    return 1;
  }

  // After applying patches/extapi-llvm15-typed-pointers.patch the installed
  // extapi.bc is already LLVM-15-parseable bitcode.
  std::filesystem::path extapi = std::string(ExtAPIPath);
  if (!extapi.is_absolute())
    extapi = std::filesystem::current_path() / extapi;
  ExtAPI::getExtAPI()->setExtBcPath(extapi.string());

  std::vector<std::string> mods = {InputFile};
  LLVMModuleSet::preProcessBCs(mods);
  LLVMModuleSet::buildSVFModule(mods);

  SVFIRBuilder builder;
  SVFIR *pag = builder.build();

  Andersen *ander = AndersenWaveDiff::createAndersenWaveDiff(pag);
  CallGraph *callgraph = ander->getCallGraph();
  (void)callgraph;

  ICFG *icfg = pag->getICFG();
  (void)icfg;

  SVFGBuilder svfBuilder;
  SVFG *svfg = svfBuilder.buildFullSVFG(ander);

  SemanticValueFlowGraph svfGraph(svfg);
  SinkCatalog sinks;

  unsigned sourceCount = 0;
  unsigned sinkCount = 0;
  for (Function &F : *M) {
    for (auto &BB : F) {
      for (auto &I : BB) {
        if (auto *CB = dyn_cast<CallBase>(&I)) {
          auto matched = sinks.match(CB);
          if (!matched.empty())
            ++sinkCount;
        }
        // Placeholder: source discovery would go here.
        (void)svfGraph;
      }
    }
  }

  std::cout << "SVFG nodes: " << svfg->getTotalNodeNum() << "\n";
  std::cout << "Discovered sinks: " << sinkCount << "\n";
  std::cout << "(Source discovery not yet implemented)\n";

  LLVMModuleSet::releaseLLVMModuleSet();
  return 0;
}
