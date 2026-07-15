#pragma once

#include <string>

#include "DevilangModelPass.h"

#include "llvm/IR/PassManager.h"

namespace devilang {

std::string buildPhaseModel(
    llvm::Module &module,
    const PhaseRequest &phase,
    const BuildRequest &request,
    llvm::FunctionAnalysisManager *functionAnalysisManager);

}  // namespace devilang
