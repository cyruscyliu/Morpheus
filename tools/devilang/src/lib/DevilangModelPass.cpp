#include "DevilangModelPass.h"

#include "DevilangPhaseBuilder.h"

namespace devilang {

DevilangModelPass::DevilangModelPass(BuildRequest request)
    : request_(std::move(request)) {}

llvm::PreservedAnalyses DevilangModelPass::run(
    llvm::Module &module,
    llvm::ModuleAnalysisManager &manager) {
  outputs_.clear();
  llvm::FunctionAnalysisManager &functionAnalysisManager =
      manager.getResult<llvm::FunctionAnalysisManagerModuleProxy>(module)
          .getManager();
  for (const PhaseRequest &phase : request_.phases) {
    outputs_[phase.machineName] =
        buildPhaseModel(module, phase, request_, &functionAnalysisManager);
  }
  return llvm::PreservedAnalyses::all();
}

llvm::PassPluginLibraryInfo getDevilangModelPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "devilang-model", LLVM_VERSION_STRING,
          [](llvm::PassBuilder &builder) {
            builder.registerPipelineParsingCallback(
                [](llvm::StringRef name,
                   llvm::ModulePassManager &manager,
                   llvm::ArrayRef<llvm::PassBuilder::PipelineElement>) {
                  if (name != "devilang-model") {
                    return false;
                  }
                  manager.addPass(DevilangModelPass());
                  return true;
                });
          }};
}

}  // namespace devilang

extern "C" LLVM_ATTRIBUTE_WEAK ::llvm::PassPluginLibraryInfo
llvmGetPassPluginInfo() {
  return devilang::getDevilangModelPluginInfo();
}
