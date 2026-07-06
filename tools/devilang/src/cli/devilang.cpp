#include <memory>
#include <optional>
#include <string>
#include <system_error>
#include <vector>

#include "DevilangModelPass.h"

#include "llvm/IR/LLVMContext.h"
#include "llvm/Linker/Linker.h"
#include "llvm/IR/Module.h"
#include "llvm/IRReader/IRReader.h"
#include "llvm/Passes/PassBuilder.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/InitLLVM.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/raw_ostream.h"

namespace {

llvm::cl::OptionCategory cliCategory("devilang options");

llvm::cl::list<std::string> modulePaths(
    "module", llvm::cl::desc("Input LLVM IR/bitcode module"),
    llvm::cl::OneOrMore, llvm::cl::cat(cliCategory));

llvm::cl::list<std::string> bootingEntries(
    "booting-entry", llvm::cl::desc("Booting phase entry function"),
    llvm::cl::ZeroOrMore, llvm::cl::cat(cliCategory));

llvm::cl::list<std::string> runtimeEntries(
    "runtime-entry", llvm::cl::desc("Runtime phase entry function"),
    llvm::cl::ZeroOrMore, llvm::cl::cat(cliCategory));

llvm::cl::opt<std::string> bootingOutput(
    "booting-output", llvm::cl::desc("Output .state path for booting phase"),
    llvm::cl::cat(cliCategory));

llvm::cl::opt<std::string> runtimeOutput(
    "runtime-output", llvm::cl::desc("Output .state path for runtime phase"),
    llvm::cl::cat(cliCategory));

llvm::cl::opt<std::string> bootingMachineName(
    "booting-machine-name",
    llvm::cl::desc("Machine name for the booting phase output"),
    llvm::cl::init("booting"), llvm::cl::cat(cliCategory));

llvm::cl::opt<std::string> runtimeMachineName(
    "runtime-machine-name",
    llvm::cl::desc("Machine name for the runtime phase output"),
    llvm::cl::init("runtime"), llvm::cl::cat(cliCategory));

bool writeTextFile(const std::string &path, const std::string &content) {
  std::error_code error;
  llvm::raw_fd_ostream stream(path, error, llvm::sys::fs::OF_Text);
  if (error) {
    llvm::errs() << "error: failed to open " << path << ": " << error.message()
                 << "\n";
    return false;
  }
  stream << content;
  return true;
}

}  // namespace

int main(int argc, char **argv) {
  llvm::InitLLVM init(argc, argv);
  llvm::cl::HideUnrelatedOptions(cliCategory);
  llvm::cl::ParseCommandLineOptions(argc, argv,
                                    "devilang llvm-based state generator\n");

  if (bootingEntries.empty() && runtimeEntries.empty()) {
    llvm::errs() << "error: provide at least one --booting-entry or "
                    "--runtime-entry\n";
    return 1;
  }

  if (!bootingEntries.empty() && bootingOutput.empty()) {
    llvm::errs() << "error: --booting-output is required when booting entries "
                    "are provided\n";
    return 1;
  }
  if (!runtimeEntries.empty() && runtimeOutput.empty()) {
    llvm::errs() << "error: --runtime-output is required when runtime entries "
                    "are provided\n";
    return 1;
  }

  llvm::LLVMContext context;
  std::unique_ptr<llvm::Module> module;
  for (const std::string &path : modulePaths) {
    llvm::SMDiagnostic error;
    std::unique_ptr<llvm::Module> nextModule =
        llvm::parseIRFile(path, error, context);
    if (!nextModule) {
      error.print(argv[0], llvm::errs());
      return 1;
    }
    if (!module) {
      module = std::move(nextModule);
      continue;
    }
    llvm::Linker linker(*module);
    if (linker.linkInModule(std::move(nextModule))) {
      llvm::errs() << "error: failed to link module " << path << "\n";
      return 1;
    }
  }

  devilang::BuildRequest request;
  if (!bootingEntries.empty()) {
    request.phases.push_back(
        {bootingMachineName, std::vector<std::string>(bootingEntries.begin(),
                                                      bootingEntries.end())});
  }
  if (!runtimeEntries.empty()) {
    request.phases.push_back(
        {runtimeMachineName, std::vector<std::string>(runtimeEntries.begin(),
                                                      runtimeEntries.end())});
  }

  llvm::PassBuilder passBuilder;
  llvm::LoopAnalysisManager loopAnalysisManager;
  llvm::FunctionAnalysisManager functionAnalysisManager;
  llvm::CGSCCAnalysisManager cgsccAnalysisManager;
  llvm::ModuleAnalysisManager moduleAnalysisManager;

  passBuilder.registerModuleAnalyses(moduleAnalysisManager);
  passBuilder.registerCGSCCAnalyses(cgsccAnalysisManager);
  passBuilder.registerFunctionAnalyses(functionAnalysisManager);
  passBuilder.registerLoopAnalyses(loopAnalysisManager);
  passBuilder.crossRegisterProxies(loopAnalysisManager, functionAnalysisManager,
                                   cgsccAnalysisManager, moduleAnalysisManager);

  devilang::DevilangModelPass pass(std::move(request));
  pass.run(*module, moduleAnalysisManager);

  const auto &outputs = pass.outputs();
  if (!bootingEntries.empty()) {
    auto it = outputs.find(bootingMachineName);
    if (it == outputs.end() || !writeTextFile(bootingOutput, it->second)) {
      return 1;
    }
  }
  if (!runtimeEntries.empty()) {
    auto it = outputs.find(runtimeMachineName);
    if (it == outputs.end() || !writeTextFile(runtimeOutput, it->second)) {
      return 1;
    }
  }

  return 0;
}
