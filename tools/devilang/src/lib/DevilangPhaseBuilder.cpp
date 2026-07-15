// Real translation-unit boundary for the large devilang phase builder internals.
// The topic-named files below are still included textually to keep this
// refactor layout-only, but the public pass wrapper no longer expands them.

#include "DevilangModelPassInternal.h"
#include "DevilangPhaseBuilderCore.cpp"
#include "DevilangPhaseBuilderMmio.cpp"
#include "DevilangPhaseBuilderScope.cpp"
#include "DevilangPhaseBuilderTypeInfo.cpp"
#include "DevilangPhaseBuilderPayloadSchemas.cpp"
#include "DevilangPhaseBuilderPayloadSources.cpp"
#include "DevilangPhaseBuilderRender.cpp"

std::string buildPhaseModel(
    llvm::Module &module,
    const PhaseRequest &phase,
    const BuildRequest &request,
    llvm::FunctionAnalysisManager *functionAnalysisManager) {
  PhaseBuilder builder(module, phase, request.indirectCalls,
                       request.functionEdges,
                       request.pointsToHints,
                       request.pointsToFieldHints,
                       request.pointsToCallHints,
                       request.pointsToUseSiteHints,
                       functionAnalysisManager);
  return builder.build();
}

}  // namespace devilang
