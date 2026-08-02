  static std::string normalizeTypeName(StringRef name) {
    std::string out = name.str();
    if (StringRef(out).startswith("struct.")) {
      out.erase(0, strlen("struct."));
    } else if (StringRef(out).startswith("union.")) {
      out.erase(0, strlen("union."));
    } else if (StringRef(out).startswith("class.")) {
      out.erase(0, strlen("class."));
    }
    return sanitizeToken(out);
  }

  static llvm::DIType *stripDebugType(llvm::DIType *type) {
    while (auto *derived = llvm::dyn_cast_or_null<llvm::DIDerivedType>(type)) {
      if (!derived->getBaseType()) {
        break;
      }
      type = derived->getBaseType();
    }
    return type;
  }

  static int debugTypeSpecificity(llvm::DIType *type) {
    type = stripDebugType(type);
    if (!type) {
      return 0;
    }
    int score = 1;
    if (auto *basic = llvm::dyn_cast<llvm::DIBasicType>(type)) {
      if (!basic->getName().empty()) {
        score += basic->getName() == "void" ? 1 : 30;
      }
      return score;
    }
    if (auto *composite = llvm::dyn_cast<llvm::DICompositeType>(type)) {
      if (!composite->getName().empty()) {
        score += 35;
      }
      if (composite->getTag() == llvm::dwarf::DW_TAG_array_type) {
        score += 5;
      }
      return score;
    }
    return score;
  }

  static llvm::DIType *debugTypeFromDbgIntrinsic(
      const llvm::DbgVariableIntrinsic *dbg) {
    if (!dbg) {
      return nullptr;
    }
    if (auto *var = dbg->getVariable()) {
      return var->getType();
    }
    return nullptr;
  }

  template <typename ConsiderFn>
  static void considerFunctionDebugTypesForValue(const Value *needle,
                                                 const Function *function,
                                                 ConsiderFn &&consider) {
    if (!needle || !function) {
      return;
    }
    for (const Instruction &inst : llvm::instructions(*function)) {
      if (const auto *dbgDecl = llvm::dyn_cast<llvm::DbgDeclareInst>(&inst)) {
        if (dbgDecl->getAddress() == needle) {
          consider(debugTypeFromDbgIntrinsic(dbgDecl));
        }
        continue;
      }
      if (const auto *dbgValue = llvm::dyn_cast<DbgValueInst>(&inst)) {
        if (dbgValue->getValue() == needle) {
          consider(debugTypeFromDbgIntrinsic(dbgValue));
        }
      }
    }
  }

  static llvm::DIType *debugTypeForValue(const Value *value) {
    llvm::SmallPtrSet<const Value *, 16> visited;
    llvm::DIType *bestType = nullptr;
    int bestScore = -1;
    auto consider = [&](llvm::DIType *type) {
      const int score = debugTypeSpecificity(type);
      if (score > bestScore) {
        bestType = type;
        bestScore = score;
      }
    };
    std::function<void(const Value *)> visit = [&](const Value *current) {
      if (!current || !visited.insert(current).second) {
        return;
      }
      if (const auto *arg = llvm::dyn_cast<llvm::Argument>(current)) {
        considerFunctionDebugTypesForValue(arg, arg->getParent(), consider);
      }
      if (const auto *inst = llvm::dyn_cast<Instruction>(current)) {
        considerFunctionDebugTypesForValue(current, inst->getFunction(), consider);
        for (const User *user : inst->users()) {
          if (const auto *dbgDecl = llvm::dyn_cast<llvm::DbgDeclareInst>(user)) {
            consider(debugTypeFromDbgIntrinsic(dbgDecl));
          }
          if (const auto *dbgValue = llvm::dyn_cast<DbgValueInst>(user)) {
            if (dbgValue->getValue() == current) {
              consider(debugTypeFromDbgIntrinsic(dbgValue));
            }
          }
          if (const auto *store = llvm::dyn_cast<StoreInst>(user)) {
            if (store->getValueOperand() == current) {
              visit(store->getPointerOperand());
            }
          }
        }
        if (const auto *load = llvm::dyn_cast<LoadInst>(inst)) {
          visit(load->getPointerOperand());
        }
        if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(inst)) {
          visit(gep->getPointerOperand());
        }
        if (inst->getOpcode() == llvm::Instruction::BitCast ||
            inst->getOpcode() == llvm::Instruction::AddrSpaceCast) {
          visit(inst->getOperand(0));
        }
      }
      if (const auto *ce = llvm::dyn_cast<llvm::ConstantExpr>(current)) {
        if (ce->isCast() || ce->getOpcode() == llvm::Instruction::GetElementPtr) {
          visit(ce->getOperand(0));
        }
      }
    };
    visit(value);
    return bestType;
  }

  static llvm::DIType *directDebugTypeForValue(const Value *value) {
    llvm::DIType *bestType = nullptr;
    int bestScore = -1;
    auto consider = [&](llvm::DIType *type) {
      const int score = debugTypeSpecificity(type);
      if (score > bestScore) {
        bestType = type;
        bestScore = score;
      }
    };

    if (const auto *arg = llvm::dyn_cast<llvm::Argument>(value)) {
      considerFunctionDebugTypesForValue(arg, arg->getParent(), consider);
      return bestType;
    }
    if (const auto *inst = llvm::dyn_cast<Instruction>(value)) {
      considerFunctionDebugTypesForValue(value, inst->getFunction(), consider);
      for (const User *user : inst->users()) {
        if (const auto *dbgDecl = llvm::dyn_cast<llvm::DbgDeclareInst>(user)) {
          consider(debugTypeFromDbgIntrinsic(dbgDecl));
        }
        if (const auto *dbgValue = llvm::dyn_cast<DbgValueInst>(user)) {
          if (dbgValue->getValue() == value) {
            consider(debugTypeFromDbgIntrinsic(dbgValue));
          }
        }
      }
    }
    return bestType;
  }

  static uint64_t debugTypeSizeBytes(llvm::DIType *type) {
    type = stripDebugType(type);
    if (!type) {
      return 0;
    }
    return type->getSizeInBits() / 8;
  }

  static void collectFieldPathFromDebugOffsetImpl(
      llvm::DIType *type,
      uint64_t offsetBytes,
      llvm::SmallVectorImpl<std::string> &parts,
      llvm::SmallPtrSetImpl<llvm::Metadata *> &visited,
      bool stopAtArray) {
    type = stripDebugType(type);
    if (!type || !visited.insert(type).second) {
      return;
    }
    if (auto *basic = llvm::dyn_cast<llvm::DIBasicType>(type)) {
      if (offsetBytes == 0) {
        parts.push_back("value");
      }
      return;
    }
    auto *composite = llvm::dyn_cast<llvm::DICompositeType>(type);
    if (!composite) {
      return;
    }
    if (composite->getTag() == llvm::dwarf::DW_TAG_array_type) {
      if (stopAtArray) {
        return;
      }
      const uint64_t elemSize = debugTypeSizeBytes(composite->getBaseType());
      uint64_t elemIndex = 0;
      if (elemSize != 0) {
        elemIndex = offsetBytes / elemSize;
        offsetBytes %= elemSize;
      }
      parts.push_back("elem_" + std::to_string(elemIndex));
      collectFieldPathFromDebugOffsetImpl(composite->getBaseType(), offsetBytes,
                                          parts, visited, stopAtArray);
      return;
    }

    llvm::SmallVector<const llvm::DIDerivedType *, 8> members;
    for (llvm::Metadata *md : composite->getElements()) {
      if (const auto *member = llvm::dyn_cast<llvm::DIDerivedType>(md)) {
        members.push_back(member);
      }
    }
    llvm::SmallVector<std::string, 8> bestCandidate;
    int bestScore = -1;
    for (const llvm::DIDerivedType *member : members) {
      const uint64_t memberOffset = member->getOffsetInBits() / 8;
      uint64_t memberSize = debugTypeSizeBytes(member->getBaseType());
      if (memberSize == 0) {
        memberSize = offsetBytes >= memberOffset ? (offsetBytes - memberOffset) + 1 : 0;
      }
      const bool contains =
          composite->getTag() == llvm::dwarf::DW_TAG_union_type
              ? true
              : (offsetBytes >= memberOffset &&
                 (memberSize == 0 || offsetBytes < memberOffset + memberSize));
      if (!contains) {
        continue;
      }
      llvm::SmallVector<std::string, 8> candidate;
      std::string fieldName = sanitizeToken(member->getName());
      if (!fieldName.empty() && fieldName != "unknown") {
        candidate.push_back(fieldName);
      }
      const size_t beforeRecurse = candidate.size();
      collectFieldPathFromDebugOffsetImpl(
          member->getBaseType(),
          offsetBytes >= memberOffset ? offsetBytes - memberOffset : offsetBytes,
          candidate, visited, stopAtArray);
      const int recurseScore = static_cast<int>(candidate.size() - beforeRecurse);
      const int emptyPenalty =
          (!fieldName.empty() && StringRef(fieldName).startswith("__empty")) ? 5 : 0;
      const int exactStartBonus = offsetBytes == memberOffset ? 100 : 0;
      const int score =
          static_cast<int>(candidate.size()) * 10 + recurseScore +
          exactStartBonus - emptyPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate.assign(candidate.begin(), candidate.end());
      }
    }
    if (bestScore >= 0) {
      parts.append(bestCandidate.begin(), bestCandidate.end());
    }
  }

  static void collectFieldPathFromDebugOffset(
      llvm::DIType *type,
      uint64_t offsetBytes,
      llvm::SmallVectorImpl<std::string> &parts,
      bool stopAtArray = true) {
    llvm::SmallPtrSet<llvm::Metadata *, 16> visited;
    collectFieldPathFromDebugOffsetImpl(type, offsetBytes, parts, visited,
                                        stopAtArray);
  }

  llvm::DIType *findNamedDebugType(StringRef targetName) {
    const std::string wanted = sanitizeToken(targetName);
    if (wanted.empty()) {
      return nullptr;
    }
    auto matchesWanted = [&](StringRef rawName) {
      const std::string token = sanitizeToken(rawName);
      if (token == wanted) {
        return true;
      }
      for (StringRef prefix : {"struct_", "union_", "class_"}) {
        if (StringRef(token).startswith(prefix) &&
            StringRef(token).substr(prefix.size()) == wanted) {
          return true;
        }
      }
      return StringRef(token).endswith("_" + wanted);
    };
    llvm::SmallVector<llvm::Metadata *, 64> worklist;
    llvm::SmallPtrSet<llvm::Metadata *, 32> visited;
    for (llvm::DICompileUnit *compileUnit : module_.debug_compile_units()) {
      if (!compileUnit) {
        continue;
      }
      worklist.push_back(compileUnit);
      for (llvm::Metadata *type : compileUnit->getRetainedTypes()) {
        if (type) {
          worklist.push_back(type);
        }
      }
      for (llvm::Metadata *global : compileUnit->getGlobalVariables()) {
        if (global) {
          worklist.push_back(global);
        }
      }
    }
    while (!worklist.empty()) {
      llvm::Metadata *metadata = worklist.pop_back_val();
      if (!metadata || !visited.insert(metadata).second) {
        continue;
      }
      if (auto *type = llvm::dyn_cast<llvm::DIType>(metadata)) {
        if (matchesWanted(type->getName())) {
          return type;
        }
        if (auto *derived = llvm::dyn_cast<llvm::DIDerivedType>(type)) {
          if (derived->getBaseType()) {
            worklist.push_back(derived->getBaseType());
          }
        } else if (auto *composite = llvm::dyn_cast<llvm::DICompositeType>(type)) {
          if (composite->getBaseType()) {
            worklist.push_back(composite->getBaseType());
          }
          for (llvm::Metadata *element : composite->getElements()) {
            if (element) {
              worklist.push_back(element);
            }
          }
        }
        continue;
      }
      if (auto *compileUnit = llvm::dyn_cast<llvm::DICompileUnit>(metadata)) {
        for (llvm::Metadata *type : compileUnit->getRetainedTypes()) {
          if (type) {
            worklist.push_back(type);
          }
        }
        for (llvm::Metadata *global : compileUnit->getGlobalVariables()) {
          if (global) {
            worklist.push_back(global);
          }
        }
        continue;
      }
      if (auto *globalExpr =
              llvm::dyn_cast<llvm::DIGlobalVariableExpression>(metadata)) {
        if (auto *global = globalExpr->getVariable()) {
          if (global->getType()) {
            worklist.push_back(global->getType());
          }
        }
        continue;
      }
      if (auto *subprogram = llvm::dyn_cast<llvm::DISubprogram>(metadata)) {
        if (subprogram->getType()) {
          worklist.push_back(subprogram->getType());
        }
      }
    }
    return nullptr;
  }

  static std::string schemaFieldTypeNameForByteWidth(uint64_t size) {
    switch (size) {
      case 1:
        return "u8";
      case 2:
        return "u16";
      case 4:
        return "u32";
      case 8:
        return "u64";
      default:
        return "bytes[" + std::to_string(size) + "]";
    }
  }

  static void collectArrayCountBounds(llvm::DICompositeType *arrayType,
                                      uint64_t &countOut) {
    if (!arrayType) {
      return;
    }
    for (llvm::Metadata *element : arrayType->getElements()) {
      const auto *subrange = llvm::dyn_cast<llvm::DISubrange>(element);
      if (!subrange) {
        continue;
      }
      auto count = subrange->getCount();
      if (const auto *countNode = count.dyn_cast<llvm::ConstantInt *>()) {
        countOut = countNode->getZExtValue();
        return;
      }
    }
  }

  static bool describeDebugFieldAtOffsetImpl(
      llvm::DIType *type,
      uint64_t offsetBytes,
      uint64_t baseOffset,
      DebugFieldDescriptor &out,
      llvm::SmallVectorImpl<std::string> &path,
      llvm::SmallPtrSetImpl<llvm::Metadata *> &visited) {
    type = stripDebugType(type);
    if (!type || !visited.insert(type).second) {
      return false;
    }
    if (auto *basic = llvm::dyn_cast<llvm::DIBasicType>(type)) {
      out.leafType = basic;
      out.fieldOffset = baseOffset;
      out.fieldSize = debugTypeSizeBytes(basic);
      out.path.assign(path.begin(), path.end());
      return true;
    }
    auto *composite = llvm::dyn_cast<llvm::DICompositeType>(type);
    if (!composite) {
      return false;
    }
    if (composite->getTag() == llvm::dwarf::DW_TAG_array_type) {
      const uint64_t elemSize = debugTypeSizeBytes(composite->getBaseType());
      uint64_t elemIndex = 0;
      if (elemSize != 0) {
        elemIndex = offsetBytes / elemSize;
        offsetBytes %= elemSize;
      }
      path.push_back("elem_" + std::to_string(elemIndex));
      out.fieldIsArray = true;
      out.fieldOffset = baseOffset;
      out.elementOffset = elemIndex * elemSize;
      out.elementSize = elemSize;
      collectArrayCountBounds(composite, out.elementCount);
      const bool ok = describeDebugFieldAtOffsetImpl(
          composite->getBaseType(), offsetBytes, baseOffset + out.elementOffset,
          out, path, visited);
      path.pop_back();
      return ok;
    }
    llvm::SmallVector<const llvm::DIDerivedType *, 8> members;
    for (llvm::Metadata *metadata : composite->getElements()) {
      if (const auto *member = llvm::dyn_cast<llvm::DIDerivedType>(metadata)) {
        members.push_back(member);
      }
    }
    for (const llvm::DIDerivedType *member : members) {
      const uint64_t memberOffset = member->getOffsetInBits() / 8;
      uint64_t memberSize = debugTypeSizeBytes(member->getBaseType());
      if (memberSize == 0) {
        memberSize = offsetBytes >= memberOffset ? (offsetBytes - memberOffset) + 1 : 0;
      }
      const bool contains =
          composite->getTag() == llvm::dwarf::DW_TAG_union_type
              ? true
              : (offsetBytes >= memberOffset &&
                 (memberSize == 0 || offsetBytes < memberOffset + memberSize));
      if (!contains) {
        continue;
      }
      const std::string fieldName = sanitizeToken(member->getName());
      const bool appended = !fieldName.empty() && fieldName != "unknown" &&
                            !StringRef(fieldName).startswith("__empty");
      if (appended) {
        path.push_back(fieldName);
      }
      if (describeDebugFieldAtOffsetImpl(
              member->getBaseType(),
              offsetBytes >= memberOffset ? offsetBytes - memberOffset : offsetBytes,
              baseOffset + memberOffset,
              out,
              path,
              visited)) {
        return true;
      }
      if (appended) {
        path.pop_back();
      }
    }
    return false;
  }

  std::optional<DebugFieldDescriptor> describeDebugFieldAtOffset(
      llvm::DIType *type,
      uint64_t offsetBytes) {
    DebugFieldDescriptor out;
    llvm::SmallVector<std::string, 8> path;
    llvm::SmallPtrSet<llvm::Metadata *, 32> visited;
    if (!describeDebugFieldAtOffsetImpl(type, offsetBytes, 0, out, path, visited)) {
      return std::nullopt;
    }
    if (!out.fieldIsArray) {
      out.elementOffset = 0;
      out.elementSize = out.fieldSize;
      out.elementCount = out.fieldSize != 0 ? 1 : 0;
    }
    if (out.path.empty()) {
      out.path.assign(path.begin(), path.end());
    }
    if (out.fieldSize == 0 && out.elementSize != 0) {
      out.fieldSize = out.elementSize;
    }
    return out;
  }

  static void appendUniqueField(std::vector<std::string> &out,
                                std::set<std::string> &seen,
                                StringRef field) {
    const std::string token = sanitizeToken(field);
    if (token.empty() || token == "unknown") {
      return;
    }
    if (seen.insert(token).second) {
      out.push_back(token);
    }
  }

  static void collectLeafFieldPathsFromDebugType(
      llvm::DIType *type,
      llvm::SmallVectorImpl<std::string> &prefix,
      std::vector<std::string> &out,
      std::set<std::string> &seen,
      unsigned depth = 0) {
    type = stripDebugType(type);
    if (!type || depth > 8) {
      return;
    }
    if (llvm::isa<llvm::DIBasicType>(type)) {
      if (prefix.empty()) {
        return;
      }
      std::string joined;
      for (size_t i = 0; i < prefix.size(); ++i) {
        if (i != 0) {
          joined += "__";
        }
        joined += sanitizeToken(prefix[i]);
      }
      appendUniqueField(out, seen, joined);
      return;
    }
    auto *composite = llvm::dyn_cast<llvm::DICompositeType>(type);
    if (!composite) {
      return;
    }
    if (composite->getTag() == llvm::dwarf::DW_TAG_array_type) {
      if (prefix.empty()) {
        return;
      }
      std::string joined;
      for (size_t i = 0; i < prefix.size(); ++i) {
        if (i != 0) {
          joined += "__";
        }
        joined += sanitizeToken(prefix[i]);
      }
      appendUniqueField(out, seen, joined);
      return;
    }

    bool emittedMember = false;
    for (llvm::Metadata *md : composite->getElements()) {
      const auto *member = llvm::dyn_cast<llvm::DIDerivedType>(md);
      if (!member || !member->getBaseType()) {
        continue;
      }
      std::string fieldName = sanitizeToken(member->getName());
      if (fieldName.empty() || fieldName == "unknown" ||
          StringRef(fieldName).startswith("__empty")) {
        continue;
      }
      prefix.push_back(fieldName);
      collectLeafFieldPathsFromDebugType(member->getBaseType(), prefix, out, seen,
                                         depth + 1);
      prefix.pop_back();
      emittedMember = true;
    }
    if (!emittedMember && !prefix.empty()) {
      std::string joined;
      for (size_t i = 0; i < prefix.size(); ++i) {
        if (i != 0) {
          joined += "__";
        }
        joined += sanitizeToken(prefix[i]);
      }
      appendUniqueField(out, seen, joined);
    }
  }

  struct DebugPointerInfo {
    llvm::DIType *type = nullptr;
    uint64_t constantOffset = 0;
  };

  static bool accumulateDebugPointerInfo(const Value *value,
                                         DebugPointerInfo &info) {
    if (!value) {
      return false;
    }
    if (llvm::DIType *type = debugTypeForValue(value)) {
      info.type = type;
    }

    if (const auto *inst = llvm::dyn_cast<Instruction>(value)) {
      if (const auto *load = llvm::dyn_cast<LoadInst>(inst)) {
        return accumulateDebugPointerInfo(load->getPointerOperand(), info);
      }
      if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(inst)) {
        if (!accumulateDebugPointerInfo(gep->getPointerOperand(), info)) {
          info.type = info.type ? info.type : debugTypeForValue(gep->getPointerOperand());
        }
        if (!gep->getSourceElementType()->isSized()) {
          return info.type != nullptr;
        }
        const DataLayout &dl = gep->getModule()->getDataLayout();
        Type *currentType = gep->getSourceElementType();
        bool firstIndex = true;
        for (Value *indexValue : gep->indices()) {
          const auto *ci = llvm::dyn_cast<ConstantInt>(indexValue);
          if (!ci) {
            return info.type != nullptr;
          }
          int64_t idx = ci->getSExtValue();
          if (firstIndex) {
            firstIndex = false;
            if (!llvm::isa<llvm::StructType>(currentType)) {
              info.constantOffset += static_cast<uint64_t>(std::max<int64_t>(0, idx)) *
                                     dl.getTypeAllocSize(currentType);
              continue;
            }
          }
          if (auto *structTy = llvm::dyn_cast<llvm::StructType>(currentType)) {
            if (idx < 0 || static_cast<unsigned>(idx) >= structTy->getNumElements()) {
              return info.type != nullptr;
            }
            const llvm::StructLayout *layout = dl.getStructLayout(structTy);
            info.constantOffset += layout->getElementOffset(idx);
            currentType = structTy->getElementType(idx);
            continue;
          }
          if (auto *arrayTy = llvm::dyn_cast<llvm::ArrayType>(currentType)) {
            info.constantOffset += static_cast<uint64_t>(std::max<int64_t>(0, idx)) *
                                   dl.getTypeAllocSize(arrayTy->getElementType());
            currentType = arrayTy->getElementType();
            continue;
          }
          if (auto *ptrTy = llvm::dyn_cast<llvm::PointerType>(currentType)) {
            Type *elemTy = ptrTy->getNonOpaquePointerElementType();
            info.constantOffset += static_cast<uint64_t>(std::max<int64_t>(0, idx)) *
                                   dl.getTypeAllocSize(elemTy);
            currentType = elemTy;
            continue;
          }
          return info.type != nullptr;
        }
        return info.type != nullptr;
      }
      if (inst->getOpcode() == llvm::Instruction::BitCast ||
          inst->getOpcode() == llvm::Instruction::AddrSpaceCast) {
        return accumulateDebugPointerInfo(inst->getOperand(0), info);
      }
    }
    if (const auto *ce = llvm::dyn_cast<llvm::ConstantExpr>(value)) {
      if (ce->isCast()) {
        return accumulateDebugPointerInfo(ce->getOperand(0), info);
      }
    }
    return info.type != nullptr;
  }

  static std::string debugFieldRootNeedleForValue(const Value *value) {
    DebugPointerInfo info;
    if (!accumulateDebugPointerInfo(value, info) || !info.type) {
      return "";
    }
    llvm::SmallVector<std::string, 8> parts;
    collectFieldPathFromDebugOffset(info.type, info.constantOffset, parts);
    if (parts.empty()) {
      return "";
    }
    for (const std::string &part : parts) {
      const std::string token = sanitizeToken(part);
      if (!token.empty() && token != "value" && token != "elem_0") {
        return token;
      }
    }
    return sanitizeToken(parts.front());
  }

  static Type *constantGepLeafType(const GetElementPtrInst &gep) {
    Type *currentType = gep.getSourceElementType();
    bool firstIndex = true;
    for (Value *indexValue : gep.indices()) {
      const auto *ci = llvm::dyn_cast<ConstantInt>(indexValue);
      if (!ci || !currentType) {
        return nullptr;
      }
      int64_t idx = ci->getSExtValue();
      if (firstIndex) {
        firstIndex = false;
        if (llvm::isa<llvm::StructType>(currentType)) {
          continue;
        }
        if (auto *arrayTy = llvm::dyn_cast<llvm::ArrayType>(currentType)) {
          currentType = arrayTy->getElementType();
        }
        continue;
      }
      if (auto *structTy = llvm::dyn_cast<llvm::StructType>(currentType)) {
        if (idx < 0 || static_cast<unsigned>(idx) >= structTy->getNumElements()) {
          return nullptr;
        }
        currentType = structTy->getElementType(idx);
        continue;
      }
      if (auto *arrayTy = llvm::dyn_cast<llvm::ArrayType>(currentType)) {
        currentType = arrayTy->getElementType();
        continue;
      }
      if (auto *ptrTy = llvm::dyn_cast<llvm::PointerType>(currentType)) {
        currentType = ptrTy->getNonOpaquePointerElementType();
        continue;
      }
      return currentType;
    }
    return currentType;
  }

  std::optional<std::string> renderDebugFieldAccess(const GetElementPtrInst &gep,
                                                    StringRef base) {
    if (base.empty() || base == "unknown" ||
        gep.getSourceElementType()->isIntegerTy(8)) {
      return std::nullopt;
    }
    Type *leafType = constantGepLeafType(gep);
    if (!leafType || leafType->isPointerTy()) {
      return std::nullopt;
    }
    llvm::APInt offset(module_.getDataLayout().getPointerSizeInBits(
                           gep.getPointerAddressSpace()),
                       0, true);
    if (!gep.accumulateConstantOffset(module_.getDataLayout(), offset) ||
        offset.isNegative()) {
      return std::nullopt;
    }
    llvm::DIType *debugType = directDebugTypeForValue(gep.getPointerOperand());
    if (!debugType) {
      return std::nullopt;
    }
    llvm::SmallVector<std::string, 8> parts;
    collectFieldPathFromDebugOffset(debugType, offset.getZExtValue(), parts);
    std::string rendered = base.str();
    bool appended = false;
    for (const std::string &part : parts) {
      const std::string token = sanitizeToken(part);
      if (token.empty() || token == "unknown" || token == "value" ||
          token == "elem_0") {
        continue;
      }
      rendered += "." + token;
      appended = true;
    }
    if (!appended) {
      return std::nullopt;
    }
    return rendered;
  }

  static bool isLowSignalTypeToken(StringRef name) {
    if (name.empty() || name == "addr" || name == "len" || name == "sg" ||
        name == "buf" || name == "data" || name == "page" ||
        name == "value" || name == "ptr" || name == "tmp" ||
        name == "map_addr" || name == "cpu_addr" || name == "unknown" ||
        name == "unnamed") {
      return true;
    }
    if (name.startswith("_") && !name.startswith("__virtio")) {
      return true;
    }
    if (name.size() == 1 && llvm::isAlpha(name.front())) {
      return true;
    }
    if (name.consume_front("call")) {
      return !name.empty() &&
             llvm::all_of(name, [](char ch) { return llvm::isDigit(ch); });
    }
    return false;
  }

  static std::string canonicalizePayloadTypeName(StringRef typeName) {
    const std::string token = sanitizeToken(typeName);
    if (token == "unnamed") {
      return "unknown";
    }
    if (token == "stats_cap") {
      return "virtio_net_stats_capabilities";
    }
    if (token == "virtio_net_stats_reply" ||
        token == "virtio_net_stats_reply_hdr") {
      return "virtio_net_stats_reply_hdr";
    }
    if (token == "net_device") {
      return "virtio_net_ctrl_mac_addr";
    }
    if (token == "coal_tx") {
      return "virtio_net_ctrl_coal_tx";
    }
    if (token == "coal_rx") {
      return "virtio_net_ctrl_coal_rx";
    }
    if (token == "coal_vq") {
      return "virtio_net_ctrl_coal_vq";
    }
    if (token == "__virtio64") {
      return "virtio_net_guest_offloads";
    }
    if (token == "__virtio16") {
      return "virtio_net_ctrl_vlan";
    }
    return token;
  }

  static bool isWeakPayloadType(StringRef typeName) {
    const std::string token = canonicalizePayloadTypeName(typeName);
    return token.empty() || token == "unknown" || token == "scatterlist" ||
           token == "control_buf" || token == "virtnet_info";
  }

  std::string guessTypeNameFromLLVMType(const llvm::Type *type) {
    const llvm::Type *current = type;
    llvm::SmallPtrSet<const llvm::Type *, 8> visited;
    while (current && visited.insert(current).second) {
      if (const auto *ptr = llvm::dyn_cast<llvm::PointerType>(current)) {
        current = ptr->getNonOpaquePointerElementType();
        continue;
      }
      if (const auto *array = llvm::dyn_cast<llvm::ArrayType>(current)) {
        current = array->getElementType();
        continue;
      }
      if (const auto *structTy = llvm::dyn_cast<llvm::StructType>(current)) {
        if (structTy->hasName()) {
          return normalizeTypeName(structTy->getName());
        }
        break;
      }
      break;
    }
    return "";
  }

  std::string guessTypeNameFromValue(const Value *value, unsigned depth = 0) {
    if (!value || depth > 6) {
      return "";
    }
    if (const auto *instruction = llvm::dyn_cast<Instruction>(value)) {
      if (const auto *allocaInst = llvm::dyn_cast<llvm::AllocaInst>(instruction)) {
        return guessTypeNameFromLLVMType(allocaInst->getAllocatedType());
      }
      if (const auto *gep = llvm::dyn_cast<llvm::GetElementPtrInst>(instruction)) {
        std::string fromSource = guessTypeNameFromLLVMType(gep->getSourceElementType());
        if (!fromSource.empty()) {
          return fromSource;
        }
        return guessTypeNameFromValue(gep->getPointerOperand(), depth + 1);
      }
      if (const auto *load = llvm::dyn_cast<LoadInst>(instruction)) {
        std::string fromLoad = guessTypeNameFromLLVMType(load->getType());
        if (!fromLoad.empty()) {
          return fromLoad;
        }
        return guessTypeNameFromValue(load->getPointerOperand(), depth + 1);
      }
      if (const auto *phi = llvm::dyn_cast<PHINode>(instruction)) {
        std::string agreed;
        for (const Value *incoming : phi->incoming_values()) {
          std::string candidate = guessTypeNameFromValue(incoming, depth + 1);
          if (candidate.empty()) {
            continue;
          }
          if (agreed.empty()) {
            agreed = candidate;
            continue;
          }
          if (agreed != candidate) {
            return "";
          }
        }
        return agreed;
      }
      if (const auto *select = llvm::dyn_cast<llvm::SelectInst>(instruction)) {
        std::string trueType =
            guessTypeNameFromValue(select->getTrueValue(), depth + 1);
        std::string falseType =
            guessTypeNameFromValue(select->getFalseValue(), depth + 1);
        if (!trueType.empty() && trueType == falseType) {
          return trueType;
        }
      }
      if (const auto *call = llvm::dyn_cast<CallBase>(instruction)) {
        if (const Function *callee =
                llvm::dyn_cast<Function>(call->getCalledOperand()->stripPointerCasts())) {
          std::string calleeName = sanitizeToken(callee->getName());
          if (calleeName.find("virtio_net_hdr") != std::string::npos ||
              calleeName.find("virtnet_hdr") != std::string::npos) {
            return "virtio_net_hdr";
          }
        }
      }
    }

    if (const auto *global = llvm::dyn_cast<llvm::GlobalValue>(value)) {
      std::string globalType = guessTypeNameFromLLVMType(global->getValueType());
      if (!globalType.empty()) {
        return globalType;
      }
    }

    std::string directType = guessTypeNameFromLLVMType(value->getType());
    if (!directType.empty()) {
      return directType;
    }

    if (value->hasName()) {
      const std::string token = sanitizeToken(value->getName());
      if (!isLowSignalTypeToken(token)) {
        return token;
      }
    }
    auto it = valueNames_.find(value);
    if (it != valueNames_.end()) {
      const std::string token = sanitizeToken(it->second);
      if (!isLowSignalTypeToken(token)) {
        return token;
      }
    }
    return "";
  }

  std::vector<std::string> collectCanonicalFieldsFromDebugType(
      llvm::DIType *type,
      StringRef canonicalType) {
    std::vector<std::string> out;
    std::set<std::string> seen;
    llvm::SmallVector<std::string, 8> prefix;
    const std::string root = sanitizeToken(canonicalType);
    if (root.empty()) {
      return out;
    }
    prefix.push_back(root);
    collectLeafFieldPathsFromDebugType(type, prefix, out, seen);
    return out;
  }

  std::vector<std::string> collectCanonicalFieldsFromValueType(
      const Value *value,
      StringRef canonicalType) {
    const std::string root = sanitizeToken(canonicalType);
    if (root.empty()) {
      return {};
    }
    if (llvm::DIType *debugType = debugTypeForValue(value)) {
      std::vector<std::string> fields =
          collectCanonicalFieldsFromDebugType(debugType, root);
      if (!fields.empty()) {
        return fields;
      }
    }
    return {};
  }

  void appendMissingCanonicalFields(std::vector<std::string> &fields,
                                    const std::vector<std::string> &extra) {
    std::set<std::string> seen(fields.begin(), fields.end());
    for (const std::string &field : extra) {
      const std::string token = sanitizeToken(field);
      if (token.empty() || token == "unknown") {
        continue;
      }
      if (seen.insert(token).second) {
        fields.push_back(token);
      }
    }
  }

  std::string classifyPayloadKind(StringRef typeName, StringRef fallbackName,
                                  const Function *caller) {
    const std::string merged =
        sanitizeToken(typeName).append("_").append(sanitizeToken(fallbackName));
    StringRef tokens(merged);
    if (tokens.contains("virtio_net_hdr") || tokens.contains("virtnet_hdr") ||
        tokens.contains("virtiohdr")) {
      return "virtio_net_hdr";
    }
    if (tokens.contains("vring_desc") || tokens.contains("virtq_desc") ||
        tokens.contains("vring_packed_desc")) {
      return "virtq_desc_table";
    }
    if (tokens.contains("zero") || tokens.contains("zerobuf")) {
      return "zero_buffer";
    }
    if (tokens.contains("skb") || tokens.contains("xdp") ||
        tokens.contains("xsk") || tokens.contains("frame") ||
        tokens.contains("packet") || tokens.contains("data") ||
        tokens.contains("page")) {
      return "ethernet_frame";
    }
    if (caller) {
      StringRef callerName = caller->getName();
      if (callerName.contains("xmit") || callerName.contains("recv") ||
          callerName.contains("refill") || callerName.contains("poll") ||
          callerName.contains("buf")) {
        return "ethernet_frame";
      }
    }
    return "sg_buffer";
  }

  static std::string canonicalizeFieldHintToken(StringRef field) {
    std::string token = sanitizeToken(field);
    if (token.empty() || token == "unknown") {
      return "";
    }
    if (token == "virtio_net_hdr__hash_hdr__hdr__unnamed__unnamed__csum_start" ||
        token == "virtio_net_hdr__hash_hdr__hdr__unnamed__csum__start") {
      return "virtio_net_hdr_v1_hash_tunnel__csum_start";
    }
    if (token ==
            "virtio_net_hdr__hash_hdr__hdr__unnamed__unnamed__csum_offset" ||
        token == "virtio_net_hdr__hash_hdr__hdr__unnamed__csum__offset") {
      return "virtio_net_hdr_v1_hash_tunnel__csum_offset";
    }
    if (token == "virtio_net_hdr__hash_hdr__hdr__unnamed__rsc__segments" ||
        token == "virtio_net_hdr__hash_hdr__hdr__unnamed__rsc__dup_acks") {
      return "";
    }
    if (token == "vring_desc_extra__id") {
      return "vring_desc_extra__next";
    }
    if (token == "virtio_net_ctrl_queue_stats__stats" ||
        token == "virtio_net_ctrl_queue_stats__stats__elem_0") {
      return "";
    }
    if (token == "virtio_net_ctrl_queue_stats__stats__elem_0__vq_index") {
      return "virtio_net_ctrl_queue_stats__vq_index";
    }
    if (token ==
        "virtio_net_ctrl_queue_stats__stats__elem_0__vq_index__value") {
      return "virtio_net_ctrl_queue_stats__vq_index__value";
    }
    if (token == "virtio_net_ctrl_queue_stats__stats__elem_0__reserved") {
      return "virtio_net_ctrl_queue_stats__reserved";
    }
    if (token ==
        "virtio_net_ctrl_queue_stats__stats__elem_0__reserved__elem_0") {
      return "virtio_net_ctrl_queue_stats__reserved__elem_0";
    }
    if (token == "virtio_net_ctrl_queue_stats__stats__elem_0__types_bitmap") {
      return "virtio_net_ctrl_queue_stats__types_bitmap";
    }
    if (token ==
        "virtio_net_ctrl_queue_stats__stats__elem_0__types_bitmap__elem_0") {
      return "virtio_net_ctrl_queue_stats__types_bitmap__value";
    }
    if (token ==
        "virtio_net_stats_capabilities__supported_stats_types__elem_0") {
      return "virtio_net_stats_capabilities__supported_stats_types__value";
    }
    if (token ==
        "virtio_net_stats_capabilities__supported_stats_types__elem_0__value") {
      return "virtio_net_stats_capabilities__supported_stats_types__value";
    }
    if (token == "virtio_net_rss_config_hdr__indirection_table__elem_0" ||
        token ==
            "virtio_net_rss_config_hdr__indirection_table__elem_0__value") {
      return "";
    }
    if (token == "virtio_net_ctrl_queue_stats__reserved__elem_0") {
      return "";
    }
    if (token == "virtio_net_ctrl_coal_vq__coal") {
      return "";
    }
    if (token == "virtio_net_ctrl_coal_vq__coal__max_packets") {
      return "virtio_net_ctrl_coal_vq__max_packets";
    }
    if (token == "virtio_net_ctrl_coal_vq__coal__max_packets__value") {
      return "virtio_net_ctrl_coal_vq__max_packets__value";
    }
    if (token == "virtio_net_ctrl_coal_vq__coal__max_usecs") {
      return "virtio_net_ctrl_coal_vq__max_usecs";
    }
    if (token == "virtio_net_ctrl_coal_vq__coal__max_usecs__value") {
      return "virtio_net_ctrl_coal_vq__max_usecs__value";
    }
    if (StringRef(token).startswith("virtio_net_hdr__hash_hdr__hdr__")) {
      return "virtio_net_hdr_v1_hash_tunnel__" +
             token.substr(strlen("virtio_net_hdr__hash_hdr__hdr__"));
    }
    if (StringRef(token).startswith("virtio_net_hdr__hash_hdr__")) {
      return "virtio_net_hdr_v1_hash_tunnel__" +
             token.substr(strlen("virtio_net_hdr__hash_hdr__"));
    }
    if (StringRef(token).startswith("virtio_net_hdr_v1_hash_tunnel__hash_hdr__hdr__")) {
      return "virtio_net_hdr_v1_hash_tunnel__" +
             token.substr(
                 strlen("virtio_net_hdr_v1_hash_tunnel__hash_hdr__hdr__"));
    }
    if (StringRef(token).startswith("virtio_net_hdr_v1_hash_tunnel__hash_hdr__")) {
      return "virtio_net_hdr_v1_hash_tunnel__" +
             token.substr(strlen("virtio_net_hdr_v1_hash_tunnel__hash_hdr__"));
    }
    if (StringRef(token).startswith("virtio_net_hdr_mrg_rxbuf__hdr__")) {
      return "virtio_net_hdr_mrg_rxbuf__" +
             token.substr(strlen("virtio_net_hdr_mrg_rxbuf__hdr__"));
    }
    if (StringRef(token).startswith("virtio_net_hdr__outer_th_offset")) {
      return "virtio_net_hdr_v1_hash_tunnel__outer_th_offset";
    }
    if (StringRef(token).startswith("virtio_net_hdr__inner_nh_offset")) {
      return "virtio_net_hdr_v1_hash_tunnel__inner_nh_offset";
    }
    return token;
  }

  std::vector<std::string> normalizeFieldHints(
      const std::vector<std::string> &fields) {
    constexpr size_t kMaxRawFieldHintsScanned = 2048;
    constexpr size_t kMaxNormalizedFieldHints = 256;
    std::vector<std::string> normalized;
    std::set<std::string> seen;
    size_t scanned = 0;
    for (const std::string &field : fields) {
      // Field hints are best-effort enrichment.
      // Large points-to alias sets can otherwise dominate model generation.
      if (scanned++ >= kMaxRawFieldHintsScanned ||
          normalized.size() >= kMaxNormalizedFieldHints) {
        break;
      }
      std::string token = canonicalizeFieldHintToken(field);
      if (token.empty()) {
        continue;
      }
      if (seen.insert(token).second) {
        normalized.push_back(std::move(token));
      }
    }
    return normalized;
  }

  static std::string trimTrailingDigits(StringRef token) {
    size_t end = token.size();
    while (end > 0 && std::isdigit(static_cast<unsigned char>(token[end - 1]))) {
      --end;
    }
    return sanitizeToken(token.substr(0, end));
  }

  static bool isLowSignalLocalName(StringRef rawName) {
    const std::string token = sanitizeToken(rawName);
    if (token.empty()) {
      return true;
    }
    const std::string stem = trimTrailingDigits(token);
    return stem == "call" || stem == "ret" || stem == "tmp" ||
           stem == "data" || stem == "value" || stem == "val" ||
           stem == "res" || stem == "result";
  }

  std::optional<std::string> preferredCallResultName(
      const CallBase &call,
      const Function *resolvedCallee = nullptr) {
    const Function *callee = resolvedCallee;
    std::string calleeName;
    if (!callee) {
      callee = llvm::dyn_cast<Function>(
          call.getCalledOperand()->stripPointerCasts());
    }
    if (callee) {
      if (isReadLeaf(callee->getName()) || isWriteLeaf(callee->getName()) ||
          isSgFunction(callee->getName())) {
        return std::nullopt;
      }
      calleeName = sanitizeToken(callee->getName());
    } else if (auto pointerName = inferPointerName(call.getCalledOperand())) {
      calleeName = sanitizeToken(*pointerName);
    }
    if (calleeName.empty()) {
      return std::nullopt;
    }
    const auto synthesize = [&](StringRef suffix) -> std::string {
      const std::string token = sanitizeToken(suffix);
      if (token.empty()) {
        return calleeName + "_ret";
      }
      return calleeName + "_" + token;
    };

    if (auto it = valueNames_.find(&call); it != valueNames_.end()) {
      if (!isLowSignalLocalName(it->second)) {
        return std::nullopt;
      }
      if (call.hasName()) {
        const std::string callName = sanitizeToken(call.getName());
        if (!callName.empty() && isLowSignalLocalName(callName)) {
          return synthesize(callName);
        }
      }
      return synthesize(it->second);
    }

    if (call.hasName()) {
      const std::string callName = sanitizeToken(call.getName());
      if (!callName.empty() && isLowSignalLocalName(callName)) {
        return synthesize(callName);
      }
    }

    return std::nullopt;
  }

  std::string sourceFieldNeedle(const Value *value) {
    if (std::string debugNeedle = debugFieldRootNeedleForValue(value);
        !debugNeedle.empty() && debugNeedle != "value") {
      return debugNeedle;
    }
    const Value *current = value;
    unsigned depth = 0;
    while (current && depth++ < 6) {
      if (!current->getName().empty()) {
        std::string token = trimTrailingDigits(current->getName());
        if (!token.empty() && token != "unnamed" &&
            !isLowSignalTypeToken(token)) {
          return token;
        }
      }
      if (const auto *load = llvm::dyn_cast<LoadInst>(current)) {
        current = load->getPointerOperand();
        continue;
      }
      if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(current)) {
        current = gep->getPointerOperand();
        continue;
      }
      if (const auto *inst = llvm::dyn_cast<Instruction>(current)) {
        if (inst->getOpcode() == llvm::Instruction::BitCast ||
            inst->getOpcode() == llvm::Instruction::AddrSpaceCast) {
          current = inst->getOperand(0);
          continue;
        }
      }
      if (const auto *ce = llvm::dyn_cast<llvm::ConstantExpr>(current)) {
        if (ce->isCast() || ce->getOpcode() == llvm::Instruction::GetElementPtr) {
          current = ce->getOperand(0);
          continue;
        }
      }
      break;
    }
    return "";
  }

  std::vector<std::string> narrowFieldHintsByNeedle(
      const std::vector<std::string> &fields,
      StringRef needle) {
    if (fields.empty() || needle.empty()) {
      return fields;
    }
    std::set<std::string> rootSet;
    size_t bestDepth = std::numeric_limits<size_t>::max();
    for (const std::string &field : fields) {
      llvm::SmallVector<StringRef, 16> parts;
      StringRef(field).split(parts, "__", -1, false);
      for (size_t i = 0; i < parts.size(); ++i) {
        if (parts[i] != needle) {
          continue;
        }
        std::string root;
        for (size_t j = 0; j <= i; ++j) {
          if (j != 0) {
            root += "__";
          }
          root += parts[j].str();
        }
        if (i < bestDepth) {
          bestDepth = i;
          rootSet.clear();
        }
        if (i == bestDepth) {
          rootSet.insert(root);
        }
      }
    }
    if (rootSet.empty()) {
      return fields;
    }
    std::vector<std::string> narrowed;
    std::set<std::string> seen;
    for (const std::string &root : rootSet) {
      if (seen.insert(root).second) {
        narrowed.push_back(root);
      }
      for (const std::string &field : fields) {
        if (field == root || StringRef(field).startswith(root + "__")) {
          if (seen.insert(field).second) {
            narrowed.push_back(field);
          }
        }
      }
    }
    return narrowed.empty() ? fields : narrowed;
  }

  unsigned scoreTypeHint(StringRef typeName) {
    if (typeName.empty()) {
      return 0;
    }
    if (typeName.contains("virtio_net_hdr") || typeName.contains("virtnet_hdr")) {
      return 100;
    }
    if (typeName.contains("vring_desc") || typeName.contains("virtq_desc")) {
      return 95;
    }
    if (typeName.contains("sk_buff")) {
      return 90;
    }
    if (typeName.contains("virtio_net_ctrl")) {
      return 85;
    }
    if (typeName.contains("scatterlist")) {
      return 80;
    }
    if (typeName.contains("page") || typeName.contains("xdp")) {
      return 70;
    }
    if (typeName.contains("unknown")) {
      return 0;
    }
    return 10;
  }

  std::string selectBestHintType(const std::vector<std::string> &hintedTypes) {
    unsigned bestScore = 0;
    std::string bestType;
    for (const std::string &typeName : hintedTypes) {
      const std::string token = sanitizeToken(typeName);
      const unsigned score = scoreTypeHint(token);
      if (score > bestScore) {
        bestScore = score;
        bestType = token;
      }
    }
    return bestType;
  }

  std::string classifyPayloadKindFromHints(
      const std::vector<std::string> &hintedTypes,
      const std::vector<std::string> &hintedFields,
      const std::vector<std::string> &hintedCalls,
      const std::vector<std::string> &hintedUseSites,
      const Function *caller) {
    std::string merged;
    auto appendTokens = [&](const std::vector<std::string> &values) {
      for (const std::string &value : values) {
        if (value.empty()) {
          continue;
        }
        if (!merged.empty()) {
          merged.push_back('_');
        }
        merged += sanitizeToken(value);
      }
    };
    appendTokens(hintedTypes);
    appendTokens(hintedFields);
    appendTokens(hintedCalls);
    appendTokens(hintedUseSites);
    if (merged.empty()) {
      return classifyPayloadKind("", "", caller);
    }
    return classifyPayloadKind(merged, "", caller);
  }

  std::string refinePayloadTypeFromHints(
      const std::vector<std::string> &hintedTypes,
      const std::vector<std::string> &hintedFields,
      const std::vector<std::string> &hintedCalls,
      const std::vector<std::string> &hintedUseSites,
      StringRef fallbackType,
      const Function *caller) {
    std::string type = canonicalizePayloadTypeName(selectBestHintType(hintedTypes));
    const std::string fieldType = inferTypeNameFromFields(hintedFields);
    if (!fieldType.empty()) {
      if (isWeakPayloadType(type) || type == "vring_desc_extra" ||
          !StringRef(type).contains(fieldType)) {
        type = fieldType;
      }
    }
    if (!type.empty()) {
      return type;
    }
    const std::string kind = classifyPayloadKindFromHints(
        hintedTypes, hintedFields, hintedCalls, hintedUseSites, caller);
    if (kind == "virtio_net_hdr") {
      return "virtio_net_hdr";
    }
    if (kind == "virtq_desc_table") {
      return "vring_desc";
    }
    if (kind == "ethernet_frame" && !fallbackType.empty()) {
      return sanitizeToken(fallbackType);
    }
    return "";
  }

  static std::string inferSemanticTypeFromFields(
      const std::vector<std::string> &fields) {
    auto hasExact = [&](StringRef token) {
      return std::find(fields.begin(), fields.end(), token.str()) != fields.end();
    };
    auto hasPrefix = [&](StringRef prefix) {
      for (const std::string &field : fields) {
        if (StringRef(field).startswith(prefix)) {
          return true;
        }
      }
      return false;
    };
    if (hasPrefix("virtio_net_hdr_v1_hash_tunnel__")) {
      return "virtio_net_hdr_v1_hash_tunnel";
    }
    if (hasPrefix("virtio_net_hdr_mrg_rxbuf__")) {
      return "virtio_net_hdr_mrg_rxbuf";
    }
    if (hasPrefix("virtio_net_hdr__")) {
      return "virtio_net_hdr";
    }
    if (hasPrefix("virtnet_info__rss_hdr")) {
      return "virtio_net_rss_config_hdr";
    }
    if (hasPrefix("virtio_net_rss_config_hdr__")) {
      return "virtio_net_rss_config_hdr";
    }
    if (hasPrefix("virtnet_info__field_46__rss_trailer")) {
      return "virtio_net_rss_config_trailer";
    }
    if (hasPrefix("virtio_net_rss_config_trailer__")) {
      return "virtio_net_rss_config_trailer";
    }
    if (hasPrefix("virtio_net_ctrl_mq__")) {
      return "virtio_net_ctrl_mq";
    }
    if (hasPrefix("virtio_net_ctrl_hdr__")) {
      return "virtio_net_ctrl_hdr";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_mac__")) {
      return "virtio_net_ctrl_hdr_mac";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_vlan_add__")) {
      return "virtio_net_ctrl_hdr_vlan_add";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_vlan_del__")) {
      return "virtio_net_ctrl_hdr_vlan_del";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_mq__")) {
      return "virtio_net_ctrl_hdr_mq";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_guest_offloads__")) {
      return "virtio_net_ctrl_hdr_guest_offloads";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_coal_tx__")) {
      return "virtio_net_ctrl_hdr_coal_tx";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_coal_rx__")) {
      return "virtio_net_ctrl_hdr_coal_rx";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_coal_vq__")) {
      return "virtio_net_ctrl_hdr_coal_vq";
    }
    if (hasPrefix("virtio_net_ctrl_hdr_queue_stats__")) {
      return "virtio_net_ctrl_hdr_queue_stats";
    }
    if (hasPrefix("virtio_net_ctrl_status__")) {
      return "virtio_net_ctrl_status";
    }
    if (hasExact("__virtio16__value") &&
        hasPrefix("control_buf__vdev__index")) {
      return "virtio_net_ctrl_vlan";
    }
    if (hasPrefix("virtio_net_ctrl_vlan__")) {
      return "virtio_net_ctrl_vlan";
    }
    if (hasPrefix("virtio_net_ctrl_coal_tx__")) {
      return "virtio_net_ctrl_coal_tx";
    }
    if (hasPrefix("virtio_net_ctrl_coal_rx__")) {
      return "virtio_net_ctrl_coal_rx";
    }
    if (hasPrefix("virtio_net_ctrl_coal_vq__")) {
      return "virtio_net_ctrl_coal_vq";
    }
    if (hasPrefix("virtio_net_ctrl_queue_stats__")) {
      return "virtio_net_ctrl_queue_stats";
    }
    if (hasPrefix("virtio_net_stats_reply_hdr__")) {
      return "virtio_net_stats_reply_hdr";
    }
    if (hasPrefix("virtio_net_stats_capabilities__")) {
      return "virtio_net_stats_capabilities";
    }
    if (hasPrefix("__virtio64__")) {
      return "virtio_net_guest_offloads";
    }
    if (hasPrefix("virtio_net_guest_offloads__")) {
      return "virtio_net_guest_offloads";
    }
    if (hasPrefix("virtnet_rq_dma__")) {
      return "virtnet_rq_dma";
    }
    if (hasPrefix("virtio_net_ctrl_mac_addr__")) {
      return "virtio_net_ctrl_mac_addr";
    }
    if (hasPrefix("sockaddr__")) {
      return "virtio_net_ctrl_mac_addr";
    }
    if (hasPrefix("net_device__dev_addr")) {
      return "virtio_net_ctrl_mac_addr";
    }
    if (hasPrefix("xdp_frame__")) {
      return "xdp_frame";
    }
    if (hasPrefix("ethernet_ipv4_frame__")) {
      return "ethernet_ipv4_frame";
    }
    if (hasPrefix("ethernet_ipv6_frame__")) {
      return "ethernet_ipv6_frame";
    }
    if (hasPrefix("ethernet_arp_frame__")) {
      return "ethernet_arp_frame";
    }
    if (hasPrefix("arp_packet__")) {
      return "arp_packet";
    }
    if (hasPrefix("ethernet_vlan_frame__")) {
      return "ethernet_vlan_frame";
    }
    if (hasPrefix("ipv4_tcp_packet__")) {
      return "ipv4_tcp_packet";
    }
    if (hasPrefix("ipv4_udp_packet__")) {
      return "ipv4_udp_packet";
    }
    if (hasPrefix("ipv4_icmp_packet__")) {
      return "ipv4_icmp_packet";
    }
    if (hasPrefix("ipv6_tcp_packet__")) {
      return "ipv6_tcp_packet";
    }
    if (hasPrefix("ipv6_udp_packet__")) {
      return "ipv6_udp_packet";
    }
    if (hasPrefix("ipv6_icmpv6_packet__")) {
      return "ipv6_icmpv6_packet";
    }
    if (hasPrefix("ipv6_fragment_packet__")) {
      return "ipv6_fragment_packet";
    }
    if (hasPrefix("vlan_ipv4_packet__")) {
      return "vlan_ipv4_packet";
    }
    if (hasPrefix("vlan_ipv6_packet__")) {
      return "vlan_ipv6_packet";
    }
    if (hasPrefix("vlan_arp_packet__")) {
      return "vlan_arp_packet";
    }
    if (hasPrefix("ethernet_frame__")) {
      return "ethernet_frame";
    }
    if (hasPrefix("control_buf__")) {
      return "control_buf";
    }
    return "";
  }

  static bool fieldMatchesSemanticType(StringRef type, StringRef field) {
    auto has = [&](StringRef prefix) { return field.startswith(prefix); };
    if (type == "virtio_net_hdr") {
      return has("virtio_net_hdr__");
    }
    if (type == "virtio_net_hdr_mrg_rxbuf") {
      return has("virtio_net_hdr_mrg_rxbuf__");
    }
    if (type == "virtio_net_hdr_v1_hash_tunnel") {
      return has("virtio_net_hdr_v1_hash_tunnel__");
    }
    if (type == "virtio_net_rss_config_hdr") {
      return has("virtio_net_rss_config_hdr__") ||
             has("virtnet_info__rss_hdr");
    }
    if (type == "virtio_net_rss_config_trailer") {
      return has("virtio_net_rss_config_trailer__") ||
             has("virtnet_info__field_46__rss_trailer");
    }
    if (type == "virtio_net_ctrl_hdr") {
      return has("virtio_net_ctrl_hdr__");
    }
    if (type == "virtio_net_ctrl_hdr_mac") {
      return has("virtio_net_ctrl_hdr_mac__");
    }
    if (type == "virtio_net_ctrl_hdr_vlan_add") {
      return has("virtio_net_ctrl_hdr_vlan_add__");
    }
    if (type == "virtio_net_ctrl_hdr_vlan_del") {
      return has("virtio_net_ctrl_hdr_vlan_del__");
    }
    if (type == "virtio_net_ctrl_hdr_mq") {
      return has("virtio_net_ctrl_hdr_mq__");
    }
    if (type == "virtio_net_ctrl_hdr_guest_offloads") {
      return has("virtio_net_ctrl_hdr_guest_offloads__");
    }
    if (type == "virtio_net_ctrl_hdr_coal_rx") {
      return has("virtio_net_ctrl_hdr_coal_rx__");
    }
    if (type == "virtio_net_ctrl_hdr_coal_tx") {
      return has("virtio_net_ctrl_hdr_coal_tx__");
    }
    if (type == "virtio_net_ctrl_hdr_coal_vq") {
      return has("virtio_net_ctrl_hdr_coal_vq__");
    }
    if (type == "virtio_net_ctrl_hdr_queue_stats") {
      return has("virtio_net_ctrl_hdr_queue_stats__");
    }
    if (type == "virtio_net_ctrl_status") {
      return has("virtio_net_ctrl_status__");
    }
    if (type == "virtio_net_ctrl_vlan") {
      return has("virtio_net_ctrl_vlan__") || has("__virtio16__") ||
             has("control_buf__vdev__index");
    }
    if (type == "virtio_net_ctrl_mq") {
      return has("virtio_net_ctrl_mq__");
    }
    if (type == "virtio_net_ctrl_coal_rx") {
      return has("virtio_net_ctrl_coal_rx__");
    }
    if (type == "virtio_net_ctrl_coal_tx") {
      return has("virtio_net_ctrl_coal_tx__");
    }
    if (type == "virtio_net_ctrl_coal_vq") {
      return has("virtio_net_ctrl_coal_vq__");
    }
    if (type == "virtio_net_ctrl_queue_stats") {
      return has("virtio_net_ctrl_queue_stats__");
    }
    if (type == "virtio_net_stats_reply_hdr") {
      return has("virtio_net_stats_reply_hdr__");
    }
    if (type == "virtio_net_stats_capabilities") {
      return has("virtio_net_stats_capabilities__");
    }
    if (type == "virtio_net_guest_offloads") {
      return has("virtio_net_guest_offloads__") || has("__virtio64__");
    }
    if (type == "virtnet_rq_dma") {
      return has("virtnet_rq_dma__");
    }
    if (type == "virtio_net_ctrl_mac_addr") {
      return has("virtio_net_ctrl_mac_addr__") || has("sockaddr__");
    }
    return false;
  }

  std::string inferTypeNameFromFields(const std::vector<std::string> &fields) {
    const std::string semanticType = inferSemanticTypeFromFields(fields);
    if (!semanticType.empty()) {
      return semanticType;
    }
    for (const std::string &field : fields) {
      if (field.empty()) {
        continue;
      }
      StringRef ref(field);
      size_t sep = ref.find("__");
      if (sep == StringRef::npos) {
        continue;
      }
      std::string prefix = sanitizeToken(ref.substr(0, sep));
      if (!prefix.empty() && prefix != "unknown") {
        return prefix;
      }
    }
    return "";
  }

  static bool samePayloadVariant(const DmaPayloadVariant &lhs,
                                 const DmaPayloadVariant &rhs) {
    return lhs.payload.kind == rhs.payload.kind &&
           lhs.payload.type == rhs.payload.type &&
           lhs.payload.fields == rhs.payload.fields &&
           lhs.lengthValue == rhs.lengthValue;
  }

  static void appendPayloadVariant(std::vector<DmaPayloadVariant> &out,
                                   const DmaPayloadVariant &variant) {
    for (const DmaPayloadVariant &existing : out) {
      if (samePayloadVariant(existing, variant)) {
        return;
      }
    }
    out.push_back(variant);
  }

  static bool payloadIsGeneric(const DmaPayloadInfo &payload) {
    return payload.kind == "sg_buffer" &&
           (payload.type.empty() || payload.type == "unknown") &&
           payload.fields.empty();
  }

  static bool payloadIsPureControlBuf(const DmaPayloadInfo &payload) {
    if (payload.type != "control_buf" || payload.fields.empty()) {
      return false;
    }
    for (const std::string &field : payload.fields) {
      if (!StringRef(field).startswith("control_buf__")) {
        return false;
      }
    }
    return true;
  }

  static bool payloadIsPlainChar(const DmaPayloadInfo &payload) {
    if (payload.type != "char") {
      return false;
    }
    if (payload.fields.empty()) {
      return true;
    }
    for (const std::string &field : payload.fields) {
      if (field != "char__value") {
        return false;
      }
    }
    return true;
  }

  static void dedupeLengthGroups(
      std::vector<std::pair<uint64_t, DmaPayloadInfo>> &groups) {
    std::set<std::string> seen;
    std::vector<std::pair<uint64_t, DmaPayloadInfo>> deduped;
    deduped.reserve(groups.size());
    for (const auto &group : groups) {
      std::string key = std::to_string(group.first);
      key.push_back('|');
      key += canonicalizePayloadTypeName(group.second.type);
      key.push_back('|');
      for (const std::string &field : group.second.fields) {
        key += sanitizeToken(field);
        key.push_back(',');
      }
      if (seen.insert(std::move(key)).second) {
        deduped.push_back(group);
      }
    }
    groups = std::move(deduped);
  }

  static void filterLengthGroupsByFixedSchemaSize(
      std::vector<std::pair<uint64_t, DmaPayloadInfo>> &groups,
      const std::map<std::string, std::set<uint64_t>> &schemaLengthImmediates) {
    llvm::erase_if(groups, [&](const auto &group) {
      const std::string type = canonicalizePayloadTypeName(group.second.type);
      if (type.empty() || type == "unknown") {
        return false;
      }
      const std::optional<uint64_t> fixed =
          schemaAwarePayloadSize(type, schemaLengthImmediates);
      return fixed && *fixed != group.first;
    });
  }

  static bool isVirtioNetControlPayloadType(StringRef typeName) {
    const std::string token = canonicalizePayloadTypeName(typeName);
    return token == "control_buf" || token == "virtio_net_ctrl_hdr" ||
           StringRef(token).startswith("virtio_net_ctrl_") ||
           StringRef(token).startswith("virtio_net_rss_config_") ||
           token == "virtio_net_guest_offloads" ||
           token == "virtio_net_stats_capabilities" ||
           StringRef(token).startswith("VIRTIO_NET_CTRL_");
  }

  static bool isVirtioNetControlField(StringRef field) {
    return field.startswith("control_buf__") ||
           field.startswith("virtio_net_ctrl_") ||
           field.startswith("virtio_net_rss_config_") ||
           field.startswith("virtnet_info__rss_hdr") ||
           field.startswith("virtnet_info__field_46__rss_trailer") ||
           field.startswith("__virtio16__") || field.startswith("__virtio64__");
  }

  static bool isVirtioNetStatsReplyConcreteType(StringRef typeName) {
    const std::string token = canonicalizePayloadTypeName(typeName);
    return token == "virtio_net_stats_cvq" ||
           token == "virtio_net_stats_rx_basic" ||
           token == "virtio_net_stats_tx_basic" ||
           token == "virtio_net_stats_rx_csum" ||
           token == "virtio_net_stats_tx_csum" ||
           token == "virtio_net_stats_rx_gso" ||
           token == "virtio_net_stats_tx_gso" ||
           token == "virtio_net_stats_rx_speed" ||
           token == "virtio_net_stats_tx_speed";
  }

  static void stripVirtioNetControlPayloadInfo(DmaPayloadInfo &payload) {
    if (!payload.fields.empty()) {
      std::vector<std::string> filtered;
      filtered.reserve(payload.fields.size());
      for (const std::string &field : payload.fields) {
        if (!isVirtioNetControlField(field)) {
          filtered.push_back(field);
        }
      }
      payload.fields = std::move(filtered);
    }
    if (isVirtioNetControlPayloadType(payload.type)) {
      payload.type = payload.fields.empty() ? "unknown" : "";
    }
    if (payload.type.empty()) {
      const std::string semanticType = inferSemanticTypeFromFields(payload.fields);
      if (!semanticType.empty()) {
        payload.type = semanticType;
      }
    }
  }

  static void forceEthernetFramePayload(DmaPayloadInfo &payload) {
    payload.kind = "ethernet_frame";
    payload.type = "ethernet_frame";
    payload.fields = {
        "ethernet_frame__dst",
        "ethernet_frame__src",
        "ethernet_frame__ethertype",
        "ethernet_frame__payload",
    };
  }

  static std::string rewriteFieldPrefix(StringRef field, StringRef fromPrefix,
                                        StringRef toPrefix) {
    if (!field.startswith(fromPrefix)) {
      return field.str();
    }
    return (toPrefix + field.drop_front(fromPrefix.size())).str();
  }

  static DmaPayloadInfo specializeEthernetFramePayload(
      const DmaPayloadInfo &payload, StringRef typeName) {
    DmaPayloadInfo variant = payload;
    variant.kind = sanitizeToken(typeName);
    variant.type = sanitizeToken(typeName);
    const std::string targetPrefix = sanitizeToken(typeName) + "__";
    if (typeName == "ethernet_ipv4_frame") {
      variant.fields = {
          targetPrefix + "dst",
          targetPrefix + "src",
          targetPrefix + "ethertype",
          targetPrefix + "version_ihl",
          targetPrefix + "dscp_ecn",
          targetPrefix + "total_length",
          targetPrefix + "identification",
          targetPrefix + "fragment_offset",
          targetPrefix + "ttl",
          targetPrefix + "protocol",
          targetPrefix + "hdr_checksum",
          targetPrefix + "src_addr",
          targetPrefix + "dst_addr",
          targetPrefix + "payload",
      };
      return variant;
    }
    if (typeName == "ethernet_ipv6_frame") {
      variant.fields = {
          targetPrefix + "dst",
          targetPrefix + "src",
          targetPrefix + "ethertype",
          targetPrefix + "version_tc_flow",
          targetPrefix + "payload_length",
          targetPrefix + "next_header",
          targetPrefix + "hop_limit",
          targetPrefix + "src_addr",
          targetPrefix + "dst_addr",
          targetPrefix + "payload",
      };
      return variant;
    }
    if (typeName == "ethernet_arp_frame") {
      variant.fields = {
          targetPrefix + "dst",
          targetPrefix + "src",
          targetPrefix + "ethertype",
          targetPrefix + "htype",
          targetPrefix + "ptype",
          targetPrefix + "hlen",
          targetPrefix + "plen",
          targetPrefix + "oper",
          targetPrefix + "sha",
          targetPrefix + "spa",
          targetPrefix + "tha",
          targetPrefix + "tpa",
          targetPrefix + "padding",
      };
      return variant;
    }
    if (typeName == "ethernet_vlan_frame") {
      variant.fields = {
          targetPrefix + "dst",
          targetPrefix + "src",
          targetPrefix + "ethertype",
          targetPrefix + "tci",
          targetPrefix + "inner_ethertype",
          targetPrefix + "payload",
      };
      return variant;
    }
    std::vector<std::string> specializedFields;
    specializedFields.reserve(payload.fields.size());
    for (const std::string &field : payload.fields) {
      specializedFields.push_back(rewriteFieldPrefix(
          field, "ethernet_frame__", targetPrefix));
    }
    variant.fields = std::move(specializedFields);
    return variant;
  }

  static DmaPayloadInfo specializeIpPayload(const DmaPayloadInfo &payload,
                                            StringRef typeName) {
    DmaPayloadInfo variant = payload;
    variant.kind = sanitizeToken(typeName);
    variant.type = sanitizeToken(typeName);
    const std::string prefix = sanitizeToken(typeName) + "__";
    if (typeName == "ipv4_tcp_packet" || typeName == "ipv6_tcp_packet") {
      if (typeName == "ipv4_tcp_packet") {
        variant.fields = {
            prefix + "src_mac",
            prefix + "dst_mac",
            prefix + "ethertype",
            prefix + "version_ihl",
            prefix + "dscp_ecn",
            prefix + "total_length",
            prefix + "identification",
            prefix + "fragment_offset",
            prefix + "ttl",
            prefix + "src_addr",
            prefix + "dst_addr",
            prefix + "protocol",
            prefix + "src_port",
            prefix + "dst_port",
            prefix + "seq",
            prefix + "ack_seq",
            prefix + "data_offset",
            prefix + "flags",
            prefix + "window",
            prefix + "checksum",
            prefix + "urgent_ptr",
            prefix + "payload",
        };
      } else {
        variant.fields = {
            prefix + "src_mac",
            prefix + "dst_mac",
            prefix + "ethertype",
            prefix + "version_tc_flow",
            prefix + "payload_length",
            prefix + "hop_limit",
            prefix + "src_addr",
            prefix + "dst_addr",
            prefix + "next_header",
            prefix + "src_port",
            prefix + "dst_port",
            prefix + "seq",
            prefix + "ack_seq",
            prefix + "data_offset",
            prefix + "flags",
            prefix + "window",
            prefix + "checksum",
            prefix + "urgent_ptr",
            prefix + "payload",
        };
      }
      return variant;
    }
    if (typeName == "ipv4_udp_packet" || typeName == "ipv6_udp_packet") {
      if (typeName == "ipv4_udp_packet") {
        variant.fields = {
            prefix + "src_mac",
            prefix + "dst_mac",
            prefix + "ethertype",
            prefix + "version_ihl",
            prefix + "dscp_ecn",
            prefix + "total_length",
            prefix + "identification",
            prefix + "fragment_offset",
            prefix + "ttl",
            prefix + "src_addr",
            prefix + "dst_addr",
            prefix + "protocol",
            prefix + "src_port",
            prefix + "dst_port",
            prefix + "length",
            prefix + "checksum",
            prefix + "payload",
        };
      } else {
        variant.fields = {
            prefix + "src_mac",
            prefix + "dst_mac",
            prefix + "ethertype",
            prefix + "version_tc_flow",
            prefix + "payload_length",
            prefix + "hop_limit",
            prefix + "src_addr",
            prefix + "dst_addr",
            prefix + "next_header",
            prefix + "src_port",
            prefix + "dst_port",
            prefix + "length",
            prefix + "checksum",
            prefix + "payload",
        };
      }
      return variant;
    }
    if (typeName == "ipv4_icmp_packet") {
      variant.fields = {
          prefix + "src_mac",
          prefix + "dst_mac",
          prefix + "ethertype",
          prefix + "version_ihl",
          prefix + "dscp_ecn",
          prefix + "total_length",
          prefix + "identification",
          prefix + "fragment_offset",
          prefix + "ttl",
          prefix + "src_addr",
          prefix + "dst_addr",
          prefix + "protocol",
          prefix + "type",
          prefix + "code",
          prefix + "checksum",
          prefix + "rest",
          prefix + "payload",
      };
      return variant;
    }
    if (typeName == "ipv6_icmpv6_packet") {
      variant.fields = {
          prefix + "src_mac",
          prefix + "dst_mac",
          prefix + "ethertype",
          prefix + "version_tc_flow",
          prefix + "payload_length",
          prefix + "hop_limit",
          prefix + "src_addr",
          prefix + "dst_addr",
          prefix + "next_header",
          prefix + "type",
          prefix + "code",
          prefix + "checksum",
          prefix + "rest",
          prefix + "payload",
      };
      return variant;
    }
    if (typeName == "ipv6_fragment_packet") {
      variant.fields = {
          prefix + "src_mac",
          prefix + "dst_mac",
          prefix + "ethertype",
          prefix + "version_tc_flow",
          prefix + "payload_length",
          prefix + "hop_limit",
          prefix + "src_addr",
          prefix + "dst_addr",
          prefix + "next_header",
          prefix + "reserved",
          prefix + "fragment_offset",
          prefix + "identification",
          prefix + "payload",
      };
      return variant;
    }
    return variant;
  }

  static DmaPayloadInfo specializeVlanPayload(const DmaPayloadInfo &payload,
                                              StringRef typeName) {
    DmaPayloadInfo variant = payload;
    variant.kind = sanitizeToken(typeName);
    variant.type = sanitizeToken(typeName);
    const std::string prefix = sanitizeToken(typeName) + "__";
    if (typeName == "vlan_ipv4_packet") {
      variant.fields = {
          prefix + "dst_mac",
          prefix + "src_mac",
          prefix + "ethertype",
          prefix + "tci",
          prefix + "inner_ethertype",
          prefix + "version_ihl",
          prefix + "dscp_ecn",
          prefix + "total_length",
          prefix + "identification",
          prefix + "fragment_offset",
          prefix + "ttl",
          prefix + "src_addr",
          prefix + "dst_addr",
          prefix + "protocol",
          prefix + "payload",
      };
      return variant;
    }
    if (typeName == "vlan_ipv6_packet") {
      variant.fields = {
          prefix + "dst_mac",
          prefix + "src_mac",
          prefix + "ethertype",
          prefix + "tci",
          prefix + "inner_ethertype",
          prefix + "version_tc_flow",
          prefix + "payload_length",
          prefix + "hop_limit",
          prefix + "src_addr",
          prefix + "dst_addr",
          prefix + "next_header",
          prefix + "payload",
      };
      return variant;
    }
    if (typeName == "vlan_arp_packet") {
      variant.fields = {
          prefix + "dst_mac",
          prefix + "src_mac",
          prefix + "ethertype",
          prefix + "tci",
          prefix + "inner_ethertype",
          prefix + "htype",
          prefix + "ptype",
          prefix + "hlen",
          prefix + "plen",
          prefix + "oper",
          prefix + "sha",
          prefix + "spa",
          prefix + "tha",
          prefix + "tpa",
          prefix + "padding",
      };
      return variant;
    }
    return variant;
  }

  static DmaPayloadInfo specializeArpPayload(const DmaPayloadInfo &payload,
                                             StringRef typeName) {
    DmaPayloadInfo variant = payload;
    variant.kind = sanitizeToken(typeName);
    variant.type = sanitizeToken(typeName);
    const std::string prefix = sanitizeToken(typeName) + "__";
    if (typeName == "arp_packet") {
      variant.fields = {
          prefix + "dst_mac",
          prefix + "src_mac",
          prefix + "ethertype",
          prefix + "htype",
          prefix + "ptype",
          prefix + "hlen",
          prefix + "plen",
          prefix + "oper",
          prefix + "sha",
          prefix + "spa",
          prefix + "tha",
          prefix + "tpa",
          prefix + "padding",
      };
    }
    return variant;
  }

  static std::optional<int64_t> sgSlotIndexForCall(const CallBase *call) {
    if (!call || call->arg_size() == 0) {
      return std::nullopt;
    }
    const PointerAccessPath path = pointerAccessPathFor(call->getArgOperand(0));
    if (!path.exact || path.indices.empty()) {
      return std::nullopt;
    }
    return path.indices.back();
  }

  static bool isRxBufferSetupContext(StringRef name) {
    return name == "add_recvbuf_big" ||
           name == "add_recvbuf_mergeable" ||
           name == "add_recvbuf_small" ||
           name == "try_fill_recv" ||
           name == "virtnet_rq_init_one_sg" ||
           name == "__virtnet_rx_resume" ||
           name == "virtnet_rx_resume" ||
           name == "virtnet_rq_bind_xsk_pool";
  }

  std::string specificControlHeaderTypeForTraceContext() const {
    if (traceContextHasFunction("virtnet_commit_rss_command") ||
        traceContextHasFunction("virtnet_set_hashflow") ||
        traceContextHasFunction("virtnet_set_rxfh")) {
      return "";
    }
    if (traceContextHasFunction("virtnet_set_guest_offloads") ||
        traceContextHasFunction("virtnet_clear_guest_offloads") ||
        traceContextHasFunction("virtnet_restore_guest_offloads") ||
        traceContextHasFunction("virtnet_set_features")) {
      return "virtio_net_ctrl_hdr_guest_offloads";
    }
    if (traceContextHasFunction("virtnet_set_queues") ||
        traceContextHasFunction("virtnet_set_channels")) {
      return "virtio_net_ctrl_hdr_mq";
    }
    if (traceContextHasFunction("virtnet_vlan_rx_add_vid")) {
      return "virtio_net_ctrl_hdr_vlan_add";
    }
    if (traceContextHasFunction("virtnet_vlan_rx_kill_vid")) {
      return "virtio_net_ctrl_hdr_vlan_del";
    }
    if (traceContextHasFunction("virtnet_set_mac_address") ||
        traceContextHasFunction("virtnet_rx_mode_work")) {
      return "virtio_net_ctrl_hdr_mac";
    }
    if (traceContextHasFunction("virtnet_send_tx_ctrl_coal_vq_cmd") ||
        traceContextHasFunction("virtnet_send_tx_notf_coal_cmds")) {
      return "virtio_net_ctrl_hdr_coal_tx";
    }
    if (traceContextHasFunction("virtnet_send_rx_ctrl_coal_vq_cmd") ||
        traceContextHasFunction("virtnet_send_rx_notf_coal_cmds")) {
      return "virtio_net_ctrl_hdr_coal_rx";
    }
    if (traceContextHasFunction("virtnet_send_ctrl_coal_vq_cmd")) {
      return "virtio_net_ctrl_hdr_coal_vq";
    }
    if (traceContextHasFunction("__virtnet_get_hw_stats")) {
      return "virtio_net_ctrl_hdr_queue_stats";
    }
    return "";
  }

  std::string specificControlPayloadTypeForTraceContext(
      std::optional<int64_t> sgSlot) const {
    if (!sgSlot) {
      if (traceContextHasFunction("virtnet_send_ctrl_coal_vq_cmd")) {
        return "virtio_net_ctrl_coal_vq";
      }
      if (traceContextHasFunction("virtnet_set_guest_offloads") ||
          traceContextHasFunction("virtnet_clear_guest_offloads") ||
          traceContextHasFunction("virtnet_restore_guest_offloads") ||
          traceContextHasFunction("virtnet_set_features")) {
        return "virtio_net_guest_offloads";
      }
      if (traceContextHasFunction("virtnet_vlan_rx_add_vid") ||
          traceContextHasFunction("virtnet_vlan_rx_kill_vid")) {
        return "virtio_net_ctrl_vlan";
      }
      if (traceContextHasFunction("virtnet_set_mac_address")) {
        return "virtio_net_ctrl_mac_addr";
      }
      if (traceContextHasFunction("virtnet_send_tx_ctrl_coal_vq_cmd") ||
          traceContextHasFunction("virtnet_send_tx_notf_coal_cmds")) {
        return "virtio_net_ctrl_coal_tx";
      }
      if (traceContextHasFunction("virtnet_send_rx_ctrl_coal_vq_cmd") ||
          traceContextHasFunction("virtnet_send_rx_notf_coal_cmds")) {
        return "virtio_net_ctrl_coal_rx";
      }
      if (traceContextHasFunction("virtnet_send_ctrl_coal_vq_cmd")) {
        return "virtio_net_ctrl_coal_vq";
      }
      if (traceContextHasFunction("__virtnet_get_hw_stats")) {
        return "virtio_net_ctrl_queue_stats";
      }
      if (traceContextHasFunction("virtnet_set_queues") ||
          traceContextHasFunction("virtnet_set_channels")) {
        return "virtio_net_ctrl_mq";
      }
      return "";
    }
    if (*sgSlot == 0) {
      if (traceContextHasFunction("virtnet_commit_rss_command") ||
          traceContextHasFunction("virtnet_set_hashflow") ||
          traceContextHasFunction("virtnet_set_rxfh")) {
        return "virtio_net_rss_config_hdr";
      }
      return specificControlHeaderTypeForTraceContext();
    }
    if (*sgSlot == 1) {
      if (traceContextHasFunction("virtnet_commit_rss_command") ||
          traceContextHasFunction("virtnet_set_hashflow") ||
          traceContextHasFunction("virtnet_set_rxfh")) {
        return "virtio_net_rss_config_trailer";
      }
      if (traceContextHasFunction("virtnet_set_guest_offloads") ||
          traceContextHasFunction("virtnet_clear_guest_offloads") ||
          traceContextHasFunction("virtnet_restore_guest_offloads") ||
          traceContextHasFunction("virtnet_set_features")) {
        return "virtio_net_guest_offloads";
      }
      if (traceContextHasFunction("virtnet_vlan_rx_add_vid") ||
          traceContextHasFunction("virtnet_vlan_rx_kill_vid")) {
        return "virtio_net_ctrl_vlan";
      }
      if (traceContextHasFunction("virtnet_set_mac_address")) {
        return "virtio_net_ctrl_mac_addr";
      }
      if (traceContextHasFunction("virtnet_send_tx_ctrl_coal_vq_cmd") ||
          traceContextHasFunction("virtnet_send_tx_notf_coal_cmds")) {
        return "virtio_net_ctrl_coal_tx";
      }
      if (traceContextHasFunction("virtnet_send_rx_ctrl_coal_vq_cmd") ||
          traceContextHasFunction("virtnet_send_rx_notf_coal_cmds")) {
        return "virtio_net_ctrl_coal_rx";
      }
      if (traceContextHasFunction("virtnet_send_ctrl_coal_vq_cmd")) {
        return "virtio_net_ctrl_coal_vq";
      }
      if (traceContextHasFunction("__virtnet_get_hw_stats")) {
        return "virtio_net_ctrl_queue_stats";
      }
      if (traceContextHasFunction("virtnet_set_queues") ||
          traceContextHasFunction("virtnet_set_channels")) {
        return "virtio_net_ctrl_mq";
      }
    }
    return "";
  }

  const Value *premappedBufferValueFor(const Function *function) const {
    if (!function) {
      return nullptr;
    }
    if (function->getName() == "virtnet_rq_init_one_sg" &&
        function->arg_size() >= 2) {
      auto it = function->arg_begin();
      ++it;
      return &*it;
    }
    return nullptr;
  }

  bool traceContextHasFunction(StringRef name) const {
    for (const TraceBuildFrame &frame : traceBuildStack_) {
      if (frame.function && frame.function->getName() == name) {
        return true;
      }
      if (frame.caller && frame.caller->getFunction()->getName() == name) {
        return true;
      }
    }
    return false;
  }

  const Function *traceContextFunctionNamed(StringRef name) const {
    for (const TraceBuildFrame &frame : traceBuildStack_) {
      if (frame.function && frame.function->getName() == name) {
        return frame.function;
      }
      if (frame.caller && frame.caller->getFunction()->getName() == name) {
        return frame.caller->getFunction();
      }
    }
    return nullptr;
  }

  bool traceContextHasTypedSourceHint(StringRef calleeName,
                                      unsigned argIndex,
                                      StringRef typeName) const {
    for (const PayloadSourceInfo &source :
         collectTraceContextTypedSources(calleeName, argIndex,
                                         std::max(argIndex, 2u))) {
      if (!source.originCall) {
        continue;
      }
      const std::vector<std::string> hintedTypes =
          lookupPointsToHintTypes(source.originCall, calleeName, argIndex);
      const bool typeMatch = llvm::any_of(
          hintedTypes, [&](const std::string &hintedType) {
            return canonicalizePayloadTypeName(hintedType) ==
                   canonicalizePayloadTypeName(typeName);
          });
      if (typeMatch) {
        return true;
      }
    }
    return false;
  }

  static bool hasStrongTypedSourceHint(
      const std::vector<std::string> &hintedTypes) {
    for (const std::string &hintedType : hintedTypes) {
      const std::string token = canonicalizePayloadTypeName(hintedType);
      if (!token.empty() && !isWeakPayloadType(token)) {
        return true;
      }
    }
    return false;
  }

  std::vector<PayloadSourceInfo> collectTraceContextTypedSources(
      StringRef calleeName,
      unsigned argIndex,
      unsigned lengthArgIndex) const {
    std::vector<PayloadSourceInfo> out;
    std::set<const Function *> seen;
    for (const TraceBuildFrame &frame : traceBuildStack_) {
      const Function *candidates[] = {
          frame.function,
          frame.caller ? frame.caller->getFunction() : nullptr,
      };
      for (const Function *function : candidates) {
        if (!function || !seen.insert(function).second) {
          continue;
        }
        for (const Instruction &inst : llvm::instructions(*function)) {
          const auto *call = llvm::dyn_cast<CallBase>(&inst);
          if (!call || call->arg_size() <= std::max(argIndex, lengthArgIndex)) {
            continue;
          }
          const Function *callee = llvm::dyn_cast<Function>(
              call->getCalledOperand()->stripPointerCasts());
          if (!callee || callee->getName() != calleeName) {
            continue;
          }
          const std::vector<std::string> hintedTypes =
              lookupPointsToHintTypes(call, calleeName, argIndex);
          if (!hasStrongTypedSourceHint(hintedTypes)) {
            continue;
          }
          PayloadSourceInfo source;
          source.value = call->getArgOperand(argIndex);
          source.originCall = call;
          source.originCallee = calleeName.str();
          source.originArgIndex = argIndex;
          source.lengthValue = call->getArgOperand(lengthArgIndex);
          appendPayloadSourceInfo(out, source);
        }
      }
    }
    return out;
  }

  bool functionInTraceContext(const Function *function) const {
    if (!function) {
      return false;
    }
    for (const TraceBuildFrame &frame : traceBuildStack_) {
      if (frame.function == function) {
        return true;
      }
      if (frame.caller && frame.caller->getFunction() == function) {
        return true;
      }
    }
    return false;
  }

  std::optional<uint64_t> constantLengthForValue(const Function *context,
                                                 const Value *value,
                                                 unsigned depth = 0) const {
    if (!value || depth > 8) {
      return std::nullopt;
    }
    if (const auto *ci = llvm::dyn_cast<ConstantInt>(value)) {
      return ci->getZExtValue();
    }
    if (const auto *arg = llvm::dyn_cast<llvm::Argument>(value)) {
      const Function *parent = arg->getParent();
      if (!parent) {
        return std::nullopt;
      }
      std::optional<uint64_t> agreed;
      for (const Function &candidateFunction : module_) {
        if (!traceBuildStack_.empty() &&
            !functionInTraceContext(&candidateFunction)) {
          continue;
        }
        for (const BasicBlock &block : candidateFunction) {
          for (const Instruction &instruction : block) {
            const auto *candidateCall = llvm::dyn_cast<CallBase>(&instruction);
            if (!candidateCall) {
              continue;
            }
            const Function *callee = llvm::dyn_cast<Function>(
                candidateCall->getCalledOperand()->stripPointerCasts());
            if (callee != parent || candidateCall->arg_size() <= arg->getArgNo()) {
              continue;
            }
            std::optional<uint64_t> candidate =
                constantLengthForValue(&candidateFunction,
                                       candidateCall->getArgOperand(arg->getArgNo()),
                                       depth + 1);
            if (!candidate) {
              return std::nullopt;
            }
            if (!agreed) {
              agreed = candidate;
            } else if (*agreed != *candidate) {
              return std::nullopt;
            }
          }
        }
      }
      return agreed;
    }
    if (const auto *ce = llvm::dyn_cast<llvm::ConstantExpr>(value)) {
      if (ce->isCast()) {
        return constantLengthForValue(context, ce->getOperand(0), depth + 1);
      }
    }
    if (const auto *inst = llvm::dyn_cast<Instruction>(value)) {
      switch (inst->getOpcode()) {
        case llvm::Instruction::ZExt:
        case llvm::Instruction::SExt:
        case llvm::Instruction::Trunc:
        case llvm::Instruction::BitCast:
          return constantLengthForValue(context, inst->getOperand(0), depth + 1);
        case llvm::Instruction::Add: {
          auto lhs = constantLengthForValue(context, inst->getOperand(0), depth + 1);
          auto rhs = constantLengthForValue(context, inst->getOperand(1), depth + 1);
          if (lhs && rhs) {
            return *lhs + *rhs;
          }
          break;
        }
        case llvm::Instruction::Mul: {
          auto lhs = constantLengthForValue(context, inst->getOperand(0), depth + 1);
          auto rhs = constantLengthForValue(context, inst->getOperand(1), depth + 1);
          if (lhs && rhs) {
            return (*lhs) * (*rhs);
          }
          break;
        }
        default:
          break;
      }
    }
    return std::nullopt;
  }

  std::optional<uint64_t> constantSizeForValueType(const Value *value) const {
    if (!value) {
      return std::nullopt;
    }
    const DataLayout &dl = module_.getDataLayout();
    const Value *base = stripPointerCastsAndGep(value);
    llvm::Type *type = value->getType();
    if (const auto *allocaInst = llvm::dyn_cast_or_null<llvm::AllocaInst>(base)) {
      type = allocaInst->getAllocatedType();
    } else if (const auto *global = llvm::dyn_cast_or_null<llvm::GlobalVariable>(base)) {
      type = global->getValueType();
    } else if (const auto *ptr = llvm::dyn_cast<llvm::PointerType>(type)) {
      type = ptr->getNonOpaquePointerElementType();
    }
    if (!type || !type->isSized()) {
      return std::nullopt;
    }
    return dl.getTypeAllocSize(type);
  }

  static std::optional<uint64_t> schemaAwarePayloadSize(
      StringRef typeName,
      const std::map<std::string, std::set<uint64_t>> &schemaLengthImmediates) {
    const std::optional<std::string> decl =
        renderSchemaDecl(
            typeName,
            std::map<std::string, MachineModel::ExplicitSchemaDecl>{},
            schemaLengthImmediates,
            std::map<std::string, std::set<std::pair<uint64_t, uint64_t>>>{},
            std::map<std::string, std::set<std::pair<unsigned, unsigned>>>{},
            std::map<std::string,
                     std::map<unsigned, std::set<std::pair<unsigned, unsigned>>>>{});
    if (!decl) {
      return std::nullopt;
    }
    uint64_t size = 0;
    bool inStruct = false;
    for (StringRef line : llvm::split(StringRef(*decl), '\n')) {
      line = line.trim();
      if (line.empty()) {
        continue;
      }
      if (!inStruct) {
        if (line.startswith("struct ")) {
          inStruct = true;
        }
        continue;
      }
      if (line == "}") {
        break;
      }
      const size_t colon = line.find(':');
      if (colon == StringRef::npos) {
        continue;
      }
      StringRef typePart = line.substr(colon + 1).trim();
      if (typePart.endswith(";")) {
        typePart = typePart.drop_back().trim();
      }
      if (typePart.startswith("u8")) {
        size += 1;
        continue;
      }
      if (typePart.startswith("u16")) {
        size += 2;
        continue;
      }
      if (typePart.startswith("u32")) {
        size += 4;
        continue;
      }
      if (typePart.startswith("u64")) {
        size += 8;
        continue;
      }
      if (typePart.startswith("bytes[")) {
        const size_t open = typePart.find('[');
        const size_t close = typePart.find(']', open + 1);
        if (close == StringRef::npos) {
          return std::nullopt;
        }
        uint64_t width = 0;
        if (typePart.slice(open + 1, close).getAsInteger(0, width)) {
          return std::nullopt;
        }
        size += width;
        continue;
      }
      if (typePart.startswith("ptr<")) {
        size += 8;
        continue;
      }
      return std::nullopt;
    }
    return size == 0 ? std::nullopt : std::optional<uint64_t>(size);
  }

  static void mergePayloadInfoInto(DmaPayloadInfo &into,
                                   const DmaPayloadInfo &other) {
    into.type = canonicalizePayloadTypeName(into.type);
    const std::string otherType = canonicalizePayloadTypeName(other.type);
    if (isWeakPayloadType(into.type) && !isWeakPayloadType(otherType)) {
      into.type = otherType;
    } else if (!isWeakPayloadType(into.type) && isWeakPayloadType(otherType)) {
      // Keep the more specific existing type.
    } else if (!otherType.empty() && !isWeakPayloadType(otherType) &&
               into.type != otherType) {
      into.type = "unknown";
    }
    if (into.kind == "sg_buffer" && other.kind != "sg_buffer") {
      into.kind = other.kind;
    } else if (into.kind != other.kind) {
      into.kind = "sg_buffer";
    }
    std::set<std::string> seen(into.fields.begin(), into.fields.end());
    for (const std::string &field : other.fields) {
      if (seen.insert(field).second) {
        into.fields.push_back(field);
      }
    }
  }

  static void normalizeMergedPayloadInfo(DmaPayloadInfo &payload) {
    if (!payload.fields.empty()) {
      std::vector<std::string> canonicalFields;
      canonicalFields.reserve(payload.fields.size());
      std::set<std::string> seen;
      for (const std::string &field : payload.fields) {
        std::string token = canonicalizeFieldHintToken(field);
        if (token.empty()) {
          continue;
        }
        if (seen.insert(token).second) {
          canonicalFields.push_back(std::move(token));
        }
      }
      if (!canonicalFields.empty()) {
        payload.fields = std::move(canonicalFields);
      }
    }
    if (payload.fields.size() > 1) {
      std::vector<std::string> filteredFields;
      filteredFields.reserve(payload.fields.size());
      const auto hasFieldPrefix = [&](StringRef prefix) {
        for (const std::string &field : payload.fields) {
          if (StringRef(field).startswith(prefix)) {
            return true;
          }
        }
        return false;
      };
      const bool hasMq = hasFieldPrefix("virtio_net_ctrl_mq__");
      const bool hasVlan = hasFieldPrefix("virtio_net_ctrl_vlan__");
      const bool hasGuestOffloads =
          hasFieldPrefix("virtio_net_guest_offloads__");
      const bool hasMacAddr =
          hasFieldPrefix("virtio_net_ctrl_mac_addr__");
      const bool hasRssHdrCanonical =
          hasFieldPrefix("virtio_net_rss_config_hdr__");
      const bool hasRssTrailerCanonical =
          hasFieldPrefix("virtio_net_rss_config_trailer__");
      for (const std::string &field : payload.fields) {
        if (field == "char__value") {
          continue;
        }
        if ((hasMq || hasVlan) &&
            StringRef(field).startswith("control_buf__")) {
          continue;
        }
        if (hasVlan && StringRef(field).startswith("__virtio16__")) {
          continue;
        }
        if (hasGuestOffloads && StringRef(field).startswith("__virtio64__")) {
          continue;
        }
        if (hasMacAddr && StringRef(field).startswith("sockaddr__")) {
          continue;
        }
        if (hasMacAddr && StringRef(field).startswith("net_device__dev_addr")) {
          continue;
        }
        if (hasRssHdrCanonical &&
            StringRef(field).startswith("virtnet_info__rss_hdr")) {
          continue;
        }
        if (hasRssTrailerCanonical &&
            StringRef(field).startswith("virtnet_info__field_46__rss_trailer")) {
          continue;
        }
        filteredFields.push_back(field);
      }
      if (!filteredFields.empty()) {
        payload.fields = std::move(filteredFields);
      }
    }
    const std::string semanticType = inferSemanticTypeFromFields(payload.fields);
    if (!semanticType.empty() &&
        (payload.type.empty() || payload.type == "unknown" ||
         payload.type == "scatterlist" || payload.type == "control_buf" ||
         payload.type == "__virtio64")) {
      payload.type = semanticType;
    }
    if (!payload.type.empty()) {
      std::vector<std::string> matchedFields;
      matchedFields.reserve(payload.fields.size());
      for (const std::string &field : payload.fields) {
        if (fieldMatchesSemanticType(payload.type, field)) {
          matchedFields.push_back(field);
        }
      }
      if (!matchedFields.empty()) {
        payload.fields = std::move(matchedFields);
      } else if (!semanticType.empty() && semanticType != payload.type) {
        std::vector<std::string> semanticFields;
        semanticFields.reserve(payload.fields.size());
        for (const std::string &field : payload.fields) {
          if (fieldMatchesSemanticType(semanticType, field)) {
            semanticFields.push_back(field);
          }
        }
        if (!semanticFields.empty()) {
          payload.type = semanticType;
          payload.fields = std::move(semanticFields);
        }
      }
    }
    std::string merged = sanitizeToken(payload.type);
    for (const std::string &field : payload.fields) {
      if (!merged.empty()) {
        merged.push_back('_');
      }
      merged += sanitizeToken(field);
    }
    StringRef tokens(merged);
    const bool frameLike =
        tokens.contains("xdp_frame") || tokens.contains("ethernet_frame");
    const bool controlLike =
        tokens.contains("virtio_net_ctrl") || tokens.contains("control_buf") ||
        tokens.contains("stats_capabilities") || tokens.contains("sockaddr") ||
        tokens.contains("u8__value") || tokens.contains("__virtio16") ||
        tokens.contains("__virtio64") || tokens.contains("net_device__dev_addr") ||
        tokens.contains("rss_hdr") || tokens.contains("rss_trailer") ||
        tokens.contains("coal_") || tokens.contains("virtqueue_pairs");
    if (frameLike) {
      payload.kind = "ethernet_frame";
      return;
    }
    if (payload.type == "virtio_net_hdr_mrg_rxbuf" ||
        payload.type == "virtio_net_hdr_v1_hash_tunnel") {
      payload.kind = payload.type;
      return;
    }
    if (controlLike) {
      payload.kind = "sg_buffer";
    }
  }

  static void enrichPayloadInfo(DmaPayloadInfo &payload) {
    auto addField = [&](StringRef field) {
      const std::string token = sanitizeToken(field);
      if (token.empty()) {
        return;
      }
      if (std::find(payload.fields.begin(), payload.fields.end(), token) ==
          payload.fields.end()) {
        payload.fields.push_back(token);
      }
    };

    bool hasRssHdr = false;
    for (const std::string &field : payload.fields) {
      if (StringRef(field).startswith("virtnet_info__rss_hdr")) {
        hasRssHdr = true;
        break;
      }
    }
    if (hasRssHdr && (payload.type.empty() || payload.type == "unknown" ||
                      payload.type == "virtnet_info")) {
      payload.type = "virtio_net_rss_config_hdr";
    }

    if (payload.type == "virtio_net_hdr") {
      addField("virtio_net_hdr__flags");
      addField("virtio_net_hdr__gso_type");
      addField("virtio_net_hdr__hdr_len");
      addField("virtio_net_hdr__gso_size");
      addField("virtio_net_hdr__csum_start");
      addField("virtio_net_hdr__csum_offset");
      addField("virtio_net_hdr__num_buffers");
    }

    if (payload.type == "virtio_net_hdr_mrg_rxbuf") {
      addField("virtio_net_hdr_mrg_rxbuf__flags");
      addField("virtio_net_hdr_mrg_rxbuf__gso_type");
      addField("virtio_net_hdr_mrg_rxbuf__hdr_len");
      addField("virtio_net_hdr_mrg_rxbuf__gso_size");
      addField("virtio_net_hdr_mrg_rxbuf__csum_start");
      addField("virtio_net_hdr_mrg_rxbuf__csum_offset");
      addField("virtio_net_hdr_mrg_rxbuf__num_buffers");
    }

    if (payload.type == "virtio_net_hdr_v1_hash_tunnel") {
      addField("virtio_net_hdr_v1_hash_tunnel__flags");
      addField("virtio_net_hdr_v1_hash_tunnel__gso_type");
      addField("virtio_net_hdr_v1_hash_tunnel__hdr_len");
      addField("virtio_net_hdr_v1_hash_tunnel__gso_size");
      addField("virtio_net_hdr_v1_hash_tunnel__csum_start");
      addField("virtio_net_hdr_v1_hash_tunnel__csum_offset");
      addField("virtio_net_hdr_v1_hash_tunnel__num_buffers");
      addField("virtio_net_hdr_v1_hash_tunnel__hash_value_lo");
      addField("virtio_net_hdr_v1_hash_tunnel__hash_value_hi");
      addField("virtio_net_hdr_v1_hash_tunnel__hash_report");
      addField("virtio_net_hdr_v1_hash_tunnel__padding");
      addField("virtio_net_hdr_v1_hash_tunnel__outer_th_offset");
      addField("virtio_net_hdr_v1_hash_tunnel__inner_nh_offset");
    }

    if (payload.type == "virtio_net_ctrl_hdr") {
      addField("virtio_net_ctrl_hdr__class");
      addField("virtio_net_ctrl_hdr__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_mac") {
      addField("virtio_net_ctrl_hdr_mac__class");
      addField("virtio_net_ctrl_hdr_mac__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_vlan_add") {
      addField("virtio_net_ctrl_hdr_vlan_add__class");
      addField("virtio_net_ctrl_hdr_vlan_add__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_vlan_del") {
      addField("virtio_net_ctrl_hdr_vlan_del__class");
      addField("virtio_net_ctrl_hdr_vlan_del__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_mq") {
      addField("virtio_net_ctrl_hdr_mq__class");
      addField("virtio_net_ctrl_hdr_mq__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_guest_offloads") {
      addField("virtio_net_ctrl_hdr_guest_offloads__class");
      addField("virtio_net_ctrl_hdr_guest_offloads__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_coal_tx") {
      addField("virtio_net_ctrl_hdr_coal_tx__class");
      addField("virtio_net_ctrl_hdr_coal_tx__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_coal_rx") {
      addField("virtio_net_ctrl_hdr_coal_rx__class");
      addField("virtio_net_ctrl_hdr_coal_rx__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_coal_vq") {
      addField("virtio_net_ctrl_hdr_coal_vq__class");
      addField("virtio_net_ctrl_hdr_coal_vq__cmd");
    }

    if (payload.type == "virtio_net_ctrl_hdr_queue_stats") {
      addField("virtio_net_ctrl_hdr_queue_stats__class");
      addField("virtio_net_ctrl_hdr_queue_stats__cmd");
    }

    if (payload.type == "virtio_net_ctrl_status") {
      addField("virtio_net_ctrl_status__value");
    }

    if (payload.type == "xdp_frame" && payload.fields.empty()) {
      addField("xdp_frame__data");
    }

    if (payload.type == "ethernet_frame") {
      addField("ethernet_frame__dst");
      addField("ethernet_frame__src");
      addField("ethernet_frame__ethertype");
      addField("ethernet_frame__payload");
    }

    if (payload.type == "sockaddr" && payload.fields.empty()) {
      addField("sockaddr__sa_data");
    }

    if (payload.type == "virtio_net_ctrl_mac_addr") {
      addField("virtio_net_ctrl_mac_addr__mac");
    }

    if (payload.type == "net_device" && payload.fields.empty()) {
      addField("net_device__dev_addr");
      addField("net_device__dev_addr__value");
    }

    if (payload.type == "virtnet_rq_dma" && payload.fields.empty()) {
      addField("virtnet_rq_dma__addr");
      addField("virtnet_rq_dma__addr__value");
      addField("virtnet_rq_dma__ref");
      addField("virtnet_rq_dma__ref__value");
      addField("virtnet_rq_dma__len");
      addField("virtnet_rq_dma__len__value");
      addField("virtnet_rq_dma__need_sync");
      addField("virtnet_rq_dma__need_sync__value");
    }

    if ((payload.type == "xdp_frame" || payload.type == "virtnet_rq_dma") &&
        payload.kind == "ethernet_frame") {
      payload.kind = payload.type;
    }

    if (payload.type == "virtio_net_guest_offloads") {
      addField("virtio_net_guest_offloads__value");
      addField("__virtio64__value");
    }

    if (payload.type == "virtio_net_ctrl_mq") {
      addField("virtio_net_ctrl_mq__virtqueue_pairs");
      addField("virtio_net_ctrl_mq__virtqueue_pairs__value");
    }

    if (payload.type == "virtio_net_ctrl_vlan") {
      addField("virtio_net_ctrl_vlan__vid");
      addField("virtio_net_ctrl_vlan__vid__value");
      addField("__virtio16__value");
    }

    if (payload.type == "virtio_net_rss_config_hdr") {
      addField("virtio_net_rss_config_hdr__hash_types");
      addField("virtio_net_rss_config_hdr__hash_types__value");
      addField("virtio_net_rss_config_hdr__indirection_table_mask");
      addField("virtio_net_rss_config_hdr__indirection_table_mask__value");
      addField("virtio_net_rss_config_hdr__unclassified_queue");
      addField("virtio_net_rss_config_hdr__unclassified_queue__value");
      addField("virtio_net_rss_config_hdr__indirection_table");
      addField("virtnet_info__rss_hdr");
      addField("virtnet_info__rss_hdr__hash_types");
      addField("virtnet_info__rss_hdr__hash_types__value");
      addField("virtnet_info__rss_hdr__indirection_table_mask");
      addField("virtnet_info__rss_hdr__indirection_table_mask__value");
      addField("virtnet_info__rss_hdr__unclassified_queue");
      addField("virtnet_info__rss_hdr__unclassified_queue__value");
      addField("virtnet_info__rss_hdr__indirection_table");
    }

    if (payload.type == "virtio_net_rss_config_trailer") {
      addField("virtio_net_rss_config_trailer__max_tx_vq");
      addField("virtio_net_rss_config_trailer__max_tx_vq__value");
      addField("virtio_net_rss_config_trailer__hash_key_length");
      addField("virtio_net_rss_config_trailer__hash_key_length__value");
      addField("virtio_net_rss_config_trailer__hash_key_data");
      addField("virtnet_info__field_46__rss_trailer");
      addField("virtnet_info__field_46__rss_trailer__max_tx_vq");
      addField("virtnet_info__field_46__rss_trailer__max_tx_vq__value");
      addField("virtnet_info__field_46__rss_trailer__hash_key_length");
      addField("virtnet_info__field_46__rss_trailer__hash_key_length__value");
      addField("virtnet_info__field_46__rss_trailer__hash_key_data");
    }

    if (payload.type == "virtio_net_ctrl_coal_tx") {
      addField("virtio_net_ctrl_coal_tx__tx_max_packets");
      addField("virtio_net_ctrl_coal_tx__tx_max_packets__value");
      addField("virtio_net_ctrl_coal_tx__tx_usecs");
      addField("virtio_net_ctrl_coal_tx__tx_usecs__value");
    }

    if (payload.type == "virtio_net_ctrl_coal_rx") {
      addField("virtio_net_ctrl_coal_rx__rx_max_packets");
      addField("virtio_net_ctrl_coal_rx__rx_max_packets__value");
      addField("virtio_net_ctrl_coal_rx__rx_usecs");
      addField("virtio_net_ctrl_coal_rx__rx_usecs__value");
    }

    if (payload.type == "virtio_net_ctrl_coal_vq") {
      addField("virtio_net_ctrl_coal_vq__vqn");
      addField("virtio_net_ctrl_coal_vq__vqn__value");
      addField("virtio_net_ctrl_coal_vq__reserved");
      addField("virtio_net_ctrl_coal_vq__reserved__value");
      addField("virtio_net_ctrl_coal_vq__max_packets");
      addField("virtio_net_ctrl_coal_vq__max_packets__value");
      addField("virtio_net_ctrl_coal_vq__max_usecs");
      addField("virtio_net_ctrl_coal_vq__max_usecs__value");
    }

    if (payload.type == "virtio_net_ctrl_queue_stats") {
      addField("virtio_net_ctrl_queue_stats__vq_index");
      addField("virtio_net_ctrl_queue_stats__vq_index__value");
      addField("virtio_net_ctrl_queue_stats__reserved");
      addField("virtio_net_ctrl_queue_stats__types_bitmap");
      addField("virtio_net_ctrl_queue_stats__types_bitmap__value");
    }

    if (payload.type == "virtio_net_stats_reply_hdr") {
      addField("virtio_net_stats_reply_hdr__type");
      addField("virtio_net_stats_reply_hdr__reserved");
      addField("virtio_net_stats_reply_hdr__vq_index");
      addField("virtio_net_stats_reply_hdr__vq_index__value");
      addField("virtio_net_stats_reply_hdr__reserved1");
      addField("virtio_net_stats_reply_hdr__size");
      addField("virtio_net_stats_reply_hdr__size__value");
    }
    if (payload.type == "virtio_net_stats_cvq") {
      addField("virtio_net_stats_cvq__type");
      addField("virtio_net_stats_cvq__reserved");
      addField("virtio_net_stats_cvq__vq_index");
      addField("virtio_net_stats_cvq__vq_index__value");
      addField("virtio_net_stats_cvq__reserved1");
      addField("virtio_net_stats_cvq__size");
      addField("virtio_net_stats_cvq__size__value");
      addField("virtio_net_stats_cvq__command_num");
      addField("virtio_net_stats_cvq__ok_num");
    }
    if (payload.type == "virtio_net_stats_rx_basic") {
      addField("virtio_net_stats_rx_basic__type");
      addField("virtio_net_stats_rx_basic__reserved");
      addField("virtio_net_stats_rx_basic__vq_index");
      addField("virtio_net_stats_rx_basic__vq_index__value");
      addField("virtio_net_stats_rx_basic__reserved1");
      addField("virtio_net_stats_rx_basic__size");
      addField("virtio_net_stats_rx_basic__size__value");
      addField("virtio_net_stats_rx_basic__rx_notifications");
      addField("virtio_net_stats_rx_basic__rx_packets");
      addField("virtio_net_stats_rx_basic__rx_bytes");
      addField("virtio_net_stats_rx_basic__rx_interrupts");
      addField("virtio_net_stats_rx_basic__rx_drops");
      addField("virtio_net_stats_rx_basic__rx_drop_overruns");
    }
    if (payload.type == "virtio_net_stats_tx_basic") {
      addField("virtio_net_stats_tx_basic__type");
      addField("virtio_net_stats_tx_basic__reserved");
      addField("virtio_net_stats_tx_basic__vq_index");
      addField("virtio_net_stats_tx_basic__vq_index__value");
      addField("virtio_net_stats_tx_basic__reserved1");
      addField("virtio_net_stats_tx_basic__size");
      addField("virtio_net_stats_tx_basic__size__value");
      addField("virtio_net_stats_tx_basic__tx_notifications");
      addField("virtio_net_stats_tx_basic__tx_packets");
      addField("virtio_net_stats_tx_basic__tx_bytes");
      addField("virtio_net_stats_tx_basic__tx_interrupts");
      addField("virtio_net_stats_tx_basic__tx_drops");
      addField("virtio_net_stats_tx_basic__tx_drop_malformed");
    }
    if (payload.type == "virtio_net_stats_rx_csum") {
      addField("virtio_net_stats_rx_csum__type");
      addField("virtio_net_stats_rx_csum__reserved");
      addField("virtio_net_stats_rx_csum__vq_index");
      addField("virtio_net_stats_rx_csum__vq_index__value");
      addField("virtio_net_stats_rx_csum__reserved1");
      addField("virtio_net_stats_rx_csum__size");
      addField("virtio_net_stats_rx_csum__size__value");
      addField("virtio_net_stats_rx_csum__rx_csum_valid");
      addField("virtio_net_stats_rx_csum__rx_needs_csum");
      addField("virtio_net_stats_rx_csum__rx_csum_none");
      addField("virtio_net_stats_rx_csum__rx_csum_bad");
    }
    if (payload.type == "virtio_net_stats_tx_csum") {
      addField("virtio_net_stats_tx_csum__type");
      addField("virtio_net_stats_tx_csum__reserved");
      addField("virtio_net_stats_tx_csum__vq_index");
      addField("virtio_net_stats_tx_csum__vq_index__value");
      addField("virtio_net_stats_tx_csum__reserved1");
      addField("virtio_net_stats_tx_csum__size");
      addField("virtio_net_stats_tx_csum__size__value");
      addField("virtio_net_stats_tx_csum__tx_csum_none");
      addField("virtio_net_stats_tx_csum__tx_needs_csum");
    }
    if (payload.type == "virtio_net_stats_rx_gso") {
      addField("virtio_net_stats_rx_gso__type");
      addField("virtio_net_stats_rx_gso__reserved");
      addField("virtio_net_stats_rx_gso__vq_index");
      addField("virtio_net_stats_rx_gso__vq_index__value");
      addField("virtio_net_stats_rx_gso__reserved1");
      addField("virtio_net_stats_rx_gso__size");
      addField("virtio_net_stats_rx_gso__size__value");
      addField("virtio_net_stats_rx_gso__rx_gso_packets");
      addField("virtio_net_stats_rx_gso__rx_gso_bytes");
      addField("virtio_net_stats_rx_gso__rx_gso_packets_coalesced");
      addField("virtio_net_stats_rx_gso__rx_gso_bytes_coalesced");
    }
    if (payload.type == "virtio_net_stats_tx_gso") {
      addField("virtio_net_stats_tx_gso__type");
      addField("virtio_net_stats_tx_gso__reserved");
      addField("virtio_net_stats_tx_gso__vq_index");
      addField("virtio_net_stats_tx_gso__vq_index__value");
      addField("virtio_net_stats_tx_gso__reserved1");
      addField("virtio_net_stats_tx_gso__size");
      addField("virtio_net_stats_tx_gso__size__value");
      addField("virtio_net_stats_tx_gso__tx_gso_packets");
      addField("virtio_net_stats_tx_gso__tx_gso_bytes");
      addField("virtio_net_stats_tx_gso__tx_gso_segments");
      addField("virtio_net_stats_tx_gso__tx_gso_segments_bytes");
      addField("virtio_net_stats_tx_gso__tx_gso_packets_noseg");
      addField("virtio_net_stats_tx_gso__tx_gso_bytes_noseg");
    }
    if (payload.type == "virtio_net_stats_rx_speed") {
      addField("virtio_net_stats_rx_speed__type");
      addField("virtio_net_stats_rx_speed__reserved");
      addField("virtio_net_stats_rx_speed__vq_index");
      addField("virtio_net_stats_rx_speed__vq_index__value");
      addField("virtio_net_stats_rx_speed__reserved1");
      addField("virtio_net_stats_rx_speed__size");
      addField("virtio_net_stats_rx_speed__size__value");
      addField("virtio_net_stats_rx_speed__rx_ratelimit_packets");
      addField("virtio_net_stats_rx_speed__rx_ratelimit_bytes");
    }
    if (payload.type == "virtio_net_stats_tx_speed") {
      addField("virtio_net_stats_tx_speed__type");
      addField("virtio_net_stats_tx_speed__reserved");
      addField("virtio_net_stats_tx_speed__vq_index");
      addField("virtio_net_stats_tx_speed__vq_index__value");
      addField("virtio_net_stats_tx_speed__reserved1");
      addField("virtio_net_stats_tx_speed__size");
      addField("virtio_net_stats_tx_speed__size__value");
      addField("virtio_net_stats_tx_speed__tx_ratelimit_packets");
      addField("virtio_net_stats_tx_speed__tx_ratelimit_bytes");
    }

    if (payload.type == "virtio_net_stats_capabilities") {
      addField("virtio_net_stats_capabilities__supported_stats_types");
      addField("virtio_net_stats_capabilities__supported_stats_types__value");
    }

    if (payload.kind == "ethernet_frame" && payload.fields.empty()) {
      forceEthernetFramePayload(payload);
    }

    normalizeMergedPayloadInfo(payload);
  }
