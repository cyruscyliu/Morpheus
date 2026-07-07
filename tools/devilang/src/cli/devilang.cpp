#include <memory>
#include <set>
#include <optional>
#include <string>
#include <system_error>
#include <vector>

#include "DevilangModelPass.h"

#include "llvm/IR/LLVMContext.h"
#include "llvm/Linker/Linker.h"
#include "llvm/Support/MemoryBuffer.h"
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

llvm::cl::opt<std::string> kallgraphText(
    "kallgraph-text",
    llvm::cl::desc("KallGraph indirect-call text produced by llcg"),
    llvm::cl::init(""), llvm::cl::cat(cliCategory));

std::map<std::string, std::vector<std::string>> parseKallgraphText(
    const std::string &path) {
  std::map<std::string, std::vector<std::string>> out;
  if (path.empty()) {
    return out;
  }

  llvm::ErrorOr<std::unique_ptr<llvm::MemoryBuffer>> buffer =
      llvm::MemoryBuffer::getFile(path);
  if (!buffer) {
    llvm::errs() << "error: failed to open kallgraph text " << path << ": "
                 << buffer.getError().message() << "\n";
    return {};
  }

  llvm::SmallVector<llvm::StringRef, 0> lines;
  buffer.get()->getBuffer().split(lines, '\n');

  for (size_t index = 0; index < lines.size();) {
    llvm::StringRef callerLine = lines[index].trim();
    ++index;
    if (callerLine.empty() || callerLine.startswith("#")) {
      continue;
    }

    if (callerLine.contains("->")) {
      llvm::SmallVector<llvm::StringRef, 2> parts;
      callerLine.split(parts, "->", 2, false);
      if (parts.size() == 2) {
        std::string caller = parts[0].trim().str();
        std::string callee = parts[1].trim().str();
        if (!caller.empty() && !callee.empty()) {
          out[caller].push_back(callee);
        }
      }
      continue;
    }

    while (index < lines.size() && lines[index].trim().empty()) {
      ++index;
    }
    if (index >= lines.size()) {
      break;
    }

    llvm::StringRef countLine = lines[index].trim();
    unsigned count = 0;
    if (countLine.getAsInteger(10, count)) {
      llvm::errs() << "warning: malformed kallgraph count for caller "
                   << callerLine << "\n";
      continue;
    }
    ++index;

    std::set<std::string> unique;
    std::vector<std::string> callees;
    while (index < lines.size() && callees.size() < count) {
      llvm::StringRef calleeLine = lines[index].trim();
      ++index;
      if (calleeLine.empty() || calleeLine.startswith("#")) {
        continue;
      }
      std::string callee = calleeLine.str();
      if (unique.insert(callee).second) {
        callees.push_back(std::move(callee));
      }
    }
    if (!callees.empty()) {
      out[callerLine.str()] = std::move(callees);
    }
  }

  return out;
}

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
  request.indirectCalls = parseKallgraphText(kallgraphText);

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
