#pragma once

#include <map>
#include <set>
#include <string>
#include <vector>

#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Passes/PassPlugin.h"

namespace devilang {

struct PhaseRequest {
  std::string machineName;
  std::vector<std::string> entryFunctions;
};

struct BuildRequest {
  std::vector<PhaseRequest> phases;
  std::map<std::string, std::vector<std::string>> indirectCalls;
};

class DevilangModelPass : public llvm::PassInfoMixin<DevilangModelPass> {
public:
  explicit DevilangModelPass(BuildRequest request = {});

  llvm::PreservedAnalyses run(llvm::Module &module,
                              llvm::ModuleAnalysisManager &manager);

  const std::map<std::string, std::string> &outputs() const { return outputs_; }

private:
  BuildRequest request_;
  std::map<std::string, std::string> outputs_;
};

llvm::PassPluginLibraryInfo getDevilangModelPluginInfo();

}  // namespace devilang
