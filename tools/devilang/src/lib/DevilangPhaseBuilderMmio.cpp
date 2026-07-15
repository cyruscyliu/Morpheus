  void collectTraceModelConfigMmioSemantics() {
    for (const TraceModel &trace : model_.traces) {
      for (const TraceBlock &block : trace.blocks) {
        bool pendingReadMany = false;
        for (const std::string &line : block.lines) {
          StringRef text(line);
          if (auto args = parseRenderedCallArgsForName(text, "vm_get")) {
            if (args->size() >= 4) {
              auto offset = parseRenderedUnsigned((*args)[1]);
              auto width = parseRenderedUnsigned((*args)[3]);
              if (offset && width && *width != 0) {
                recordVirtioNetConfigOffsetAccess(*offset,
                                                  static_cast<unsigned>(*width),
                                                  true,
                                                  nullptr,
                                                  "vm_get");
              } else if ((*args)[1] == "phi(0, indvars_iv + 1)" &&
                         width && *width == 1) {
                pendingReadMany = true;
              }
            }
          }
          if (pendingReadMany && text.contains(", 6,")) {
            recordVirtioNetConfigSequentialAccesses(0, 1, 6, true, nullptr,
                                                    "__virtio_cread_many");
            pendingReadMany = false;
          }
          if (auto args = parseRenderedCallArgsForName(text, "virtio_cwrite8")) {
            if (args->size() >= 2 && StringRef((*args)[1]).startswith("phi(0,")) {
              recordVirtioNetConfigSequentialAccesses(0, 1, 6, false, nullptr,
                                                      "virtio_cwrite8");
            }
          }
        }
      }
    }
  }

  void recordMmioImmediate(StringRef schemaName, uint64_t value) {
    model_.schemaLengthImmediates[sanitizeToken(schemaName)].insert(value);
  }

  void recordMmioImmediateRange(StringRef schemaName, uint64_t lo, uint64_t hi) {
    if (lo > hi) {
      std::swap(lo, hi);
    }
    model_.schemaImmediateRanges[sanitizeToken(schemaName)].insert({lo, hi});
  }

  static bool shouldInferImmediateRange(StringRef schemaName) {
    return true;
  }

  static uint64_t immediateRangeMaxSpanForSchema(StringRef schemaName) {
    const std::string token = sanitizeToken(schemaName);
    if (token == "virtio_mmio_queue_sel") {
      return 131072;
    }
    return 64;
  }

  std::optional<std::pair<uint64_t, uint64_t>>
  scalarEvolutionUnsignedRangeFor(const Value *value,
                                  uint64_t maxSpan = 64) {
    if (!value || !functionAnalysisManager_) {
      return std::nullopt;
    }
    if (!value->getType()->isIntegerTy()) {
      return std::nullopt;
    }
    const Function *function = functionForValue(value);
    if (!function || function->isDeclaration()) {
      return std::nullopt;
    }
    llvm::ScalarEvolution &se =
        functionAnalysisManager_->getResult<llvm::ScalarEvolutionAnalysis>(
            *const_cast<Function *>(function));
    const llvm::ConstantRange range =
        se.getUnsignedRange(se.getSCEV(const_cast<Value *>(value)));
    if (!range.isFullSet() && !range.isEmptySet() && !range.isWrappedSet()) {
      const llvm::APInt min = range.getUnsignedMin();
      const llvm::APInt max = range.getUnsignedMax();
      if (!min.isNegative() && !max.isNegative()) {
        const uint64_t lo = min.getZExtValue();
        const uint64_t hi = max.getZExtValue();
        if (hi >= lo && hi - lo <= maxSpan) {
          return std::pair<uint64_t, uint64_t>{lo, hi};
        }
      }
    }
    auto *phi = llvm::dyn_cast<PHINode>(const_cast<Value *>(value));
    if (!phi) {
      return std::nullopt;
    }
    const auto *addRec = llvm::dyn_cast<llvm::SCEVAddRecExpr>(
        se.getSCEV(const_cast<Value *>(value)));
    if (!addRec || !addRec->isAffine()) {
      return std::nullopt;
    }
    const auto *start = llvm::dyn_cast<llvm::SCEVConstant>(addRec->getStart());
    const auto *step = llvm::dyn_cast<llvm::SCEVConstant>(
        addRec->getStepRecurrence(se));
    if (!start || !step) {
      return std::nullopt;
    }
    const llvm::APInt &startValue = start->getAPInt();
    const llvm::APInt &stepValue = step->getAPInt();
    if (startValue.isNegative() || stepValue.isNegative()) {
      return std::nullopt;
    }
    const llvm::Loop *loop = addRec->getLoop();
    if (!loop) {
      return std::nullopt;
    }
    const unsigned maxTripCount = se.getSmallConstantMaxTripCount(loop);
    if (maxTripCount == 0) {
      return std::nullopt;
    }
    const uint64_t startU = startValue.getZExtValue();
    const uint64_t stepU = stepValue.getZExtValue();
    const uint64_t hi = startU + stepU * static_cast<uint64_t>(maxTripCount - 1);
    if (hi < startU || hi - startU > maxSpan) {
      return std::nullopt;
    }
    return std::pair<uint64_t, uint64_t>{startU, hi};
  }

  std::vector<std::pair<std::string, int64_t>>
  fieldRangeHintKeysFor(const Value *base, int64_t byteOffset) {
    std::vector<std::pair<std::string, int64_t>> keys;
    if (!base) {
      return keys;
    }
    const Value *normalizedBase = base->stripPointerCasts();
    std::set<std::string> baseNames;
    const auto maybeAddBaseName = [&](const Value *candidate) {
      if (!candidate) {
        return;
      }
      const std::string candidateName = nameForValue(candidate);
      if (!candidateName.empty() && !isLowSignalLocalName(candidateName)) {
        baseNames.insert(candidateName);
      }
    };
    maybeAddBaseName(normalizedBase);
    for (const User *user : normalizedBase->users()) {
      const auto *instruction = llvm::dyn_cast<Instruction>(user);
      if (!instruction) {
        continue;
      }
      if (instruction->getOpcode() != llvm::Instruction::BitCast &&
          instruction->getOpcode() != llvm::Instruction::AddrSpaceCast) {
        continue;
      }
      maybeAddBaseName(instruction);
    }
    for (const std::string &baseName : baseNames) {
      keys.emplace_back(baseName, byteOffset);
    }
    Type *baseType = normalizedBase->getType();
    if (baseType && baseType->isPointerTy()) {
      if (auto *pointerType = llvm::dyn_cast<llvm::PointerType>(baseType)) {
        if (Type *elementType = pointerType->getNonOpaquePointerElementType()) {
          if (auto *structType = llvm::dyn_cast<llvm::StructType>(elementType)) {
            if (structType->hasName()) {
              const std::string typeKey =
                  "type:" + normalizeTypeName(structType->getName());
              keys.emplace_back(typeKey, byteOffset);
            }
          }
        }
      }
    }
    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    return keys;
  }

  void recordFieldRangeHint(const Value *base,
                            int64_t byteOffset,
                            uint64_t lo,
                            uint64_t hi) {
    if (!base || lo > hi) {
      return;
    }
    for (auto key : fieldRangeHintKeysFor(base, byteOffset)) {
      auto it = fieldRangeHints_.find(key);
      if (it == fieldRangeHints_.end()) {
        fieldRangeHints_.emplace(std::move(key), std::make_pair(lo, hi));
        continue;
      }
      it->second.first = std::min(it->second.first, lo);
      it->second.second = std::max(it->second.second, hi);
    }
  }

  void collectPhaseFieldRangeHints() {
    for (const Function *function : phaseScopeFunctions_) {
      if (!function || function->isDeclaration()) {
        continue;
      }
      for (const BasicBlock &block : *function) {
        for (const Instruction &instruction : block) {
          const auto *store = llvm::dyn_cast<StoreInst>(&instruction);
          if (!store) {
            continue;
          }
          auto offsetInfo = pointerByteOffsetFor(store->getPointerOperand());
          if (!offsetInfo) {
            continue;
          }
          if (fieldRangeHintKeysFor(offsetInfo->first, offsetInfo->second).empty()) {
            continue;
          }
          auto range =
              smallUnsignedRangeFor(store->getValueOperand(), 0, nullptr, 131072);
          if (!range) {
            continue;
          }
          recordFieldRangeHint(offsetInfo->first, offsetInfo->second, range->first,
                               range->second);
        }
      }
    }
  }

  static bool matchesSelfOrSelfPlusOne(const Value *value,
                                       const PHINode *self,
                                       llvm::SmallPtrSetImpl<const Value *> &visited) {
    if (!value || !visited.insert(value).second) {
      return false;
    }
    if (value == self) {
      return true;
    }
    if (const auto *instruction = llvm::dyn_cast<Instruction>(value)) {
      if (instruction->getOpcode() == llvm::Instruction::Add &&
          instruction->getNumOperands() == 2) {
        const Value *lhs = instruction->getOperand(0);
        const Value *rhs = instruction->getOperand(1);
        auto rhsConst = llvm::dyn_cast<ConstantInt>(rhs);
        auto lhsConst = llvm::dyn_cast<ConstantInt>(lhs);
        if (rhsConst && rhsConst->getZExtValue() == 1) {
          llvm::SmallPtrSet<const Value *, 16> nestedVisited;
          nestedVisited.insert(visited.begin(), visited.end());
          if (matchesSelfOrSelfPlusOne(lhs, self, nestedVisited)) {
            return true;
          }
        }
        if (lhsConst && lhsConst->getZExtValue() == 1) {
          llvm::SmallPtrSet<const Value *, 16> nestedVisited;
          nestedVisited.insert(visited.begin(), visited.end());
          if (matchesSelfOrSelfPlusOne(rhs, self, nestedVisited)) {
            return true;
          }
        }
      }
      if (const auto *phi = llvm::dyn_cast<PHINode>(instruction)) {
        bool sawAny = false;
        for (const Value *incoming : phi->incoming_values()) {
          sawAny = true;
          if (const auto *constant = llvm::dyn_cast<ConstantInt>(incoming);
              constant && !constant->isNegative() &&
              constant->getZExtValue() == 0) {
            continue;
          }
          if (!matchesSelfOrSelfPlusOne(incoming, self, visited)) {
            return false;
          }
        }
        return sawAny;
      }
      if (const auto *select = llvm::dyn_cast<llvm::SelectInst>(instruction)) {
        return matchesSelfOrSelfPlusOne(select->getTrueValue(), self, visited) &&
               matchesSelfOrSelfPlusOne(select->getFalseValue(), self, visited);
      }
      switch (instruction->getOpcode()) {
        case llvm::Instruction::BitCast:
        case llvm::Instruction::AddrSpaceCast:
        case llvm::Instruction::PtrToInt:
        case llvm::Instruction::IntToPtr:
        case llvm::Instruction::ZExt:
        case llvm::Instruction::SExt:
        case llvm::Instruction::Trunc:
          return matchesSelfOrSelfPlusOne(instruction->getOperand(0), self, visited);
        default:
          break;
      }
    }
    return false;
  }

  static const Value *stripNoopIntegerCasts(const Value *value) {
    const Value *current = value;
    while (const auto *instruction = llvm::dyn_cast<Instruction>(current)) {
      switch (instruction->getOpcode()) {
        case llvm::Instruction::BitCast:
        case llvm::Instruction::ZExt:
        case llvm::Instruction::SExt:
        case llvm::Instruction::Trunc:
          current = instruction->getOperand(0);
          continue;
        default:
          return current;
      }
    }
    return current;
  }

  static bool matchSignedOffsetAdd(const Value *value,
                                   const Value *base,
                                   int64_t delta) {
    const Value *stripped = stripNoopIntegerCasts(value);
    const auto *instruction = llvm::dyn_cast<Instruction>(stripped);
    if (!instruction || instruction->getOpcode() != llvm::Instruction::Add ||
        instruction->getNumOperands() != 2) {
      return false;
    }
    const Value *lhs = stripNoopIntegerCasts(instruction->getOperand(0));
    const Value *rhs = stripNoopIntegerCasts(instruction->getOperand(1));
    const auto *rhsConst = llvm::dyn_cast<ConstantInt>(rhs);
    const auto *lhsConst = llvm::dyn_cast<ConstantInt>(lhs);
    if (lhs == base && rhsConst && rhsConst->getSExtValue() == delta) {
      return true;
    }
    if (rhs == base && lhsConst && lhsConst->getSExtValue() == delta) {
      return true;
    }
    return false;
  }

  std::optional<std::pair<uint64_t, uint64_t>>
  clampedUnsignedRangeForPhi(const PHINode *phi,
                             uint64_t maxSpan = 65536) {
    if (!phi || !phi->getType()->isIntegerTy() || phi->getNumIncomingValues() != 2) {
      return std::nullopt;
    }
    unsigned constIndex = 2;
    for (unsigned index = 0; index < 2; ++index) {
      if (llvm::isa<ConstantInt>(phi->getIncomingValue(index))) {
        constIndex = index;
        break;
      }
    }
    if (constIndex >= 2) {
      return std::nullopt;
    }
    const unsigned keepIndex = constIndex ^ 1U;
    const auto *constValue =
        llvm::dyn_cast<ConstantInt>(phi->getIncomingValue(constIndex));
    const Value *keptValue = stripNoopIntegerCasts(phi->getIncomingValue(keepIndex));
    const BasicBlock *keepBlock = phi->getIncomingBlock(keepIndex);
    if (!constValue || !keepBlock || constValue->isNegative()) {
      return std::nullopt;
    }
    const BasicBlock *condBlock = keepBlock->getSinglePredecessor();
    if (!condBlock) {
      return std::nullopt;
    }
    const auto *branch = llvm::dyn_cast<BranchInst>(condBlock->getTerminator());
    if (!branch || !branch->isConditional()) {
      return std::nullopt;
    }
    const bool keepOnFalse = branch->getSuccessor(1) == keepBlock;
    if (!keepOnFalse) {
      return std::nullopt;
    }
    const auto *icmp = llvm::dyn_cast<llvm::ICmpInst>(branch->getCondition());
    if (!icmp || icmp->getPredicate() != llvm::ICmpInst::ICMP_SLT) {
      return std::nullopt;
    }
    const Value *lhs = stripNoopIntegerCasts(icmp->getOperand(0));
    const Value *rhs = stripNoopIntegerCasts(icmp->getOperand(1));
    const auto *rhsConst = llvm::dyn_cast<ConstantInt>(rhs);
    if (!rhsConst || rhsConst->getSExtValue() != 0) {
      return std::nullopt;
    }
    const int64_t lower = constValue->getSExtValue();
    if (lower < 0) {
      return std::nullopt;
    }
    if (!matchSignedOffsetAdd(lhs, keptValue, -lower)) {
      return std::nullopt;
    }
    const unsigned bitWidth = phi->getType()->getIntegerBitWidth();
    if (bitWidth == 0 || bitWidth >= 64) {
      return std::nullopt;
    }
    const uint64_t lo = static_cast<uint64_t>(lower);
    const uint64_t hi = lo + ((uint64_t)1 << (bitWidth - 1)) - 1ULL;
    if (hi < lo || hi - lo > maxSpan) {
      return std::nullopt;
    }
    return std::pair<uint64_t, uint64_t>{lo, hi};
  }

  std::optional<std::pair<uint64_t, uint64_t>>
  boundedMonotonicLoopCounterRangeFor(const Value *value,
                                      uint64_t maxSpan = 65536) {
    if (!value || !functionAnalysisManager_) {
      return std::nullopt;
    }
    const auto *self = llvm::dyn_cast<PHINode>(value);
    if (!self) {
      return std::nullopt;
    }
    const Function *function = self->getFunction();
    if (!function || function->isDeclaration()) {
      return std::nullopt;
    }
    llvm::LoopInfo &loopInfo =
        functionAnalysisManager_->getResult<llvm::LoopAnalysis>(
            *const_cast<Function *>(function));
    llvm::Loop *loop = loopInfo.getLoopFor(self->getParent());
    if (!loop || loop->getHeader() != self->getParent()) {
      return std::nullopt;
    }
    bool sawOutsideZero = false;
    for (unsigned index = 0; index < self->getNumIncomingValues(); ++index) {
      const BasicBlock *pred = self->getIncomingBlock(index);
      const Value *incoming = self->getIncomingValue(index);
      if (!loop->contains(pred)) {
        auto constant = constantValueFor(incoming);
        if (constant && *constant == 0) {
          sawOutsideZero = true;
          break;
        }
      }
    }
    if (!sawOutsideZero) {
      return std::nullopt;
    }
    llvm::ScalarEvolution &se =
        functionAnalysisManager_->getResult<llvm::ScalarEvolutionAnalysis>(
            *const_cast<Function *>(function));
    const auto *selfAddRec = llvm::dyn_cast<llvm::SCEVAddRecExpr>(
        se.getSCEV(const_cast<PHINode *>(self)));
    bool selfLooksCanonical = false;
    if (selfAddRec && selfAddRec->isAffine() && selfAddRec->getLoop() == loop) {
      const auto *start = llvm::dyn_cast<llvm::SCEVConstant>(selfAddRec->getStart());
      const auto *step =
          llvm::dyn_cast<llvm::SCEVConstant>(selfAddRec->getStepRecurrence(se));
      if (start && step && !start->getAPInt().isNegative() &&
          !step->getAPInt().isNegative() && start->getAPInt().getZExtValue() == 0 &&
          step->getAPInt().getZExtValue() == 1) {
        selfLooksCanonical = true;
      }
    }
    if (!selfLooksCanonical) {
      bool sawBackedge = false;
      for (unsigned index = 0; index < self->getNumIncomingValues(); ++index) {
        const BasicBlock *pred = self->getIncomingBlock(index);
        const Value *incoming = self->getIncomingValue(index);
        if (!loop->contains(pred)) {
          continue;
        }
        llvm::SmallPtrSet<const Value *, 16> visited;
        if (!matchesSelfOrSelfPlusOne(incoming, self, visited)) {
          continue;
        }
        sawBackedge = true;
      }
    }
    const BasicBlock *latch = loop->getLoopLatch();
    if (!latch) {
      return std::nullopt;
    }
    const auto *branch = llvm::dyn_cast<BranchInst>(latch->getTerminator());
    if (!branch || !branch->isConditional()) {
      return std::nullopt;
    }
    const auto *icmp = llvm::dyn_cast<llvm::ICmpInst>(branch->getCondition());
    if (!icmp) {
      return std::nullopt;
    }
    auto matchesCanonicalIvNext = [&](const Value *candidate,
                                      const PHINode *phi) -> bool {
      if (candidate == phi) {
        return true;
      }
      const auto *instruction = llvm::dyn_cast<Instruction>(candidate);
      if (!instruction || instruction->getOpcode() != llvm::Instruction::Add ||
          instruction->getNumOperands() != 2) {
        return false;
      }
      const Value *lhs = instruction->getOperand(0);
      const Value *rhs = instruction->getOperand(1);
      const auto *rhsConst = llvm::dyn_cast<ConstantInt>(rhs);
      const auto *lhsConst = llvm::dyn_cast<ConstantInt>(lhs);
      return (lhs == phi && rhsConst && rhsConst->getZExtValue() == 1) ||
             (rhs == phi && lhsConst && lhsConst->getZExtValue() == 1);
    };
    const Value *boundValue = nullptr;
    for (const Instruction &instruction : *loop->getHeader()) {
      const auto *phi = llvm::dyn_cast<PHINode>(&instruction);
      if (!phi || phi == self) {
        continue;
      }
      bool zeroStart = false;
      bool unitStep = false;
      for (unsigned index = 0; index < phi->getNumIncomingValues(); ++index) {
        const BasicBlock *pred = phi->getIncomingBlock(index);
        const Value *incoming = phi->getIncomingValue(index);
        if (!loop->contains(pred)) {
          auto constant = constantValueFor(incoming);
          zeroStart = constant && *constant == 0;
          continue;
        }
        unitStep = matchesCanonicalIvNext(incoming, phi);
      }
      if (!zeroStart || !unitStep) {
        continue;
      }
      if (matchesCanonicalIvNext(icmp->getOperand(0), phi)) {
        boundValue = icmp->getOperand(1);
        break;
      }
      if (matchesCanonicalIvNext(icmp->getOperand(1), phi)) {
        boundValue = icmp->getOperand(0);
        break;
      }
    }
    if (!boundValue) {
      return std::nullopt;
    }
    auto boundRange = smallUnsignedRangeFor(boundValue, 1, nullptr, maxSpan + 1);
    if (!boundRange || boundRange->second == 0) {
      return std::nullopt;
    }
    const uint64_t hi = boundRange->second - 1;
    if (hi > maxSpan) {
      return std::nullopt;
    }
    return std::pair<uint64_t, uint64_t>{0, hi};
  }

  std::optional<std::pair<uint64_t, uint64_t>>
  smallUnsignedRangeFor(const Value *value,
                        unsigned depth = 0,
                        llvm::SmallPtrSet<const Value *, 16> *visitedArg = nullptr,
                        uint64_t maxSpan = 64) {
    if (!value || depth > 4) {
      return std::nullopt;
    }
    llvm::SmallPtrSet<const Value *, 16> localVisited;
    llvm::SmallPtrSet<const Value *, 16> &visited =
        visitedArg ? *visitedArg : localVisited;
    if (!visited.insert(value).second) {
      return std::nullopt;
    }
    if (auto constant = constantValueFor(value)) {
      return std::pair<uint64_t, uint64_t>{*constant, *constant};
    }
    if (const auto *phi = llvm::dyn_cast<PHINode>(value)) {
      if (auto clampedRange = clampedUnsignedRangeForPhi(phi, maxSpan)) {
        return clampedRange;
      }
      if (auto boundedCounterRange =
              boundedMonotonicLoopCounterRangeFor(value, maxSpan)) {
        return boundedCounterRange;
      }
    }
    if (auto seRange = scalarEvolutionUnsignedRangeFor(value, maxSpan)) {
      return seRange;
    }
    if (const auto *argument = llvm::dyn_cast<llvm::Argument>(value)) {
      std::optional<std::pair<uint64_t, uint64_t>> out;
      bool sawAny = false;
      forEachPhaseCallsiteToFunction(
          *argument->getParent(), [&](const CallBase &callsite) {
            if (argument->getArgNo() >= callsite.arg_size()) {
              return;
            }
            auto incoming =
                smallUnsignedRangeFor(callsite.getArgOperand(argument->getArgNo()),
                                      depth + 1, &visited, maxSpan);
            if (!incoming) {
              return;
            }
            sawAny = true;
            if (!out) {
              out = incoming;
              return;
            }
            out->first = std::min(out->first, incoming->first);
            out->second = std::max(out->second, incoming->second);
          });
      if (!sawAny || !out) {
        return std::nullopt;
      }
      if (out->second - out->first > maxSpan) {
        return std::nullopt;
      }
      return out;
    }
    const auto *phi = llvm::dyn_cast<PHINode>(value);
    if (phi) {
      std::optional<std::pair<uint64_t, uint64_t>> out;
      bool sawAny = false;
      for (const Value *incoming : phi->incoming_values()) {
        auto incomingRange =
            smallUnsignedRangeFor(incoming, depth + 1, visitedArg, maxSpan);
        if (!incomingRange) {
          continue;
        }
        sawAny = true;
        if (!out) {
          out = incomingRange;
          continue;
        }
        out->first = std::min(out->first, incomingRange->first);
        out->second = std::max(out->second, incomingRange->second);
      }
      if (!sawAny || !out) {
        return std::nullopt;
      }
      if (out->second - out->first > maxSpan) {
        return std::nullopt;
      }
      return out;
    }
    const auto *select = llvm::dyn_cast<llvm::SelectInst>(value);
    if (select) {
      auto lhs = smallUnsignedRangeFor(select->getTrueValue(), depth + 1,
                                       visitedArg, maxSpan);
      auto rhs = smallUnsignedRangeFor(select->getFalseValue(), depth + 1,
                                       visitedArg, maxSpan);
      if (!lhs || !rhs) {
        return std::nullopt;
      }
      const uint64_t lo = std::min(lhs->first, rhs->first);
      const uint64_t hi = std::max(lhs->second, rhs->second);
      if (hi - lo > maxSpan) {
        return std::nullopt;
      }
      return std::pair<uint64_t, uint64_t>{lo, hi};
    }
    const auto *instruction = llvm::dyn_cast<Instruction>(value);
    if (!instruction) {
      return std::nullopt;
    }
    if (const auto *load = llvm::dyn_cast<LoadInst>(instruction)) {
      if (auto offsetInfo = pointerByteOffsetFor(load->getPointerOperand())) {
        for (const auto &key :
             fieldRangeHintKeysFor(offsetInfo->first, offsetInfo->second)) {
          auto it = fieldRangeHints_.find(key);
          if (it == fieldRangeHints_.end()) {
            continue;
          }
          const auto &[lo, hi] = it->second;
          if (hi >= lo && hi - lo <= maxSpan) {
            return it->second;
          }
        }
      }
      if (const Value *stored =
              findStoredValueForPointer(load->getPointerOperand(), load)) {
        return smallUnsignedRangeFor(stored, depth + 1, visitedArg, maxSpan);
      }
      if (const Value *stored =
              findInterproceduralStoredValueForPointer(load->getPointerOperand(),
                                                       load)) {
        return smallUnsignedRangeFor(stored, depth + 1, visitedArg, maxSpan);
      }
    }
    switch (instruction->getOpcode()) {
      case llvm::Instruction::BitCast:
      case llvm::Instruction::AddrSpaceCast:
      case llvm::Instruction::PtrToInt:
      case llvm::Instruction::IntToPtr:
      case llvm::Instruction::ZExt:
      case llvm::Instruction::SExt:
      case llvm::Instruction::Trunc:
        return smallUnsignedRangeFor(instruction->getOperand(0), depth + 1,
                                     visitedArg, maxSpan);
      case llvm::Instruction::Add: {
        auto lhs = smallUnsignedRangeFor(instruction->getOperand(0), depth + 1,
                                         visitedArg, maxSpan);
        auto rhsConst = constantValueFor(instruction->getOperand(1));
        if (lhs && rhsConst) {
          const uint64_t lo = lhs->first + *rhsConst;
          const uint64_t hi = lhs->second + *rhsConst;
          if (hi >= lo && hi - lo <= maxSpan) {
            return std::pair<uint64_t, uint64_t>{lo, hi};
          }
        }
        auto rhs = smallUnsignedRangeFor(instruction->getOperand(1), depth + 1,
                                         visitedArg, maxSpan);
        auto lhsConst = constantValueFor(instruction->getOperand(0));
        if (rhs && lhsConst) {
          const uint64_t lo = rhs->first + *lhsConst;
          const uint64_t hi = rhs->second + *lhsConst;
          if (hi >= lo && hi - lo <= maxSpan) {
            return std::pair<uint64_t, uint64_t>{lo, hi};
          }
        }
        return std::nullopt;
      }
      case llvm::Instruction::Shl: {
        auto lhs = smallUnsignedRangeFor(instruction->getOperand(0), depth + 1,
                                         visitedArg, maxSpan);
        auto shift = constantValueFor(instruction->getOperand(1));
        if (!lhs || !shift || *shift >= 63) {
          return std::nullopt;
        }
        const uint64_t lo = lhs->first << *shift;
        const uint64_t hi = lhs->second << *shift;
        if (hi < lo || hi - lo > maxSpan) {
          return std::nullopt;
        }
        return std::pair<uint64_t, uint64_t>{lo, hi};
      }
      case llvm::Instruction::Or: {
        auto lhs = smallUnsignedRangeFor(instruction->getOperand(0), depth + 1,
                                         visitedArg, maxSpan);
        auto rhs = smallUnsignedRangeFor(instruction->getOperand(1), depth + 1,
                                         visitedArg, maxSpan);
        if (!lhs || !rhs) {
          return std::nullopt;
        }
        const uint64_t rhsWidth = rhs->second - rhs->first;
        if (rhs->first == 0 && rhs->second <= 1 && lhs->second <= UINT64_MAX - rhs->second) {
          const uint64_t lo = lhs->first | rhs->first;
          const uint64_t hi = lhs->second | rhs->second;
          if (hi >= lo && hi - lo <= maxSpan) {
            return std::pair<uint64_t, uint64_t>{lo, hi};
          }
        }
        if (lhs->first == 0 && lhs->second <= 1 && rhs->second <= UINT64_MAX - lhs->second) {
          const uint64_t lo = rhs->first | lhs->first;
          const uint64_t hi = rhs->second | lhs->second;
          if (hi >= lo && hi - lo <= maxSpan) {
            return std::pair<uint64_t, uint64_t>{lo, hi};
          }
        }
        if (rhsWidth == 0 && lhs->second <= UINT64_MAX - rhs->second) {
          const uint64_t lo = lhs->first | rhs->first;
          const uint64_t hi = lhs->second | rhs->second;
          if (hi >= lo && hi - lo <= maxSpan) {
            return std::pair<uint64_t, uint64_t>{lo, hi};
          }
        }
        return std::nullopt;
      }
      default:
        return std::nullopt;
    }
  }

  void recordMmioBitMask(StringRef schemaName, uint64_t mask, int bitBase = 0) {
    auto &ranges = model_.mmioObservedBitRanges[sanitizeToken(schemaName)];
    insertMaskBitRanges(ranges, mask, bitBase);
  }

  void recordMmioBitMaskForSelector(StringRef schemaName,
                                    unsigned selector,
                                    uint64_t mask,
                                    int bitBase = 0) {
    auto &ranges =
        model_.mmioObservedBitRangesBySelector[sanitizeToken(schemaName)][selector];
    insertMaskBitRanges(ranges, mask, bitBase);
  }

  void recordMmioBitIndex(StringRef schemaName, uint64_t bitIndex) {
    if (bitIndex >= 64) {
      return;
    }
    recordMmioBitMask(schemaName, 1ULL << bitIndex);
  }

  void recordVirtioFeatureBitSemantics(uint64_t featureBit) {
    // virtio-mmio config ops negotiate features through a u64 view.
    if (featureBit >= 64ULL) {
      return;
    }
    const unsigned selector = static_cast<unsigned>(featureBit / 32ULL);
    const uint64_t registerBit = featureBit % 32ULL;
    recordMmioBitMaskForSelector("virtio_mmio_device_features", selector,
                                 1ULL << registerBit);
    recordMmioImmediate("virtio_mmio_device_features_sel", selector);
  }

  static std::string featureDecisionCategoryForFunction(StringRef functionName) {
    if (functionName.contains("validate") ||
        functionName.contains("fail_on_feature")) {
      return "validate";
    }
    if (functionName.contains("find_vq") ||
        functionName.contains("setup_vq") ||
        functionName.contains("set_queues") ||
        functionName.contains("xsk_pool")) {
      return "vq";
    }
    if (functionName.contains("status") ||
        functionName.contains("device_ready") ||
        functionName.contains("add_status")) {
      return "status";
    }
    return "probe";
  }

  void recordVirtioFeatureDecisionSemantics(uint64_t featureBit,
                                            StringRef functionName) {
    recordVirtioFeatureBitSemantics(featureBit);
    if (featureBit >= 64ULL) {
      return;
    }
    const std::string category = featureDecisionCategoryForFunction(functionName);
    if (category.empty()) {
      return;
    }
    const unsigned selector = static_cast<unsigned>(featureBit / 32ULL);
    const uint64_t registerBit = featureBit % 32ULL;
    recordMmioBitMaskForSelector(
        sanitizeToken("virtio_mmio_device_features__" + category), selector,
        1ULL << registerBit);
  }

  bool featureQueryAffectsDecision(const Value *root) {
    if (!root) {
      return false;
    }
    const Function *rootFunction = functionForValue(root);
    llvm::SmallPtrSet<const Value *, 32> visited;
    llvm::SmallVector<const Value *, 16> worklist;
    worklist.push_back(root);
    const auto branchAffectsRelevantBehavior =
        [&](const BranchInst &branch) -> bool {
          if (!branch.isConditional()) {
            return false;
          }
          const BasicBlock *trueBlock = branch.getSuccessor(0);
          const BasicBlock *falseBlock = branch.getSuccessor(1);
          const BasicBlock *resolvedTrue =
              trueBlock && !isBlockRelevant(*trueBlock)
                  ? resolveRelevantSuccessor(trueBlock)
                  : trueBlock;
          const BasicBlock *resolvedFalse =
              falseBlock && !isBlockRelevant(*falseBlock)
                  ? resolveRelevantSuccessor(falseBlock)
                  : falseBlock;
          const bool trueRelevant = resolvedTrue && isBlockRelevant(*resolvedTrue);
          const bool falseRelevant =
              resolvedFalse && isBlockRelevant(*resolvedFalse);
          if (trueRelevant != falseRelevant) {
            return true;
          }
          if (trueRelevant && falseRelevant && resolvedTrue != resolvedFalse) {
            return true;
          }
          const bool trueExit = trueBlock && blockReachesExit(*trueBlock);
          const bool falseExit = falseBlock && blockReachesExit(*falseBlock);
          return trueExit != falseExit;
        };
    const auto switchAffectsRelevantBehavior =
        [&](const SwitchInst &switchInst) -> bool {
          llvm::SmallPtrSet<const BasicBlock *, 8> relevantTargets;
          bool sawExitOnly = false;
          for (unsigned index = 0; index < switchInst.getNumSuccessors(); ++index) {
            const BasicBlock *successor = switchInst.getSuccessor(index);
            const BasicBlock *resolved =
                successor && !isBlockRelevant(*successor)
                    ? resolveRelevantSuccessor(successor)
                    : successor;
            if (resolved && isBlockRelevant(*resolved)) {
              relevantTargets.insert(resolved);
              continue;
            }
            if (successor && blockReachesExit(*successor)) {
              sawExitOnly = true;
            }
          }
          return relevantTargets.size() > 1 ||
                 (sawExitOnly && !relevantTargets.empty());
        };

    while (!worklist.empty()) {
      const Value *current = worklist.pop_back_val();
      if (!current || !visited.insert(current).second) {
        continue;
      }
      for (const User *user : current->users()) {
        const auto *instruction = llvm::dyn_cast<Instruction>(user);
        if (!instruction) {
          continue;
        }
        if (rootFunction && instruction->getFunction() != rootFunction) {
          continue;
        }
        if (const auto *branch = llvm::dyn_cast<BranchInst>(instruction)) {
          if (!branch->isConditional() || branch->getCondition() != current) {
            continue;
          }
          if (branchAffectsRelevantBehavior(*branch)) {
            return true;
          }
          continue;
        }
        if (const auto *switchInst = llvm::dyn_cast<SwitchInst>(instruction)) {
          if (switchInst->getCondition() == current &&
              switchAffectsRelevantBehavior(*switchInst)) {
            return true;
          }
          continue;
        }
        if (const auto *select = llvm::dyn_cast<llvm::SelectInst>(instruction)) {
          worklist.push_back(select);
          continue;
        }
        if (const auto *call = llvm::dyn_cast<CallBase>(instruction)) {
          for (const Value *arg : call->args()) {
            if (arg != current) {
              continue;
            }
            const Function *callCallee = llvm::dyn_cast<Function>(
                call->getCalledOperand()->stripPointerCasts());
            if (callCallee && !callCallee->isIntrinsic() &&
                !isPrunedHelper(callCallee->getName()) &&
                (isObservableCall(*call) || functionInPhaseScope(callCallee))) {
              return true;
            }
          }
        }
        if (llvm::isa<PHINode>(instruction) ||
            llvm::isa<llvm::ICmpInst>(instruction) ||
            llvm::isa<llvm::FCmpInst>(instruction)) {
          worklist.push_back(instruction);
          continue;
        }
        switch (instruction->getOpcode()) {
          case llvm::Instruction::BitCast:
          case llvm::Instruction::AddrSpaceCast:
          case llvm::Instruction::PtrToInt:
          case llvm::Instruction::IntToPtr:
          case llvm::Instruction::ZExt:
          case llvm::Instruction::SExt:
          case llvm::Instruction::Trunc:
          case llvm::Instruction::And:
          case llvm::Instruction::Or:
          case llvm::Instruction::Xor:
            worklist.push_back(instruction);
            break;
          default:
            break;
        }
      }
    }
    return false;
  }

  static void collectDriverFeatureBitsFromArray(const llvm::GlobalVariable *global,
                                                std::optional<uint64_t> limit,
                                                std::map<unsigned, std::set<uint64_t>> &out) {
    const llvm::Constant *init = global ? global->getInitializer() : nullptr;
    if (!init) {
      return;
    }
    if (const auto *dataSeq =
            llvm::dyn_cast<llvm::ConstantDataSequential>(init)) {
      const uint64_t count = std::min<uint64_t>(
          limit.value_or(dataSeq->getNumElements()), dataSeq->getNumElements());
      for (uint64_t index = 0; index < count; ++index) {
        const uint64_t featureBit = dataSeq->getElementAsInteger(index);
        if (featureBit >= 64ULL) {
          continue;
        }
        out[static_cast<unsigned>(featureBit / 32ULL)].insert(featureBit % 32ULL);
      }
      return;
    }
    if (const auto *array = llvm::dyn_cast<llvm::ConstantArray>(init)) {
      const uint64_t count = std::min<uint64_t>(
          limit.value_or(array->getNumOperands()), array->getNumOperands());
      for (uint64_t index = 0; index < count; ++index) {
        const auto *value =
            llvm::dyn_cast<llvm::ConstantInt>(array->getOperand(index));
        if (!value) {
          continue;
        }
        const uint64_t featureBit = value->getZExtValue();
        if (featureBit >= 64ULL) {
          continue;
        }
        out[static_cast<unsigned>(featureBit / 32ULL)].insert(featureBit % 32ULL);
      }
    }
  }

  void collectPhaseDriverFeatureTableSemantics() {
    std::map<unsigned, std::set<uint64_t>> bitsBySelector;
    for (const llvm::GlobalVariable &global : module_.globals()) {
      if (!global.hasInitializer()) {
        continue;
      }
      const auto *structTy =
          llvm::dyn_cast<llvm::StructType>(global.getValueType());
      if (!structTy || !structTy->hasName() ||
          !structTy->getName().contains("virtio_driver")) {
        continue;
      }
      const auto *init =
          llvm::dyn_cast<llvm::ConstantStruct>(global.getInitializer());
      if (!init || init->getNumOperands() < 6) {
        continue;
      }
      bool relevant = false;
      for (unsigned index = 0; index < init->getNumOperands(); ++index) {
        if (const auto *fn = llvm::dyn_cast<Function>(
                init->getOperand(index)->stripPointerCasts())) {
          if (functionInPhaseScope(fn)) {
            relevant = true;
            break;
          }
        }
      }
      if (!relevant) {
        continue;
      }
      auto collectTable = [&](unsigned ptrIndex, unsigned sizeIndex) {
        const auto *arrayGlobal = llvm::dyn_cast<llvm::GlobalVariable>(
            init->getOperand(ptrIndex)->stripPointerCasts());
        const auto *sizeValue =
            llvm::dyn_cast<llvm::ConstantInt>(init->getOperand(sizeIndex));
        if (!arrayGlobal || !sizeValue) {
          return;
        }
        collectDriverFeatureBitsFromArray(arrayGlobal, sizeValue->getZExtValue(),
                                          bitsBySelector);
      };
      collectTable(2, 3);
      collectTable(4, 5);
    }
    for (const auto &[selector, bits] : bitsBySelector) {
      recordMmioImmediate("virtio_mmio_driver_features_sel", selector);
      for (uint64_t bit : bits) {
        recordMmioBitMaskForSelector("virtio_mmio_driver_features", selector,
                                     1ULL << bit);
      }
    }
  }

  bool shouldRecordReadCompareImmediate(StringRef schemaName) const {
    const auto info = lookupVirtioMmioRegisterInfoBySchemaName(schemaName);
    if (!info) {
      return true;
    }
    return info->valueKind == VirtioMmioRegisterInfo::ValueKind::Immediate;
  }

  void collectPhaseMmioValueSemantics() {
    for (const Function *function : phaseScopeFunctions_) {
      if (!function || function->isDeclaration()) {
        continue;
      }
      for (const BasicBlock &block : *function) {
        for (const Instruction &instruction : block) {
          const auto *call = llvm::dyn_cast<CallBase>(&instruction);
          if (!call) {
            continue;
          }
          const Function *callee = llvm::dyn_cast<Function>(
              call->getCalledOperand()->stripPointerCasts());
          if (!callee) {
            continue;
          }
          const StringRef calleeName = callee->getName();
          if ((calleeName == "virtio_has_feature" ||
               calleeName == "__virtio_test_bit") &&
              call->arg_size() >= 2) {
            if (auto featureBit = constantValueFor(call->getArgOperand(1));
                featureBit && featureQueryAffectsDecision(call)) {
              recordVirtioFeatureDecisionSemantics(*featureBit,
                                                  function->getName());
            }
            continue;
          }
          if (calleeName == "virtio_add_status" && call->arg_size() >= 2) {
            if (auto status = constantValueFor(call->getArgOperand(1))) {
              recordMmioImmediate("virtio_mmio_status", *status);
              recordMmioBitMask("virtio_mmio_status", *status);
            }
            continue;
          }
        }
      }
    }
  }

  static bool isVirtioDeviceIdTableGlobal(const llvm::GlobalVariable &global) {
    const auto *arrayTy = llvm::dyn_cast<llvm::ArrayType>(global.getValueType());
    if (!arrayTy) {
      return false;
    }
    const auto *structTy =
        llvm::dyn_cast<llvm::StructType>(arrayTy->getElementType());
    if (!structTy || structTy->getNumElements() < 2) {
      return false;
    }
    return structTy->getElementType(0)->isIntegerTy(32) &&
           structTy->getElementType(1)->isIntegerTy(32);
  }

  static void collectVirtioDeviceIdsFromTable(const llvm::GlobalVariable &global,
                                              std::set<uint64_t> &ids) {
    const auto *initializer = global.getInitializer();
    const auto *array = llvm::dyn_cast_or_null<llvm::ConstantArray>(initializer);
    if (!array) {
      return;
    }
    for (unsigned index = 0; index < array->getNumOperands(); ++index) {
      const auto *entry =
          llvm::dyn_cast<llvm::ConstantStruct>(array->getOperand(index));
      if (!entry || entry->getNumOperands() < 1) {
        continue;
      }
      auto *deviceId = llvm::dyn_cast<llvm::ConstantInt>(entry->getOperand(0));
      if (!deviceId) {
        continue;
      }
      const uint64_t id = deviceId->getZExtValue();
      if (id == 0) {
        continue;
      }
      ids.insert(id);
    }
  }

  void collectPhaseDeviceIdSemantics() {
    llvm::SmallVector<const Function *, 8> matchedEntries;
    for (const std::string &entryName : request_.entryFunctions) {
      if (const Function *entry = module_.getFunction(entryName)) {
        matchedEntries.push_back(entry);
      }
    }
    if (matchedEntries.empty()) {
      return;
    }

    std::set<uint64_t> ids;
    for (const llvm::GlobalVariable &global : module_.globals()) {
      if (!global.hasInitializer()) {
        continue;
      }
      const auto *structTy =
          llvm::dyn_cast<llvm::StructType>(global.getValueType());
      if (!structTy || !structTy->hasName() ||
          !structTy->getName().contains("virtio_driver")) {
        continue;
      }

      bool matchesEntry = false;
      for (unsigned index = 0; index < global.getInitializer()->getNumOperands();
           ++index) {
        const Value *operand =
            global.getInitializer()->getOperand(index)->stripPointerCasts();
        for (const Function *entry : matchedEntries) {
          if (operand == entry) {
            matchesEntry = true;
            break;
          }
        }
        if (matchesEntry) {
          break;
        }
      }
      if (!matchesEntry) {
        continue;
      }

      for (unsigned index = 0; index < global.getInitializer()->getNumOperands();
           ++index) {
        const Value *operand =
            global.getInitializer()->getOperand(index)->stripPointerCasts();
        const auto *table =
            llvm::dyn_cast<llvm::GlobalVariable>(operand);
        if (!table || !isVirtioDeviceIdTableGlobal(*table)) {
          continue;
        }
        collectVirtioDeviceIdsFromTable(*table, ids);
      }
    }

    for (uint64_t id : ids) {
      recordMmioImmediate("virtio_mmio_device_id", id);
    }
  }

  void observeVirtioMmioReadValueSemantics(StringRef schemaName,
                                           const Value *root) {
    if (!root) {
      return;
    }
    const bool recordCompareImmediates =
        shouldRecordReadCompareImmediate(schemaName);
    const Function *rootFunction = functionForValue(root);
    std::set<MmioValueSlice> visited;
    llvm::SmallVector<MmioValueSlice, 16> worklist;
    worklist.push_back({root, 0});

    while (!worklist.empty()) {
      const MmioValueSlice slice = worklist.pop_back_val();
      if (!slice.value || !visited.insert(slice).second) {
        continue;
      }
      if (visited.size() > kMaxMmioSemanticSlices) {
        break;
      }
      for (const User *user : slice.value->users()) {
        const auto *instruction = llvm::dyn_cast<Instruction>(user);
        if (!instruction) {
          continue;
        }
        if (rootFunction && instruction->getFunction() != rootFunction) {
          continue;
        }
        if (const auto *icmp = llvm::dyn_cast<llvm::ICmpInst>(instruction)) {
          const Value *other =
              icmp->getOperand(0) == slice.value ? icmp->getOperand(1)
                                                 : icmp->getOperand(0);
          if (recordCompareImmediates) {
            if (auto constant = constantValueFor(other)) {
              recordMmioImmediate(schemaName, *constant);
            }
          }
          continue;
        }
        if (const auto *switchInst = llvm::dyn_cast<SwitchInst>(instruction)) {
          if (switchInst->getCondition() != slice.value) {
            continue;
          }
          if (!recordCompareImmediates) {
            continue;
          }
          for (const auto &caseHandle : switchInst->cases()) {
            recordMmioImmediate(schemaName,
                                caseHandle.getCaseValue()->getZExtValue());
          }
          continue;
        }
        if (const auto *phi = llvm::dyn_cast<PHINode>(instruction)) {
          worklist.push_back({phi, slice.bitBase});
          continue;
        }
        if (const auto *select = llvm::dyn_cast<llvm::SelectInst>(instruction)) {
          worklist.push_back({select, slice.bitBase});
          continue;
        }
        switch (instruction->getOpcode()) {
          case llvm::Instruction::BitCast:
          case llvm::Instruction::AddrSpaceCast:
          case llvm::Instruction::PtrToInt:
          case llvm::Instruction::IntToPtr:
          case llvm::Instruction::ZExt:
          case llvm::Instruction::SExt:
            worklist.push_back({instruction, slice.bitBase});
            break;
          case llvm::Instruction::Trunc:
            if (instruction->getType()->isIntegerTy()) {
              const unsigned width = instruction->getType()->getIntegerBitWidth();
              if (width != 0) {
                recordMmioBitMask(
                    schemaName,
                    width >= 64 ? std::numeric_limits<uint64_t>::max()
                                : ((1ULL << width) - 1ULL),
                    slice.bitBase);
              }
            }
            worklist.push_back({instruction, slice.bitBase});
            break;
          case llvm::Instruction::And: {
            const Value *other =
                instruction->getOperand(0) == slice.value
                    ? instruction->getOperand(1)
                    : instruction->getOperand(0);
            if (auto mask = constantValueFor(other)) {
              recordMmioBitMask(schemaName, *mask, slice.bitBase);
            }
            worklist.push_back({instruction, slice.bitBase});
            break;
          }
          case llvm::Instruction::LShr: {
            auto shift = constantValueFor(instruction->getOperand(1));
            if (!shift || *shift > std::numeric_limits<int>::max()) {
              break;
            }
            worklist.push_back(
                {instruction, slice.bitBase + static_cast<int>(*shift)});
            break;
          }
          case llvm::Instruction::Shl: {
            auto shift = constantValueFor(instruction->getOperand(1));
            if (!shift || *shift > std::numeric_limits<int>::max()) {
              break;
            }
            worklist.push_back(
                {instruction, slice.bitBase - static_cast<int>(*shift)});
            break;
          }
          default:
            break;
        }
      }
    }
  }

  void observeVirtioMmioWriteValueSemantics(StringRef schemaName,
                                            const Value *root,
                                            int bitBase = 0,
                                            unsigned depth = 0) {
    if (!root) {
      return;
    }
    if (depth > 4) {
      return;
    }
    const Function *rootFunction = functionForValue(root);
    std::set<MmioValueSlice> visited;
    llvm::SmallVector<MmioValueSlice, 16> worklist;
    worklist.push_back({root, bitBase});
    const auto recordNarrowIntegerWidth = [&](Type *type, int sliceBitBase) {
      if (!type || !type->isIntegerTy()) {
        return;
      }
      const unsigned width = type->getIntegerBitWidth();
      if (width == 0 || width >= 32) {
        return;
      }
      recordMmioBitMask(schemaName, (1ULL << width) - 1ULL, sliceBitBase);
    };
    const auto observeCallResultSemantics =
        [&](const CallBase &call, int sliceBitBase) {
          if (depth >= 4) {
            return;
          }
          llvm::SmallPtrSet<const Function *, 8> visitedCallees;
          const auto observeCalleeReturns = [&](const Function &callee) {
            if (callee.isDeclaration() || !functionInPhaseScope(&callee) ||
                !visitedCallees.insert(&callee).second) {
              return;
            }
            for (const BasicBlock &block : callee) {
              const auto *ret =
                  llvm::dyn_cast<llvm::ReturnInst>(block.getTerminator());
              if (!ret) {
                continue;
              }
              const Value *returnValue = ret->getReturnValue();
              if (!returnValue) {
                continue;
              }
              observeVirtioMmioWriteValueSemantics(
                  schemaName, returnValue, sliceBitBase, depth + 1);
            }
          };

          if (const auto *directCallee = llvm::dyn_cast<Function>(
                  call.getCalledOperand()->stripPointerCasts())) {
            observeCalleeReturns(*directCallee);
            return;
          }
          if (const auto resolved = resolveIndirectCallees(call)) {
            for (const std::string &calleeName : *resolved) {
              if (const Function *callee = module_.getFunction(calleeName)) {
                observeCalleeReturns(*callee);
              }
            }
          }
          for (const std::string &calleeName : resolveIndirectCalleesByHint(call)) {
            if (const Function *callee = module_.getFunction(calleeName)) {
              observeCalleeReturns(*callee);
            }
          }
        };

    while (!worklist.empty()) {
      const MmioValueSlice slice = worklist.pop_back_val();
      if (!slice.value || !visited.insert(slice).second) {
        continue;
      }
      if (visited.size() > kMaxMmioSemanticSlices) {
        break;
      }
      if (auto constant = constantValueFor(slice.value)) {
        recordMmioImmediate(schemaName, *constant);
        continue;
      }
      if (shouldInferImmediateRange(schemaName)) {
        if (auto range = smallUnsignedRangeFor(
                slice.value,
                0,
                nullptr,
                immediateRangeMaxSpanForSchema(schemaName))) {
          if (range->first != range->second) {
            recordMmioImmediateRange(schemaName, range->first, range->second);
          }
        }
      }
      if (const auto *argument = llvm::dyn_cast<llvm::Argument>(slice.value)) {
        forEachPhaseCallsiteToFunction(
            *argument->getParent(), [&](const CallBase &callsite) {
              if (argument->getArgNo() >= callsite.arg_size()) {
                return;
              }
              observeVirtioMmioWriteValueSemantics(
                  schemaName, callsite.getArgOperand(argument->getArgNo()),
                  slice.bitBase, depth + 1);
            });
        continue;
      }
      const auto *instruction = llvm::dyn_cast<Instruction>(slice.value);
      if (!instruction) {
        continue;
      }
      if (rootFunction && instruction->getFunction() != rootFunction) {
        continue;
      }
      if (const auto *phi = llvm::dyn_cast<PHINode>(instruction)) {
        for (const Value *incoming : phi->incoming_values()) {
          worklist.push_back({incoming, slice.bitBase});
        }
        continue;
      }
      if (const auto *select = llvm::dyn_cast<llvm::SelectInst>(instruction)) {
        worklist.push_back({select->getTrueValue(), slice.bitBase});
        worklist.push_back({select->getFalseValue(), slice.bitBase});
        continue;
      }
      if (const auto *call = llvm::dyn_cast<CallBase>(instruction)) {
        observeCallResultSemantics(*call, slice.bitBase);
      }
      switch (instruction->getOpcode()) {
        case llvm::Instruction::BitCast:
        case llvm::Instruction::AddrSpaceCast:
        case llvm::Instruction::PtrToInt:
        case llvm::Instruction::IntToPtr:
          worklist.push_back({instruction->getOperand(0), slice.bitBase});
          break;
        case llvm::Instruction::ZExt:
        case llvm::Instruction::SExt:
          recordNarrowIntegerWidth(instruction->getOperand(0)->getType(),
                                   slice.bitBase);
          worklist.push_back({instruction->getOperand(0), slice.bitBase});
          break;
        case llvm::Instruction::Trunc:
          recordNarrowIntegerWidth(instruction->getType(), slice.bitBase);
          worklist.push_back({instruction->getOperand(0), slice.bitBase});
          break;
        case llvm::Instruction::Or:
          worklist.push_back({instruction->getOperand(0), slice.bitBase});
          worklist.push_back({instruction->getOperand(1), slice.bitBase});
          break;
        case llvm::Instruction::And: {
          worklist.push_back({instruction->getOperand(0), slice.bitBase});
          const Value *other = instruction->getOperand(1);
          if (auto mask = constantValueFor(other)) {
            recordMmioBitMask(schemaName, *mask, slice.bitBase);
          } else {
            worklist.push_back({other, slice.bitBase});
          }
          break;
        }
        case llvm::Instruction::Shl: {
          auto shift = constantValueFor(instruction->getOperand(1));
          if (!shift || *shift > std::numeric_limits<int>::max()) {
            break;
          }
          worklist.push_back(
              {instruction->getOperand(0),
               slice.bitBase + static_cast<int>(*shift)});
          break;
        }
        case llvm::Instruction::LShr: {
          auto shift = constantValueFor(instruction->getOperand(1));
          if (!shift || *shift > std::numeric_limits<int>::max()) {
            break;
          }
          worklist.push_back(
              {instruction->getOperand(0),
               slice.bitBase - static_cast<int>(*shift)});
          break;
        }
        default:
          break;
      }
    }
  }

  void observeVirtioMmioAccess(StringRef calleeName,
                               const CallBase &call,
                               bool isRead,
                               bool allowRenderFallback = true) {
    const unsigned addressArgIndex = isRead ? call.arg_size() - 1 : 1;
    if (call.arg_size() <= addressArgIndex) {
      return;
    }
    const auto offset =
        inferVirtioMmioOffset(call.getArgOperand(addressArgIndex),
                              allowRenderFallback);
    if (!offset) {
      return;
    }
    const auto info = lookupVirtioMmioRegisterInfo(*offset);
    if (!info) {
      return;
    }
    const std::string schemaName = sanitizeToken(info->schemaName);
    model_.schemaTypes.insert(schemaName);
    std::vector<std::string> positions;
    std::string fileToken = "generated";
    if (const Instruction *inst = llvm::dyn_cast<Instruction>(&call)) {
      const llvm::DebugLoc &debugLoc = inst->getDebugLoc();
      if (debugLoc) {
        const llvm::DILocation *location = debugLoc.get();
        const llvm::DIScope *scope = location->getScope();
        if (const auto *file = scope ? scope->getFile() : nullptr) {
          llvm::StringRef filename = file->getFilename();
          fileToken = llvm::sys::path::filename(filename).str();
        }
      }
    }
    positions.push_back("[file = " + fileToken + "; caller = " +
                        sanitizeToken(call.getFunction()->getName()) +
                        "; callee = " + sanitizeToken(calleeName) +
                        "; call_depth = 0; argument_index = " +
                        std::to_string(isRead ? 0U : 0U) + "]");
    const std::vector<std::string> inheritedPositions =
        currentSchemaPositionsFor(calleeName, isRead ? 0 : 0);
    for (const std::string &position : inheritedPositions) {
      if (!isTransportHeadNoisePosition(position)) {
        positions.push_back(position);
      }
    }
    for (const std::string &position : positions) {
      if (!position.empty()) {
        model_.schemaHeadPositions[schemaName].insert(position);
      }
    }
    if (isRead) {
      model_.mmioOpNames.insert(sanitizeToken(info->readOpName));
      if (observedMmioReadSemanticCalls_.insert(&call).second) {
        observeVirtioMmioReadValueSemantics(schemaName, &call);
      }
    } else {
      model_.mmioOpNames.insert(sanitizeToken(info->writeOpName));
      if (auto immediate = constantValueFor(call.getArgOperand(0))) {
        recordMmioImmediate(schemaName, *immediate);
      }
      if (observedMmioWriteSemanticCalls_.insert(&call).second) {
        observeVirtioMmioWriteValueSemantics(schemaName, call.getArgOperand(0));
      }
    }
  }

  void collectGlobalMmioSemantics() {
    for (Function &function : module_) {
      if (function.isDeclaration() || !shouldCollectGlobalMmioFor(function) ||
          !functionInPhaseScope(&function)) {
        continue;
      }
      collectDebugNames(function);
    }
    for (Function &function : module_) {
      if (function.isDeclaration() || !shouldCollectGlobalMmioFor(function) ||
          !functionInPhaseScope(&function)) {
        continue;
      }
      for (BasicBlock &block : function) {
        for (Instruction &instruction : block) {
          auto *call = llvm::dyn_cast<CallBase>(&instruction);
          if (!call) {
            continue;
          }
          const Function *callee = llvm::dyn_cast<Function>(
              call->getCalledOperand()->stripPointerCasts());
          if (!callee) {
            continue;
          }
          if (isReadLeaf(callee->getName())) {
            observeVirtioMmioAccess(callee->getName(), *call, true, false);
            continue;
          }
          if (isWriteLeaf(callee->getName())) {
            observeVirtioMmioAccess(callee->getName(), *call, false, false);
          }
        }
      }
    }
  }

  void collectPhaseConfigMmioSemantics() {
    for (const Function *function : phaseScopeFunctions_) {
      if (!function || function->isDeclaration()) {
        continue;
      }
      for (const BasicBlock &block : *function) {
        for (const Instruction &instruction : block) {
          const auto *call = llvm::dyn_cast<CallBase>(&instruction);
          if (!call) {
            continue;
          }
          const Function *callee = llvm::dyn_cast<Function>(
              call->getCalledOperand()->stripPointerCasts());
          if (!callee) {
            continue;
          }
          const StringRef calleeName = callee->getName();
          if ((calleeName == "vm_get" || calleeName == "vm_set") &&
              call->arg_size() >= 4) {
            auto width = constantValueFor(call->getArgOperand(3));
            if (!width || *width == 0) {
              continue;
            }
            const bool isRead = calleeName == "vm_get";
            if (auto offset = constantValueFor(call->getArgOperand(1))) {
              recordVirtioNetConfigOffsetAccess(*offset,
                                                static_cast<unsigned>(*width),
                                                isRead,
                                                &instruction,
                                                calleeName);
            } else {
              recordVirtioNetConfigArraySpanFromBase(call->getArgOperand(1),
                                                     static_cast<unsigned>(*width),
                                                     isRead,
                                                     &instruction,
                                                     calleeName);
            }
            continue;
          }
          if (calleeName == "__virtio_cread_many" && call->arg_size() >= 5) {
            auto startOffset = constantValueFor(call->getArgOperand(1));
            auto count = constantValueFor(call->getArgOperand(3));
            auto width = constantValueFor(call->getArgOperand(4));
            if (startOffset && count && width && *width != 0) {
              recordVirtioNetConfigSequentialAccesses(*startOffset,
                                                      static_cast<unsigned>(*width),
                                                      *count,
                                                      true,
                                                      &instruction,
                                                      calleeName);
            } else {
              auto scalarWidth = width ? static_cast<unsigned>(*width) : 1U;
              recordVirtioNetConfigArraySpanFromBase(call->getArgOperand(1),
                                                     scalarWidth,
                                                     true,
                                                     &instruction,
                                                     calleeName);
            }
            continue;
          }
          if (calleeName == "virtio_cread_bytes" && call->arg_size() >= 4) {
            auto startOffset = constantValueFor(call->getArgOperand(1));
            auto count = constantValueFor(call->getArgOperand(3));
            if (startOffset && count) {
              recordVirtioNetConfigSequentialAccesses(*startOffset,
                                                      1,
                                                      *count,
                                                      true,
                                                      &instruction,
                                                      calleeName);
            } else {
              recordVirtioNetConfigArraySpanFromBase(call->getArgOperand(1),
                                                     1,
                                                     true,
                                                     &instruction,
                                                     calleeName);
            }
            continue;
          }
          if (auto width = fixedVirtioConfigWidthFromHelperName(calleeName)) {
            const bool isRead = isVirtioConfigReadHelperName(calleeName);
            const bool isWrite = isVirtioConfigWriteHelperName(calleeName);
            if (!isRead && !isWrite) {
              continue;
            }
            if (call->arg_size() < 2) {
              continue;
            }
            if (auto offset = constantValueFor(call->getArgOperand(1))) {
              recordVirtioNetConfigOffsetAccess(*offset,
                                                *width,
                                                isRead,
                                                &instruction,
                                                calleeName);
            } else {
              recordVirtioNetConfigArraySpanFromBase(call->getArgOperand(1),
                                                     *width,
                                                     isRead,
                                                     &instruction,
                                                     calleeName);
            }
          }
        }
      }
    }
  }

