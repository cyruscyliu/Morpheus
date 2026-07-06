#include "DevilangModelPass.h"

#include <algorithm>
#include <cctype>
#include <map>
#include <set>
#include <string>
#include <sstream>
#include <utility>
#include <vector>

#include "llvm/ADT/SmallString.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/ADT/StringRef.h"
#include "llvm/IR/BasicBlock.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/InstrTypes.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Module.h"
#include "llvm/Passes/PassBuilder.h"

namespace devilang {
namespace {

using llvm::BasicBlock;
using llvm::BranchInst;
using llvm::CallBase;
using llvm::ConstantInt;
using llvm::Function;
using llvm::Instruction;
using llvm::Module;
using llvm::StringRef;
using llvm::Value;

struct TraceBlock {
  std::string label;
  std::vector<std::string> lines;
};

struct TraceModel {
  std::string name;
  std::vector<TraceBlock> blocks;
};

struct MachineModel {
  std::string name;
  std::set<std::string> scratchVars;
  std::vector<TraceModel> traces;
  std::set<std::string> emittedFunctions;
};

std::string sanitizeToken(StringRef input) {
  std::string out;
  out.reserve(input.size());
  bool lastUnderscore = false;
  for (char ch : input) {
    if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_') {
      out.push_back(ch);
      lastUnderscore = false;
      continue;
    }
    if (!lastUnderscore) {
      out.push_back('_');
      lastUnderscore = true;
    }
  }
  if (out.empty()) {
    out = "unnamed";
  }
  if (std::isdigit(static_cast<unsigned char>(out.front()))) {
    out.insert(out.begin(), '_');
  }
  return out;
}

std::string sanitizeFunctionName(const Function &function) {
  return sanitizeToken(function.getName());
}

std::string traceNameFor(const Function &function) {
  return sanitizeFunctionName(function) + "_trace";
}

bool isReadLeaf(StringRef name) {
  return name.startswith("readb") || name.startswith("readw") ||
         name.startswith("readl") || name.startswith("readq") ||
         name.startswith("ioread8") || name.startswith("ioread16") ||
         name.startswith("ioread32") || name.startswith("ioread64") ||
         name.startswith("__raw_readb") || name.startswith("__raw_readw") ||
         name.startswith("__raw_readl") || name.startswith("__raw_readq");
}

bool isWriteLeaf(StringRef name) {
  return name.startswith("writeb") || name.startswith("writew") ||
         name.startswith("writel") || name.startswith("writeq") ||
         name.startswith("iowrite8") || name.startswith("iowrite16") ||
         name.startswith("iowrite32") || name.startswith("iowrite64") ||
         name.startswith("__raw_writeb") || name.startswith("__raw_writew") ||
         name.startswith("__raw_writel") || name.startswith("__raw_writeq");
}

bool isSgFunction(StringRef name) {
  return name == "sg_init_one" || name == "sg_init_table" || name == "sg_set_buf" ||
         name == "sg_next";
}

unsigned ioWidthFromName(StringRef name) {
  if (name.contains("64") || name.endswith("q")) {
    return 64;
  }
  if (name.contains("32") || name.endswith("l")) {
    return 32;
  }
  if (name.contains("16") || name.endswith("w")) {
    return 16;
  }
  return 8;
}

class PhaseBuilder {
public:
  PhaseBuilder(Module &module, PhaseRequest request)
      : module_(module), request_(std::move(request)) {
    model_.name = request_.machineName;
  }

  std::string build() {
    for (const std::string &entryName : request_.entryFunctions) {
      if (Function *entry = module_.getFunction(entryName)) {
        buildTrace(*entry);
      }
    }
    return renderModel();
  }

private:
  Module &module_;
  PhaseRequest request_;
  MachineModel model_;
  unsigned scratchCounter_ = 0;
  unsigned labelCounter_ = 0;

  void buildTrace(Function &function) {
    if (function.isDeclaration()) {
      return;
    }
    std::string functionName = function.getName().str();
    if (!model_.emittedFunctions.insert(functionName).second) {
      return;
    }

    TraceModel trace;
    trace.name = traceNameFor(function);

    std::map<const BasicBlock *, std::string> labels;
    bool entrySeen = false;
    for (const BasicBlock &block : function) {
      if (!entrySeen) {
        labels[&block] = "";
        entrySeen = true;
        continue;
      }
      labels[&block] = "bb_" + sanitizeFunctionName(function) + "_" +
                       std::to_string(labelCounter_++);
    }

    std::set<const BasicBlock *> emittedBlocks;
    emitBlock(function.getEntryBlock(), labels, trace, emittedBlocks);

    for (const BasicBlock &block : function) {
      if (emittedBlocks.find(&block) == emittedBlocks.end()) {
        emitBlock(block, labels, trace, emittedBlocks);
      }
    }

    model_.traces.push_back(std::move(trace));
  }

  void emitBlock(const BasicBlock &block,
                 const std::map<const BasicBlock *, std::string> &labels,
                 TraceModel &trace,
                 std::set<const BasicBlock *> &emittedBlocks) {
    if (!emittedBlocks.insert(&block).second) {
      return;
    }

    TraceBlock out;
    auto labelIt = labels.find(&block);
    if (labelIt != labels.end()) {
      out.label = labelIt->second;
    }

    for (const Instruction &instruction : block) {
      if (const auto *call = llvm::dyn_cast<CallBase>(&instruction)) {
        emitCall(*call, out.lines);
        continue;
      }

      if (const auto *branch = llvm::dyn_cast<BranchInst>(&instruction)) {
        emitBranch(*branch, labels, out.lines);
      }
    }

    if (out.lines.empty()) {
      out.lines.push_back("...");
    }

    trace.blocks.push_back(std::move(out));

    const BranchInst *branch = llvm::dyn_cast<BranchInst>(block.getTerminator());
    if (!branch) {
      return;
    }
    if (branch->isUnconditional()) {
      if (BasicBlock *successor = branch->getSuccessor(0)) {
        emitBlock(*successor, labels, trace, emittedBlocks);
      }
      return;
    }
    BasicBlock *trueBlock = branch->getSuccessor(0);
    BasicBlock *falseBlock = branch->getSuccessor(1);
    if (falseBlock) {
      emitBlock(*falseBlock, labels, trace, emittedBlocks);
    }
    if (trueBlock) {
      emitBlock(*trueBlock, labels, trace, emittedBlocks);
    }
  }

  void emitBranch(const BranchInst &branch,
                  const std::map<const BasicBlock *, std::string> &labels,
                  std::vector<std::string> &lines) {
    if (branch.isUnconditional()) {
      return;
    }
    const std::string condition = renderValue(branch.getCondition());
    const BasicBlock *trueBlock = branch.getSuccessor(0);
    const auto labelIt = labels.find(trueBlock);
    if (labelIt == labels.end() || labelIt->second.empty()) {
      return;
    }
    lines.push_back("neqj " + condition + ", 0, @" + labelIt->second);
  }

  void emitCall(const CallBase &call, std::vector<std::string> &lines) {
    const Function *callee =
        llvm::dyn_cast<Function>(call.getCalledOperand()->stripPointerCasts());
    if (!callee || callee->isIntrinsic()) {
      lines.push_back("...");
      return;
    }

    StringRef name = callee->getName();
    if (isReadLeaf(name)) {
      const unsigned width = ioWidthFromName(name);
      const std::string scratch = nextScratch();
      const std::string address =
          call.arg_size() >= 1 ? renderValue(call.getArgOperand(call.arg_size() - 1))
                               : "unknown";
      lines.push_back(scratch + " = read" + std::to_string(width) + "(" + address +
                      ")");
      return;
    }

    if (isWriteLeaf(name)) {
      const unsigned width = ioWidthFromName(name);
      const std::string value =
          call.arg_size() >= 1 ? renderValue(call.getArgOperand(0)) : "unknown";
      const std::string address =
          call.arg_size() >= 2 ? renderValue(call.getArgOperand(1)) : "unknown";
      lines.push_back("write" + std::to_string(width) + "(" + value + ", " +
                      address + ")");
      return;
    }

    lines.push_back("call " + sanitizeToken(name) + renderCallArgs(call));

    if (!callee->isDeclaration()) {
      buildTrace(*const_cast<Function *>(callee));
    }
  }

  std::string renderCallArgs(const CallBase &call) {
    std::string out = "(";
    for (unsigned index = 0; index < call.arg_size(); ++index) {
      if (index != 0) {
        out += ", ";
      }
      out += renderValue(call.getArgOperand(index));
    }
    out += ")";
    return out;
  }

  std::string renderValue(const Value *value) {
    if (!value) {
      return "unknown";
    }
    if (const auto *constant = llvm::dyn_cast<ConstantInt>(value)) {
      llvm::SmallString<32> buffer;
      constant->getValue().toString(buffer, 10, false);
      return std::string(buffer.str());
    }
    if (const auto *argument = llvm::dyn_cast<llvm::Argument>(value)) {
      if (argument->hasName()) {
        return sanitizeToken(argument->getName());
      }
      return "unknown";
    }
    if (const auto *call = llvm::dyn_cast<CallBase>(value)) {
      if (const Function *callee =
              llvm::dyn_cast<Function>(call->getCalledOperand()->stripPointerCasts())) {
        return sanitizeToken(callee->getName()) + renderCallExprArgs(*call);
      }
      return "unknown";
    }
    if (const auto *instruction = llvm::dyn_cast<Instruction>(value)) {
      if (instruction->hasName()) {
        return sanitizeToken(instruction->getName());
      }
      if (instruction->getOpcode() == llvm::Instruction::Add ||
          instruction->getOpcode() == llvm::Instruction::Sub ||
          instruction->getOpcode() == llvm::Instruction::And ||
          instruction->getOpcode() == llvm::Instruction::Or ||
          instruction->getOpcode() == llvm::Instruction::Shl ||
          instruction->getOpcode() == llvm::Instruction::LShr) {
        const char *op = "+";
        switch (instruction->getOpcode()) {
          case llvm::Instruction::Add:
            op = "+";
            break;
          case llvm::Instruction::Sub:
            op = "-";
            break;
          case llvm::Instruction::And:
            op = "&";
            break;
          case llvm::Instruction::Or:
            op = "|";
            break;
          case llvm::Instruction::Shl:
            op = "<<";
            break;
          case llvm::Instruction::LShr:
            op = ">>";
            break;
          default:
            break;
        }
        return renderValue(instruction->getOperand(0)) + " " + op + " " +
               renderValue(instruction->getOperand(1));
      }
      if (instruction->getNumOperands() >= 1) {
        return renderValue(instruction->getOperand(0));
      }
    }
    if (value->hasName()) {
      return sanitizeToken(value->getName());
    }
    return "unknown";
  }

  std::string renderCallExprArgs(const CallBase &call) {
    std::string out = "(";
    for (unsigned index = 0; index < call.arg_size(); ++index) {
      if (index != 0) {
        out += ", ";
      }
      out += renderValue(call.getArgOperand(index));
    }
    out += ")";
    return out;
  }

  std::string nextScratch() {
    const std::string name = "scratch.auto_" + std::to_string(scratchCounter_++);
    model_.scratchVars.insert(name);
    return name;
  }

  std::string renderModel() {
    std::ostringstream out;
    out << "machine " << sanitizeToken(request_.machineName) << " {\n";
    out << "    initial start\n";
    out << "\n";
    if (!model_.scratchVars.empty()) {
      out << "    scratch {\n";
      for (const std::string &scratch : model_.scratchVars) {
        out << "        " << scratch << ";\n";
      }
      out << "    }\n\n";
    }
    for (const TraceModel &trace : model_.traces) {
      out << "    trace " << sanitizeToken(trace.name) << " {\n";
      bool first = true;
      for (const TraceBlock &block : trace.blocks) {
        if (!first) {
          out << "\n";
        }
        if (!block.label.empty()) {
          out << "        @" << block.label << ": sequence {\n";
        } else {
          out << "        sequence {\n";
        }
        for (const std::string &line : block.lines) {
          out << "            " << line << ";\n";
        }
        out << "        }\n";
        first = false;
      }
      out << "    }\n\n";
    }
    out << "    state start\n";
    out << "}\n";
    return out.str();
  }
};

}  // namespace

DevilangModelPass::DevilangModelPass(BuildRequest request)
    : request_(std::move(request)) {}

llvm::PreservedAnalyses DevilangModelPass::run(llvm::Module &module,
                                               llvm::ModuleAnalysisManager &) {
  outputs_.clear();
  for (const PhaseRequest &phase : request_.phases) {
    PhaseBuilder builder(module, phase);
    outputs_[phase.machineName] = builder.build();
  }
  return llvm::PreservedAnalyses::all();
}

llvm::PassPluginLibraryInfo getDevilangModelPluginInfo() {
  return {LLVM_PLUGIN_API_VERSION, "devilang-model", LLVM_VERSION_STRING,
          [](llvm::PassBuilder &builder) {
            builder.registerPipelineParsingCallback(
                [](StringRef name, llvm::ModulePassManager &manager,
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
