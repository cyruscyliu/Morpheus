#include "DevilangSvfAnalysis.h"

#include <functional>
#include <map>
#include <set>
#include <string>
#include <system_error>
#include <vector>

#include "llvm/IR/DebugInfoMetadata.h"
#include "llvm/IR/InstIterator.h"
#include "llvm/IR/IntrinsicInst.h"
#include "llvm/IR/Instructions.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

#if DEVILANG_HAVE_SVF
#include "SVF-LLVM/LLVMModule.h"
#include "SVF-LLVM/SVFIRBuilder.h"
#include "Graphs/SVFG.h"
#include "MSSA/SVFGBuilder.h"
#include "Util/ExtAPI.h"
#include "WPA/Andersen.h"
#endif

namespace devilang {
namespace {

using namespace llvm;

std::string sanitizeToken(StringRef input) {
  std::string out;
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
    return "unknown";
  }
  return out;
}

std::string normalizeTypeToken(std::string raw) {
  for (const char *prefix : {"struct.", "union.", "class."}) {
    StringRef prefixRef(prefix);
    if (StringRef(raw).startswith(prefixRef)) {
      raw.erase(0, prefixRef.size());
      break;
    }
  }
  return sanitizeToken(raw);
}

std::map<std::string, std::vector<std::string>> collectStringHintsFromQueries(
    const llvm::json::Array *queries,
    StringRef keyName) {
  std::map<std::string, std::vector<std::string>> out;
  if (!queries) {
    return out;
  }
  for (const llvm::json::Value &queryValue : *queries) {
    const llvm::json::Object *query = queryValue.getAsObject();
    if (!query) {
      continue;
    }
    auto callsite = query->getString("callsite");
    auto callee = query->getString("callee");
    auto argIndex = query->getInteger("arg_index");
    const llvm::json::Array *items = query->getArray(keyName);
    if (!callsite || !callee || !argIndex || !items) {
      continue;
    }
    std::set<std::string> unique;
    std::vector<std::string> values;
    for (const llvm::json::Value &itemValue : *items) {
      auto item = itemValue.getAsString();
      if (!item || item->empty()) {
        continue;
      }
      if (unique.insert(item->str()).second) {
        values.push_back(item->str());
      }
    }
    if (!values.empty()) {
      out[buildPointsToHintKey(callsite->str(), callee->str(), *argIndex)] =
          std::move(values);
    }
  }
  return out;
}

std::map<std::string, std::vector<std::string>> collectTypeHintsFromQueries(
    const llvm::json::Array *queries) {
  std::map<std::string, std::vector<std::string>> out;
  if (!queries) {
    return out;
  }
  for (const llvm::json::Value &queryValue : *queries) {
    const llvm::json::Object *query = queryValue.getAsObject();
    if (!query) {
      continue;
    }
    auto callsite = query->getString("callsite");
    auto callee = query->getString("callee");
    auto argIndex = query->getInteger("arg_index");
    const llvm::json::Array *types = query->getArray("points_to_types");
    const llvm::json::Array *taintTypes = query->getArray("taint_types");
    if (!callsite || !callee || !argIndex || (!types && !taintTypes)) {
      continue;
    }
    std::set<std::string> unique;
    std::vector<std::string> values;
    auto collect = [&](const llvm::json::Array *items) {
      if (!items) {
        return;
      }
      for (const llvm::json::Value &typeValue : *items) {
        auto typeName = typeValue.getAsString();
        if (!typeName || typeName->empty()) {
          continue;
        }
        if (unique.insert(typeName->str()).second) {
          values.push_back(typeName->str());
        }
      }
    };
    collect(types);
    collect(taintTypes);
    if (!values.empty()) {
      out[buildPointsToHintKey(callsite->str(), callee->str(), *argIndex)] =
          std::move(values);
    }
  }
  return out;
}

#if DEVILANG_HAVE_SVF
using namespace SVF;

struct QuerySpec {
  std::string callee;
  unsigned argIndex = 0;
};

static const std::map<std::string, unsigned> kDefaultQueries = {
    {"sg_set_buf", 1u},
    {"sg_init_one", 1u},
    {"vring_map_single", 1u},
};

std::string callsiteKey(const Instruction *inst) {
  if (!inst) {
    return "";
  }
  const DebugLoc &debugLoc = inst->getDebugLoc();
  if (!debugLoc) {
    return "";
  }
  const DILocation *location = debugLoc.get();
  const DIScope *scope = location->getScope();
  const auto *file = scope ? scope->getFile() : nullptr;
  if (!file) {
    return "";
  }
  std::string filename = file->getFilename().str();
  std::string directory = file->getDirectory().str();
  if (!directory.empty()) {
    return directory + "/" + filename + ":" + std::to_string(location->getLine());
  }
  return filename + ":" + std::to_string(location->getLine());
}

std::string typeNameFromType(const Type *type) {
  const Type *current = type;
  SmallPtrSet<const Type *, 8> visited;
  while (current && visited.insert(current).second) {
    if (const auto *ptr = dyn_cast<PointerType>(current)) {
      current = ptr->getPointerElementType();
      continue;
    }
    if (const auto *array = dyn_cast<ArrayType>(current)) {
      current = array->getElementType();
      continue;
    }
    if (const auto *structTy = dyn_cast<StructType>(current)) {
      if (structTy->hasName()) {
        return normalizeTypeToken(structTy->getName().str());
      }
    }
    break;
  }
  return "";
}

void addTypeInfoFromValue(const Value *value, std::set<std::string> &typeNames,
                          std::set<std::string> &valueNames) {
  if (!value) {
    return;
  }
  valueNames.insert(sanitizeToken(value->getName()));
  std::string directType = typeNameFromType(value->getType());
  if (!directType.empty()) {
    typeNames.insert(directType);
  }
}

std::string gepFieldPath(const GetElementPtrInst *gep) {
  if (!gep) {
    return "";
  }
  std::string typeName = typeNameFromType(gep->getPointerOperandType());
  if (typeName.empty()) {
    typeName = typeNameFromType(gep->getSourceElementType());
  }
  if (typeName.empty()) {
    typeName = "unknown";
  }
  std::string path = sanitizeToken(typeName);
  unsigned componentCount = 0;
  for (const Use &indexUse : gep->indices()) {
    const auto *ci = dyn_cast<ConstantInt>(indexUse.get());
    if (!ci) {
      continue;
    }
    path += componentCount == 0 ? "__field_" : "_";
    path += std::to_string(ci->getSExtValue());
    componentCount++;
  }
  return componentCount == 0 ? "" : path;
}

std::string fieldNameFromDebugType(DIType *type, uint64_t index) {
  if (!type) {
    return "";
  }
  if (auto *derived = dyn_cast<DIDerivedType>(type)) {
    return fieldNameFromDebugType(derived->getBaseType(), index);
  }
  auto *composite = dyn_cast<DICompositeType>(type);
  if (!composite) {
    return "";
  }
  DINodeArray elements = composite->getElements();
  uint64_t memberIndex = 0;
  for (Metadata *md : elements) {
    auto *member = dyn_cast<DIDerivedType>(md);
    if (!member) {
      continue;
    }
    if (memberIndex == index) {
      return sanitizeToken(member->getName());
    }
    memberIndex++;
  }
  return "";
}

DIType *stripDebugType(DIType *type);
void addSyntheticFieldsForDebugType(DIType *debugType,
                                    std::set<std::string> &taintFields);

std::string typeNameFromDebugType(DIType *type) {
  if (!type) {
    return "";
  }
  if (auto *derived = dyn_cast<DIDerivedType>(type)) {
    if (!derived->getName().empty()) {
      return sanitizeToken(derived->getName());
    }
    return typeNameFromDebugType(derived->getBaseType());
  }
  if (auto *basic = dyn_cast<DIBasicType>(type)) {
    if (!basic->getName().empty()) {
      return sanitizeToken(basic->getName());
    }
  }
  if (auto *composite = dyn_cast<DICompositeType>(type)) {
    if (!composite->getName().empty()) {
      return sanitizeToken(composite->getName());
    }
    if (composite->getBaseType()) {
      return typeNameFromDebugType(composite->getBaseType());
    }
  }
  return "";
}

DIType *stripDebugType(DIType *type) {
  while (auto *derived = dyn_cast_or_null<DIDerivedType>(type)) {
    if (!derived->getBaseType()) {
      break;
    }
    type = derived->getBaseType();
  }
  return type;
}

DIType *fieldDebugType(DIType *type, uint64_t index) {
  type = stripDebugType(type);
  auto *composite = dyn_cast_or_null<DICompositeType>(type);
  if (!composite) {
    return nullptr;
  }
  uint64_t memberIndex = 0;
  for (Metadata *md : composite->getElements()) {
    auto *member = dyn_cast<DIDerivedType>(md);
    if (!member) {
      continue;
    }
    if (memberIndex == index) {
      return member->getBaseType();
    }
    memberIndex++;
  }
  return nullptr;
}

DIType *arrayElementDebugType(DIType *type) {
  type = stripDebugType(type);
  auto *composite = dyn_cast_or_null<DICompositeType>(type);
  if (!composite) {
    return nullptr;
  }
  for (Metadata *md : composite->getElements()) {
    if (isa<DISubrange>(md)) {
      return composite->getBaseType();
    }
  }
  return composite->getBaseType();
}

DIType *debugTypeFromDbgIntrinsic(const DbgVariableIntrinsic *dbg) {
  if (!dbg) {
    return nullptr;
  }
  if (const auto *var = dyn_cast_or_null<DILocalVariable>(dbg->getVariable())) {
    return var->getType();
  }
  return nullptr;
}

int debugTypeSpecificity(DIType *type) {
  if (!type) {
    return -1;
  }
  int score = 0;
  if (auto *derived = dyn_cast<DIDerivedType>(type)) {
    if (derived->getTag() == dwarf::DW_TAG_typedef &&
        !derived->getName().empty()) {
      score += 40;
    } else if (!derived->getName().empty()) {
      score += 10;
    }
    score += debugTypeSpecificity(derived->getBaseType());
    return score;
  }
  if (auto *basic = dyn_cast<DIBasicType>(type)) {
    if (!basic->getName().empty()) {
      score += basic->getName() == "void" ? 1 : 30;
    }
    return score;
  }
  if (auto *composite = dyn_cast<DICompositeType>(type)) {
    if (!composite->getName().empty()) {
      score += 35;
    }
    if (composite->getTag() == dwarf::DW_TAG_array_type) {
      score += 5;
    }
    score += debugTypeSpecificity(composite->getBaseType());
    return score;
  }
  return score;
}

template <typename ConsiderFn>
void considerFunctionDebugTypesForValue(const Value *needle, const Function *function,
                                        ConsiderFn &&consider) {
  if (!needle || !function) {
    return;
  }
  for (const Instruction &inst : instructions(*function)) {
    if (const auto *dbgDecl = dyn_cast<DbgDeclareInst>(&inst)) {
      if (dbgDecl->getAddress() == needle) {
        consider(debugTypeFromDbgIntrinsic(dbgDecl));
      }
      continue;
    }
    if (const auto *dbgValue = dyn_cast<DbgValueInst>(&inst)) {
      if (dbgValue->getValue() == needle) {
        consider(debugTypeFromDbgIntrinsic(dbgValue));
      }
    }
  }
}

DIType *debugTypeForValue(const Value *value) {
  SmallPtrSet<const Value *, 16> visited;
  DIType *bestType = nullptr;
  int bestScore = -1;
  auto consider = [&](DIType *type) {
    const int score = debugTypeSpecificity(type);
    if (score > bestScore) {
      bestType = type;
      bestScore = score;
    }
  };
  std::function<DIType *(const Value *)> visit = [&](const Value *current) -> DIType * {
    if (!current || !visited.insert(current).second) {
      return nullptr;
    }
    if (const auto *arg = dyn_cast<Argument>(current)) {
      if (const Function *parent = arg->getParent()) {
        considerFunctionDebugTypesForValue(arg, parent, consider);
      }
    }
    if (const auto *inst = dyn_cast<Instruction>(current)) {
      considerFunctionDebugTypesForValue(current, inst->getFunction(), consider);
      for (const User *user : inst->users()) {
        if (const auto *dbgDecl = dyn_cast<DbgDeclareInst>(user)) {
          consider(debugTypeFromDbgIntrinsic(dbgDecl));
        }
        if (const auto *dbgValue = dyn_cast<DbgValueInst>(user)) {
          if (dbgValue->getValue() == current) {
            consider(debugTypeFromDbgIntrinsic(dbgValue));
          }
        }
        if (const auto *store = dyn_cast<StoreInst>(user)) {
          if (store->getValueOperand() == current) {
            visit(store->getPointerOperand());
          }
        }
      }
      for (const Instruction *cursor = inst; cursor; cursor = cursor->getPrevNode()) {
        if (const auto *dbg = dyn_cast<DbgValueInst>(cursor)) {
          if (dbg->getValue() == current) {
            consider(debugTypeFromDbgIntrinsic(dbg));
          }
        }
      }
      if (const auto *load = dyn_cast<LoadInst>(inst)) {
        visit(load->getPointerOperand());
      }
      if (const auto *gep = dyn_cast<GetElementPtrInst>(inst)) {
        visit(gep->getPointerOperand());
      }
      if (inst->getOpcode() == Instruction::BitCast ||
          inst->getOpcode() == Instruction::AddrSpaceCast) {
        visit(inst->getOperand(0));
      }
      if (const auto *phi = dyn_cast<PHINode>(inst)) {
        for (const Value *incoming : phi->incoming_values()) {
          visit(incoming);
        }
      }
      if (const auto *select = dyn_cast<SelectInst>(inst)) {
        visit(select->getTrueValue());
        visit(select->getFalseValue());
      }
    }
    if (const auto *ce = dyn_cast<ConstantExpr>(current)) {
      if (ce->isCast() || ce->getOpcode() == Instruction::GetElementPtr) {
        visit(ce->getOperand(0));
      }
    }
    if (const auto *op = dyn_cast<GEPOperator>(current)) {
      visit(op->getPointerOperand());
    }
    return bestType;
  };
  visit(value);
  return bestType;
}

struct DebugPointerInfo {
  DIType *type = nullptr;
  uint64_t constantOffset = 0;
  bool sawDynamicIndex = false;
};

uint64_t debugTypeSizeBytes(DIType *type) {
  type = stripDebugType(type);
  if (!type) {
    return 0;
  }
  return type->getSizeInBits() / 8;
}

void collectFieldPathFromDebugOffset(DIType *type, uint64_t offsetBytes,
                                     SmallVectorImpl<std::string> &parts,
                                     bool stopAtArray = true) {
  type = stripDebugType(type);
  if (!type) {
    return;
  }
  if (auto *basic = dyn_cast<DIBasicType>(type)) {
    if (offsetBytes == 0) {
      parts.push_back("value");
    }
    return;
  }
  auto *composite = dyn_cast<DICompositeType>(type);
  if (!composite) {
    return;
  }
  if (composite->getTag() == dwarf::DW_TAG_array_type) {
    if (stopAtArray) {
      return;
    }
    uint64_t elemSize = debugTypeSizeBytes(composite->getBaseType());
    uint64_t elemIndex = 0;
    if (elemSize != 0) {
      elemIndex = offsetBytes / elemSize;
      offsetBytes %= elemSize;
    }
    parts.push_back("elem_" + std::to_string(elemIndex));
    collectFieldPathFromDebugOffset(composite->getBaseType(), offsetBytes, parts,
                                    stopAtArray);
    return;
  }

  SmallVector<const DIDerivedType *, 8> members;
  for (Metadata *md : composite->getElements()) {
    if (const auto *member = dyn_cast<DIDerivedType>(md)) {
      members.push_back(member);
    }
  }
  SmallVector<std::string, 8> bestCandidate;
  int bestScore = -1;
  for (const DIDerivedType *member : members) {
    const uint64_t memberOffset = member->getOffsetInBits() / 8;
    uint64_t memberSize = debugTypeSizeBytes(member->getBaseType());
    if (memberSize == 0) {
      memberSize = offsetBytes >= memberOffset ? (offsetBytes - memberOffset) + 1 : 0;
    }
    const bool contains =
        composite->getTag() == dwarf::DW_TAG_union_type
            ? true
            : (offsetBytes >= memberOffset &&
               (memberSize == 0 || offsetBytes < memberOffset + memberSize));
    if (!contains) {
      continue;
    }
    SmallVector<std::string, 8> candidate;
    std::string fieldName = sanitizeToken(member->getName());
    if (!fieldName.empty() && fieldName != "unknown") {
      candidate.push_back(fieldName);
    }
    const size_t beforeRecurse = candidate.size();
    collectFieldPathFromDebugOffset(member->getBaseType(),
                                    offsetBytes >= memberOffset
                                        ? offsetBytes - memberOffset
                                        : offsetBytes,
                                    candidate, stopAtArray);
    const int recurseScore = static_cast<int>(candidate.size() - beforeRecurse);
    const int emptyPenalty =
        (!fieldName.empty() && StringRef(fieldName).startswith("__empty")) ? 5 : 0;
    const int score =
        static_cast<int>(candidate.size()) * 10 + recurseScore - emptyPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate.assign(candidate.begin(), candidate.end());
    }
  }
  if (bestScore >= 0) {
    parts.append(bestCandidate.begin(), bestCandidate.end());
  }
}

bool accumulateDebugPointerInfo(const Value *value, DebugPointerInfo &info) {
  if (!value) {
    return false;
  }
  if (DIType *type = debugTypeForValue(value)) {
    info.type = type;
  }

  if (const auto *inst = dyn_cast<Instruction>(value)) {
    if (const auto *gep = dyn_cast<GetElementPtrInst>(inst)) {
      if (!accumulateDebugPointerInfo(gep->getPointerOperand(), info)) {
        info.type = info.type ? info.type : debugTypeForValue(gep->getPointerOperand());
      }
      bool allConstant = true;
      if (gep->getSourceElementType()->isSized()) {
        const DataLayout &dl = gep->getModule()->getDataLayout();
        Type *currentType = gep->getSourceElementType();
        bool firstIndex = true;
        for (Value *indexValue : gep->indices()) {
          auto *ci = dyn_cast<ConstantInt>(indexValue);
          if (!ci) {
            info.sawDynamicIndex = true;
            allConstant = false;
            break;
          }
          int64_t idx = ci->getSExtValue();
          if (firstIndex) {
            firstIndex = false;
            if (!isa<StructType>(currentType)) {
              info.constantOffset +=
                  static_cast<uint64_t>(
                      std::max<int64_t>(0, idx)) *
                  dl.getTypeAllocSize(currentType);
              continue;
            }
          }
          if (auto *structTy = dyn_cast<StructType>(currentType)) {
            if (idx < 0 || static_cast<unsigned>(idx) >= structTy->getNumElements()) {
              allConstant = false;
              break;
            }
            const StructLayout *layout = dl.getStructLayout(structTy);
            info.constantOffset += layout->getElementOffset(idx);
            currentType = structTy->getElementType(idx);
            continue;
          }
          if (auto *arrayTy = dyn_cast<ArrayType>(currentType)) {
            info.constantOffset +=
                static_cast<uint64_t>(std::max<int64_t>(0, idx)) *
                dl.getTypeAllocSize(arrayTy->getElementType());
            currentType = arrayTy->getElementType();
            continue;
          }
          if (auto *ptrTy = dyn_cast<PointerType>(currentType)) {
            Type *elemTy = ptrTy->getPointerElementType();
            info.constantOffset +=
                static_cast<uint64_t>(std::max<int64_t>(0, idx)) *
                dl.getTypeAllocSize(elemTy);
            currentType = elemTy;
            continue;
          }
          allConstant = false;
          break;
        }
      }
      return info.type != nullptr || allConstant;
    }
    if (inst->getOpcode() == Instruction::BitCast ||
        inst->getOpcode() == Instruction::AddrSpaceCast) {
      return accumulateDebugPointerInfo(inst->getOperand(0), info);
    }
  }
  if (const auto *ce = dyn_cast<ConstantExpr>(value)) {
    if (ce->isCast()) {
      return accumulateDebugPointerInfo(ce->getOperand(0), info);
    }
  }
  if (const auto *op = dyn_cast<GEPOperator>(value)) {
    DebugPointerInfo nested;
    if (!accumulateDebugPointerInfo(op->getPointerOperand(), nested)) {
      nested.type = nested.type ? nested.type : debugTypeForValue(op->getPointerOperand());
    }
    info.type = nested.type ? nested.type : info.type;
    const Instruction *ctxInst = dyn_cast<Instruction>(value);
    const Module *module = ctxInst ? ctxInst->getModule() : nullptr;
    if (!module || !op->getSourceElementType()->isSized()) {
      return info.type != nullptr;
    }
    const DataLayout &dl = module->getDataLayout();
    Type *currentType = op->getSourceElementType();
    bool firstIndex = true;
    for (Value *indexValue : op->indices()) {
      auto *ci = dyn_cast<ConstantInt>(indexValue);
      if (!ci) {
        info.sawDynamicIndex = true;
        break;
      }
      int64_t idx = ci->getSExtValue();
      if (firstIndex) {
        firstIndex = false;
        if (!isa<StructType>(currentType)) {
          info.constantOffset +=
              static_cast<uint64_t>(std::max<int64_t>(0, idx)) *
              dl.getTypeAllocSize(currentType);
          continue;
        }
      }
      if (auto *structTy = dyn_cast<StructType>(currentType)) {
        if (idx < 0 || static_cast<unsigned>(idx) >= structTy->getNumElements()) {
          break;
        }
        const StructLayout *layout = dl.getStructLayout(structTy);
        info.constantOffset += layout->getElementOffset(idx);
        currentType = structTy->getElementType(idx);
        continue;
      }
      if (auto *arrayTy = dyn_cast<ArrayType>(currentType)) {
        info.constantOffset +=
            static_cast<uint64_t>(std::max<int64_t>(0, idx)) *
            dl.getTypeAllocSize(arrayTy->getElementType());
        currentType = arrayTy->getElementType();
        continue;
      }
      break;
    }
    return info.type != nullptr;
  }
  return info.type != nullptr;
}

void addDebugFieldHintsForValue(const Value *value, std::set<std::string> &typeNames,
                                std::set<std::string> &taintFields) {
  DebugPointerInfo info;
  if (!accumulateDebugPointerInfo(value, info) || !info.type) {
    if (DIType *debugType = debugTypeForValue(value)) {
      const std::string typeName = typeNameFromDebugType(debugType);
      if (!typeName.empty()) {
        typeNames.insert(typeName);
      }
      addSyntheticFieldsForDebugType(debugType, taintFields);
    }
    return;
  }
  const std::string typeName = typeNameFromDebugType(info.type);
  if (!typeName.empty()) {
    typeNames.insert(typeName);
  }
  SmallVector<std::string, 8> parts;
  collectFieldPathFromDebugOffset(info.type, info.constantOffset, parts);
  if (!parts.empty() && !typeName.empty()) {
    std::string path = typeName;
    for (const std::string &part : parts) {
      path += "__" + sanitizeToken(part);
    }
    taintFields.insert(path);
    return;
  }
  addSyntheticFieldsForDebugType(info.type, taintFields);
}

std::string fieldPathForGepOperands(Type *sourceType,
                                    SmallVectorImpl<Value *> &indices,
                                    DIType *debugType) {
  std::string typeName = typeNameFromType(sourceType);
  if (typeName.empty()) {
    typeName = typeNameFromDebugType(debugType);
  }
  if (typeName.empty()) {
    typeName = "unknown";
  }

  SmallVector<std::string, 8> parts;
  Type *currentType = sourceType;
  bool firstIndex = true;
  for (Value *indexValue : indices) {
    auto *ci = dyn_cast<ConstantInt>(indexValue);
    if (!ci) {
      firstIndex = false;
      continue;
    }
    uint64_t idx = ci->getZExtValue();
    if (firstIndex && idx == 0 && currentType && !isa<ArrayType>(currentType)) {
      firstIndex = false;
      continue;
    }
    firstIndex = false;

    if (const auto *structTy = dyn_cast_or_null<StructType>(currentType)) {
      std::string fieldName = debugType ? fieldNameFromDebugType(debugType, idx) : "";
      if (fieldName.empty()) {
        fieldName = "field_" + std::to_string(idx);
      }
      parts.push_back(fieldName);
      currentType =
          idx < structTy->getNumElements() ? structTy->getElementType(idx) : nullptr;
      debugType = fieldDebugType(debugType, idx);
      continue;
    }

    if (const auto *arrayTy = dyn_cast_or_null<ArrayType>(currentType)) {
      parts.push_back("elem_" + std::to_string(idx));
      currentType = arrayTy->getElementType();
      debugType = arrayElementDebugType(debugType);
      continue;
    }

    parts.push_back("field_" + std::to_string(idx));
  }

  if (parts.empty()) {
    return "";
  }
  std::string path = sanitizeToken(typeName);
  path += "__";
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i != 0) {
      path += "__";
    }
    path += sanitizeToken(parts[i]);
  }
  return path;
}

void synthesizeFieldPathsFromDebugType(DIType *type, StringRef prefix,
                                       SmallVectorImpl<std::string> &out,
                                       unsigned depth = 0) {
  type = stripDebugType(type);
  if (!type || depth > 3) {
    return;
  }
  if (isa<DIBasicType>(type)) {
    out.push_back((prefix + "__value").str());
    return;
  }
  if (auto *composite = dyn_cast<DICompositeType>(type)) {
    bool emitted = false;
    unsigned memberIndex = 0;
    for (Metadata *md : composite->getElements()) {
      if (auto *member = dyn_cast<DIDerivedType>(md)) {
        std::string fieldName = sanitizeToken(member->getName());
        if (fieldName.empty() || fieldName == "unknown") {
          fieldName = "field_" + std::to_string(memberIndex);
        }
        const std::string fieldPrefix = (prefix + "__" + fieldName).str();
        out.push_back(fieldPrefix);
        synthesizeFieldPathsFromDebugType(member->getBaseType(), fieldPrefix, out,
                                          depth + 1);
        memberIndex++;
        emitted = true;
        continue;
      }
      if (isa<DISubrange>(md)) {
        const std::string elemPrefix = (prefix + "__elem_0").str();
        out.push_back(elemPrefix);
        synthesizeFieldPathsFromDebugType(composite->getBaseType(), elemPrefix, out,
                                          depth + 1);
        emitted = true;
      }
    }
    if (!emitted && composite->getBaseType()) {
      synthesizeFieldPathsFromDebugType(composite->getBaseType(), prefix, out,
                                        depth + 1);
    }
  }
}

std::string gepFieldPathWithDebug(const GetElementPtrInst *gep) {
  if (!gep) {
    return "";
  }
  DIType *debugType = debugTypeForValue(gep->getPointerOperand());
  SmallVector<Value *, 8> indexValues;
  for (Value *indexValue : gep->indices()) {
    indexValues.push_back(indexValue);
  }
  return fieldPathForGepOperands(gep->getSourceElementType(), indexValues, debugType);
}

bool isGenericFieldPath(StringRef fieldPath) {
  if (fieldPath.empty()) {
    return true;
  }
  SmallVector<StringRef, 8> parts;
  fieldPath.split(parts, "__", -1, false);
  if (parts.size() <= 1) {
    return true;
  }
  for (size_t i = 1; i < parts.size(); ++i) {
    if (!parts[i].startswith("field_") && !parts[i].startswith("elem_")) {
      return false;
    }
  }
  return true;
}

std::string sourceLocKey(const Instruction *inst) {
  if (!inst) {
    return "";
  }
  const DebugLoc &debugLoc = inst->getDebugLoc();
  if (!debugLoc) {
    return "";
  }
  const DILocation *location = debugLoc.get();
  const DIScope *scope = location->getScope();
  const auto *file = scope ? scope->getFile() : nullptr;
  if (!file) {
    return "";
  }
  std::string filename = file->getFilename().str();
  std::string directory = file->getDirectory().str();
  if (!directory.empty()) {
    return directory + "/" + filename + ":" + std::to_string(location->getLine());
  }
  return filename + ":" + std::to_string(location->getLine());
}

const StructType *findStructTypeByToken(StringRef typeToken) {
  if (typeToken.empty() || typeToken == "unknown") {
    return nullptr;
  }
  for (const Module &moduleRef : LLVMModuleSet::getLLVMModuleSet()->getLLVMModules()) {
    for (StructType *structTy : moduleRef.getIdentifiedStructTypes()) {
      if (!structTy || !structTy->hasName()) {
        continue;
      }
      if (normalizeTypeToken(structTy->getName().str()) == typeToken) {
        return structTy;
      }
    }
  }
  return nullptr;
}

void synthesizeFieldPathsFromType(const Type *type, StringRef prefix,
                                  SmallVectorImpl<std::string> &out,
                                  unsigned depth = 0) {
  if (!type || depth > 3) {
    return;
  }
  if (const auto *ptr = dyn_cast<PointerType>(type)) {
    synthesizeFieldPathsFromType(ptr->getPointerElementType(), prefix, out, depth);
    return;
  }
  if (const auto *arrayTy = dyn_cast<ArrayType>(type)) {
    const std::string elemPrefix = (prefix + "__elem_0").str();
    out.push_back(elemPrefix);
    synthesizeFieldPathsFromType(arrayTy->getElementType(), elemPrefix, out, depth + 1);
    return;
  }
  const auto *structTy = dyn_cast<StructType>(type);
  if (!structTy) {
    return;
  }
  for (unsigned i = 0; i < structTy->getNumElements(); ++i) {
    std::string fieldPrefix =
        (prefix + "__field_" + Twine(i)).str();
    out.push_back(fieldPrefix);
    synthesizeFieldPathsFromType(structTy->getElementType(i), fieldPrefix, out, depth + 1);
  }
}

void addSyntheticFieldsForTypes(const std::set<std::string> &typeNames,
                                std::set<std::string> &taintFields) {
  for (const std::string &typeName : typeNames) {
    const StructType *structTy = findStructTypeByToken(typeName);
    if (!structTy) {
      continue;
    }
    SmallVector<std::string, 32> fields;
    synthesizeFieldPathsFromType(structTy, typeName, fields);
    for (const std::string &field : fields) {
      if (!field.empty()) {
        taintFields.insert(field);
      }
    }
  }
}

void addSyntheticFieldsForDebugType(DIType *debugType,
                                    std::set<std::string> &taintFields) {
  const std::string typeName = typeNameFromDebugType(debugType);
  if (typeName.empty()) {
    return;
  }
  SmallVector<std::string, 32> fields;
  synthesizeFieldPathsFromDebugType(debugType, typeName, fields);
  for (const std::string &field : fields) {
    if (!field.empty()) {
      taintFields.insert(field);
    }
  }
}

void collectTaintSummary(const Value *seedValue, SVFIR *pag, SVFG *svfg,
                         std::set<std::string> &taintTypes,
                         std::set<std::string> &taintCalls,
                         std::set<std::string> &taintUseSites,
                         std::set<std::string> &taintFields) {
  if (!seedValue || !svfg ||
      !LLVMModuleSet::getLLVMModuleSet()->hasValueNode(seedValue)) {
    return;
  }
  NodeID seedId = LLVMModuleSet::getLLVMModuleSet()->getValueNode(seedValue);
  const SVFVar *seedVar = pag->getGNode(seedId);
  const auto *valVar = SVFUtil::dyn_cast<ValVar>(seedVar);
  if (!valVar || !svfg->hasDefSVFGNode(valVar)) {
    return;
  }

  const Set<const ICFGNode *> useSites = svfg->getUseSitesOfValVar(valVar);
  for (const ICFGNode *node : useSites) {
    if (!node) {
      continue;
    }
    for (const SVFStmt *stmt : node->getSVFStmts()) {
      const Value *llvmValue =
          stmt ? LLVMModuleSet::getLLVMModuleSet()->getLLVMValue(stmt->getValue())
               : nullptr;
      const auto *inst = llvmValue ? dyn_cast<Instruction>(llvmValue) : nullptr;
      if (!inst) {
        continue;
      }
      std::string loc = sourceLocKey(inst);
      if (!loc.empty()) {
        taintUseSites.insert(loc);
      }
      std::string directType = typeNameFromType(inst->getType());
      if (!directType.empty()) {
        taintTypes.insert(directType);
      }
      if (const auto *call = dyn_cast<CallBase>(inst)) {
        if (const Function *callee = call->getCalledFunction()) {
          taintCalls.insert(callee->getName().str());
        }
      }
      if (const auto *gep = dyn_cast<GetElementPtrInst>(inst)) {
        std::string sourceType = typeNameFromType(gep->getSourceElementType());
        if (!sourceType.empty()) {
          taintTypes.insert(sourceType);
        }
        std::string baseType = typeNameFromType(gep->getPointerOperandType());
        if (!baseType.empty()) {
          taintTypes.insert(baseType);
        }
        std::string fieldPath = gepFieldPathWithDebug(gep);
        if (fieldPath.empty()) {
          fieldPath = gepFieldPath(gep);
        }
        if (!fieldPath.empty()) {
          taintFields.insert(fieldPath);
        }
      }
    }
  }
  if (taintFields.empty()) {
    if (DIType *debugType = debugTypeForValue(seedValue)) {
      const std::string debugTypeName = typeNameFromDebugType(debugType);
      if (!debugTypeName.empty()) {
        taintTypes.insert(debugTypeName);
      }
      addSyntheticFieldsForDebugType(debugType, taintFields);
    }
  }
  if (taintFields.empty() && !taintTypes.empty()) {
    addSyntheticFieldsForTypes(taintTypes, taintFields);
  }
}

llvm::json::Object buildQueryRecord(const Function *caller, const CallInst *call,
                                    StringRef calleeName, unsigned argIndex,
                                    PointerAnalysis *pta, SVFIR *pag,
                                    SVFG *svfg) {
  llvm::json::Object record;
  record["callsite"] = callsiteKey(call);
  record["caller"] = caller ? caller->getName().str() : "";
  record["callee"] = calleeName.str();
  record["arg_index"] = static_cast<int64_t>(argIndex);

  Value *rawArgValue = call->getArgOperand(argIndex);
  Value *argValue = rawArgValue ? rawArgValue->stripPointerCasts() : nullptr;
  record["arg_value"] = argValue ? argValue->getName().str() : "";

  std::set<std::string> typeNames;
  std::set<std::string> valueNames;
  std::set<std::string> taintTypes;
  std::set<std::string> taintCalls;
  std::set<std::string> taintUseSites;
  std::set<std::string> taintFields;
  addTypeInfoFromValue(rawArgValue, typeNames, valueNames);
  addTypeInfoFromValue(argValue, typeNames, valueNames);
  if (DIType *debugType = debugTypeForValue(rawArgValue)) {
    const std::string debugTypeName = typeNameFromDebugType(debugType);
    if (!debugTypeName.empty()) {
      typeNames.insert(debugTypeName);
    }
  }
  if (const auto *gep = dyn_cast<GetElementPtrInst>(rawArgValue)) {
    std::string fieldPath = gepFieldPathWithDebug(gep);
    if (fieldPath.empty()) {
      fieldPath = gepFieldPath(gep);
    }
    if (!fieldPath.empty()) {
      taintFields.insert(fieldPath);
    }
  } else if (const auto *op = dyn_cast<GEPOperator>(rawArgValue)) {
    SmallVector<Value *, 8> indexValues;
    for (Value *indexValue : op->indices()) {
      indexValues.push_back(indexValue);
    }
    std::string fieldPath = fieldPathForGepOperands(
        op->getSourceElementType(), indexValues,
        debugTypeForValue(op->getPointerOperand()));
    if (!fieldPath.empty()) {
      taintFields.insert(fieldPath);
    }
  }
  collectTaintSummary(rawArgValue, pag, svfg, taintTypes, taintCalls,
                      taintUseSites, taintFields);
  if (taintFields.empty() && rawArgValue != argValue) {
    collectTaintSummary(argValue, pag, svfg, taintTypes, taintCalls,
                        taintUseSites, taintFields);
  }
  auto allFieldsUnknown = [&]() {
    if (taintFields.empty()) {
      return true;
    }
    for (const std::string &field : taintFields) {
      if (!StringRef(field).startswith("unknown__") &&
          !isGenericFieldPath(field)) {
        return false;
      }
    }
    return true;
  };
  if (allFieldsUnknown()) {
    taintFields.clear();
    addDebugFieldHintsForValue(rawArgValue, typeNames, taintFields);
    if (taintFields.empty() && rawArgValue != argValue) {
      addDebugFieldHintsForValue(argValue, typeNames, taintFields);
    }
  }

  if (argValue && LLVMModuleSet::getLLVMModuleSet()->hasValueNode(argValue)) {
    NodeID nodeId = LLVMModuleSet::getLLVMModuleSet()->getValueNode(argValue);
    const PointsTo &pts = pta->getPts(nodeId);
    for (PointsTo::iterator it = pts.begin(), ie = pts.end(); it != ie; ++it) {
      const SVFVar *target = pag->getGNode(*it);
      const Value *targetValue =
          LLVMModuleSet::getLLVMModuleSet()->getLLVMValue(target);
      addTypeInfoFromValue(targetValue, typeNames, valueNames);
    }
  }
  if (taintFields.empty() && !typeNames.empty()) {
    addSyntheticFieldsForTypes(typeNames, taintFields);
  }

  llvm::json::Array types;
  for (const auto &typeName : typeNames) {
    if (!typeName.empty() && typeName != "unknown") {
      types.push_back(typeName);
    }
  }
  record["points_to_types"] = std::move(types);

  llvm::json::Array values;
  for (const auto &valueName : valueNames) {
    if (!valueName.empty() && valueName != "unknown") {
      values.push_back(valueName);
    }
  }
  record["points_to_values"] = std::move(values);

  llvm::json::Array taintTypeArray;
  for (const auto &typeName : taintTypes) {
    if (!typeName.empty() && typeName != "unknown") {
      taintTypeArray.push_back(typeName);
    }
  }
  record["taint_types"] = std::move(taintTypeArray);

  llvm::json::Array taintCallArray;
  for (const auto &callName : taintCalls) {
    if (!callName.empty()) {
      taintCallArray.push_back(callName);
    }
  }
  record["taint_calls"] = std::move(taintCallArray);

  llvm::json::Array taintUseSiteArray;
  for (const auto &useSite : taintUseSites) {
    if (!useSite.empty()) {
      taintUseSiteArray.push_back(useSite);
    }
  }
  record["taint_use_sites"] = std::move(taintUseSiteArray);

  llvm::json::Array taintFieldArray;
  for (const auto &fieldName : taintFields) {
    if (!fieldName.empty() && fieldName != "unknown") {
      taintFieldArray.push_back(fieldName);
    }
  }
  record["taint_fields"] = std::move(taintFieldArray);
  return record;
}
#endif

}  // namespace

std::string buildPointsToHintKey(const std::string &callsite,
                                 const std::string &callee,
                                 int64_t argIndex) {
  return (StringRef(callsite) + "|" + callee + "|" + Twine(argIndex)).str();
}

SvfHints parsePointsToHintJson(const std::string &path) {
  SvfHints hints;
  if (path.empty()) {
    return hints;
  }

  ErrorOr<std::unique_ptr<MemoryBuffer>> buffer = MemoryBuffer::getFile(path);
  if (!buffer) {
    errs() << "error: failed to open points-to json " << path << ": "
           << buffer.getError().message() << "\n";
    return {};
  }

  Expected<llvm::json::Value> parsed = llvm::json::parse(buffer.get()->getBuffer());
  if (!parsed) {
    errs() << "error: failed to parse points-to json " << path << "\n";
    return {};
  }

  llvm::json::Object *root = parsed->getAsObject();
  if (!root) {
    return hints;
  }
  hints.root = *root;
  const llvm::json::Array *queries = root->getArray("queries");
  hints.typeHints = collectTypeHintsFromQueries(queries);
  hints.fieldHints = collectStringHintsFromQueries(queries, "taint_fields");
  hints.callHints = collectStringHintsFromQueries(queries, "taint_calls");
  hints.useSiteHints =
      collectStringHintsFromQueries(queries, "taint_use_sites");
  return hints;
}

bool writeSvfHintsJson(const std::string &path, const llvm::json::Object &root) {
  std::error_code ec;
  raw_fd_ostream out(path, ec);
  if (ec) {
    errs() << "error: failed to open " << path << ": " << ec.message() << "\n";
    return false;
  }
  llvm::json::Object copy(root);
  out << formatv("{0:2}", llvm::json::Value(std::move(copy)));
  out << "\n";
  return true;
}

bool collectSvfHints(const std::vector<std::string> &modulePaths,
                     const std::string &extapiPath, SvfHints &outHints,
                     std::string &errorMessage) {
#if !DEVILANG_HAVE_SVF
  (void)modulePaths;
  (void)extapiPath;
  errorMessage = "devilang built without SVF support";
  return false;
#else
  std::vector<std::string> moduleNameVec(modulePaths.begin(), modulePaths.end());
  if (!extapiPath.empty()) {
    ExtAPI::setExtBcPath(extapiPath);
  }

  LLVMModuleSet::preProcessBCs(moduleNameVec);
  LLVMModuleSet::buildSVFModule(moduleNameVec);

  SVFIRBuilder builder;
  SVFIR *pag = builder.build();
  Andersen *pta = AndersenWaveDiff::createAndersenWaveDiff(pag);
  SVFGBuilder svfgBuilder(true);
  SVFG *svfg = svfgBuilder.buildFullSVFG(static_cast<BVDataPTAImpl *>(pta));

  llvm::json::Array queries;
  for (const Module &moduleRef : LLVMModuleSet::getLLVMModuleSet()->getLLVMModules()) {
    for (const Function &func : moduleRef) {
      if (func.isDeclaration()) {
        continue;
      }
      for (const BasicBlock &bb : func) {
        for (const Instruction &inst : bb) {
          const auto *call = dyn_cast<CallInst>(&inst);
          if (!call) {
            continue;
          }
          const Function *callee = call->getCalledFunction();
          if (!callee) {
            continue;
          }
          auto it = kDefaultQueries.find(callee->getName().str());
          if (it == kDefaultQueries.end()) {
            continue;
          }
          if (call->arg_size() <= it->second) {
            continue;
          }
          queries.push_back(
              buildQueryRecord(&func, call, callee->getName(), it->second, pta, pag,
                               svfg));
        }
      }
    }
  }

  outHints.root["version"] = 1;
  outHints.root["producer"] = "devilang-svf";
  outHints.root["queries"] = std::move(queries);
  const llvm::json::Array *queryArray = outHints.root.getArray("queries");
  outHints.typeHints = collectTypeHintsFromQueries(queryArray);
  outHints.fieldHints = collectStringHintsFromQueries(queryArray, "taint_fields");
  outHints.callHints = collectStringHintsFromQueries(queryArray, "taint_calls");
  outHints.useSiteHints =
      collectStringHintsFromQueries(queryArray, "taint_use_sites");

  AndersenWaveDiff::releaseAndersenWaveDiff();
  SVFIR::releaseSVFIR();
  SVF::LLVMModuleSet::releaseLLVMModuleSet();
  return true;
#endif
}

}  // namespace devilang
