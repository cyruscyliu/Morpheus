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
  bool chainedEntries = false;
};

struct BuildRequest {
  std::vector<PhaseRequest> phases;
  std::map<std::string, std::vector<std::string>> indirectCalls;
  std::map<std::string, std::vector<std::string>> functionEdges;
  std::map<std::string, std::vector<std::string>> pointsToHints;
  std::map<std::string, std::vector<std::string>> pointsToFieldHints;
  std::map<std::string, std::vector<std::string>> pointsToCallHints;
  std::map<std::string, std::vector<std::string>> pointsToUseSiteHints;
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
