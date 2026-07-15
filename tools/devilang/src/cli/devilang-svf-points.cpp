#include <string>
#include <vector>

#include "DevilangSvfAnalysis.h"

#include "llvm/Support/CommandLine.h"
#include "llvm/Support/InitLLVM.h"
#include "llvm/Support/raw_ostream.h"

namespace {

llvm::cl::OptionCategory cliCategory("devilang-svf-points options");

llvm::cl::list<std::string> modulePaths(
    "module", llvm::cl::desc("Input LLVM IR/bitcode module"),
    llvm::cl::OneOrMore, llvm::cl::cat(cliCategory));

llvm::cl::opt<std::string> outputPath(
    "output", llvm::cl::desc("Output JSON path"),
    llvm::cl::Required, llvm::cl::cat(cliCategory));

llvm::cl::opt<std::string> extapiPath(
    "extapi", llvm::cl::desc("Path to SVF extapi.bc"),
    llvm::cl::init(""), llvm::cl::cat(cliCategory));

}  // namespace

int main(int argc, char **argv) {
  llvm::InitLLVM init(argc, argv);
  llvm::cl::HideUnrelatedOptions(cliCategory);
  llvm::cl::ParseCommandLineOptions(argc, argv,
                                    "devilang direct SVF points-to helper\n");

  devilang::SvfHints hints;
  std::string errorMessage;
  if (!devilang::collectSvfHints(
          std::vector<std::string>(modulePaths.begin(), modulePaths.end()),
          extapiPath, hints, errorMessage)) {
    if (!errorMessage.empty()) {
      llvm::errs() << "error: " << errorMessage << "\n";
    }
    return 1;
  }

  return devilang::writeSvfHintsJson(outputPath, hints.root) ? 0 : 1;
}
