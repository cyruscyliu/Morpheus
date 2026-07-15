  void collectPhaseScopeFunction(const Function *function) {
    if (!function || !phaseScopeFunctions_.insert(function).second ||
        function->isDeclaration()) {
      return;
    }
    for (const BasicBlock &block : *function) {
      for (const Instruction &instruction : block) {
        const auto *call = llvm::dyn_cast<CallBase>(&instruction);
        if (!call) {
          continue;
        }
        if (const Function *callee = llvm::dyn_cast<Function>(
                call->getCalledOperand()->stripPointerCasts())) {
          if (!callee->isIntrinsic() && !isPrunedHelper(callee->getName())) {
            collectPhaseScopeFunction(callee);
          }
          continue;
        }
        auto collectResolved = [&](const std::vector<std::string> &names) {
          for (const std::string &name : names) {
            const Function *resolved = module_.getFunction(name);
            if (!resolved || resolved->isIntrinsic() ||
                isPrunedHelper(resolved->getName()) ||
                !indirectCalleeMatchesCall(*resolved, *call)) {
              continue;
            }
            collectPhaseScopeFunction(resolved);
          }
        };
        if (const auto resolved = resolveIndirectCallees(*call)) {
          collectResolved(*resolved);
        } else {
          collectResolved(resolveIndirectCalleesByHint(*call));
        }
      }
    }

    for (const std::string &calleeName : functionEdgeCallees(function->getName())) {
      const Function *callee = module_.getFunction(calleeName);
      if (!callee || callee->isDeclaration() || callee->isIntrinsic() ||
          isPrunedHelper(callee->getName())) {
        continue;
      }
      collectPhaseScopeFunction(callee);
    }
  }

  void collectBootingGraphProbeBridges() {
    if (!request_.chainedEntries) {
      return;
    }
    bootingGraphBridgeFunctions_.clear();
    for (const std::string &entryName : request_.entryFunctions) {
      for (const std::string &callerName : functionEdgeCallers(entryName)) {
        if (!isProbeLikeFunctionName(callerName)) {
          continue;
        }
        const Function *caller = module_.getFunction(callerName);
        if (!caller || caller->isDeclaration() || caller->isIntrinsic() ||
            isPrunedHelper(caller->getName())) {
          continue;
        }
        if (!llvm::is_contained(bootingGraphBridgeFunctions_, caller)) {
          bootingGraphBridgeFunctions_.push_back(caller);
        }
        collectPhaseScopeFunction(caller);
      }
    }
    if (const Function *virtioDevProbe = module_.getFunction("virtio_dev_probe")) {
      bool reachesBootEntry = false;
      const std::vector<std::string> callees =
          functionEdgeCallees(virtioDevProbe->getName());
      for (const std::string &entryName : request_.entryFunctions) {
        if (llvm::is_contained(callees, entryName)) {
          reachesBootEntry = true;
          break;
        }
      }
      if (reachesBootEntry && !virtioDevProbe->isDeclaration() &&
          !virtioDevProbe->isIntrinsic() &&
          !isPrunedHelper(virtioDevProbe->getName())) {
        if (!llvm::is_contained(bootingGraphBridgeFunctions_, virtioDevProbe)) {
          bootingGraphBridgeFunctions_.push_back(virtioDevProbe);
        }
        collectPhaseScopeFunction(virtioDevProbe);
      }
    }
  }

  bool functionInPhaseScope(const Function *function) const {
    if (!function) {
      return false;
    }
    return phaseScopeFunctions_.empty() ||
           phaseScopeFunctions_.find(function) != phaseScopeFunctions_.end();
  }

  std::vector<std::string> functionEdgeCallees(StringRef functionName) const {
    auto it = functionEdges_.find(functionName.str());
    if (it == functionEdges_.end()) {
      return {};
    }
    return it->second;
  }

  std::vector<std::string> functionEdgeCallers(StringRef calleeName) const {
    std::vector<std::string> callers;
    for (const auto &[caller, callees] : functionEdges_) {
      if (llvm::is_contained(callees, calleeName.str())) {
        callers.push_back(caller);
      }
    }
    return callers;
  }

  std::vector<std::string> constrainIndirectCalleeCandidates(
      const CallBase &call,
      std::vector<std::string> candidates) const {
    if (candidates.empty()) {
      return candidates;
    }

    const std::string callerName = call.getFunction()->getName().str();
    const std::vector<std::string> edgeCallees =
        functionEdgeCallees(callerName);
    if (!edgeCallees.empty()) {
      std::vector<std::string> constrained;
      constrained.reserve(candidates.size());
      for (const std::string &candidate : candidates) {
        if (llvm::is_contained(edgeCallees, candidate)) {
          constrained.push_back(candidate);
        }
      }
      if (!constrained.empty()) {
        candidates = std::move(constrained);
      }
    }

    const bool allowSelfEdge = llvm::is_contained(edgeCallees, callerName);
    candidates.erase(
        std::remove_if(candidates.begin(),
                       candidates.end(),
                       [&](const std::string &candidate) {
                         return candidate.empty() ||
                                (candidate == callerName && !allowSelfEdge);
                       }),
        candidates.end());
    std::sort(candidates.begin(), candidates.end());
    candidates.erase(std::unique(candidates.begin(), candidates.end()),
                     candidates.end());
    return candidates;
  }

  static bool isProbeLikeFunctionName(StringRef name) {
    return name.endswith("_probe") || name == "virtio_dev_probe" ||
           name == "platform_probe";
  }

  std::vector<std::string> lookupPointsToHintTypes(const CallBase *call,
                                                   StringRef calleeName,
                                                   unsigned argIndex) const {
    if (!call) {
      return {};
    }
    const std::string key =
        buildPointsToHintKey(callsiteKeyFor(call), calleeName, argIndex);
    auto it = pointsToHints_.find(key);
    if (it == pointsToHints_.end()) {
      return {};
    }
    return it->second;
  }

  std::vector<std::string> lookupPointsToHintFields(const CallBase *call,
                                                    StringRef calleeName,
                                                    unsigned argIndex) const {
    if (!call) {
      return {};
    }
    const std::string key =
        buildPointsToHintKey(callsiteKeyFor(call), calleeName, argIndex);
    auto it = pointsToFieldHints_.find(key);
    if (it == pointsToFieldHints_.end()) {
      return {};
    }
    return it->second;
  }

  std::vector<std::string> lookupPointsToHintCalls(const CallBase *call,
                                                   StringRef calleeName,
                                                   unsigned argIndex) const {
    if (!call) {
      return {};
    }
    const std::string key =
        buildPointsToHintKey(callsiteKeyFor(call), calleeName, argIndex);
    auto it = pointsToCallHints_.find(key);
    if (it == pointsToCallHints_.end()) {
      return {};
    }
    return it->second;
  }

  std::vector<std::string> lookupPointsToHintUseSites(const CallBase *call,
                                                      StringRef calleeName,
                                                      unsigned argIndex) const {
    if (!call) {
      return {};
    }
    const std::string key =
        buildPointsToHintKey(callsiteKeyFor(call), calleeName, argIndex);
    auto it = pointsToUseSiteHints_.find(key);
    if (it == pointsToUseSiteHints_.end()) {
      return {};
    }
    return it->second;
  }

  static std::string baseNameForFunction(const Function &function) {
    return sanitizeFunctionName(function);
  }

  const CallBase *specializedCallerForFunction(const Function *function) const {
    if (!function) {
      return nullptr;
    }
    for (auto it = traceBuildStack_.rbegin(); it != traceBuildStack_.rend(); ++it) {
      if (it->function == function) {
        return it->caller;
      }
    }
    return nullptr;
  }

  std::string specializedBaseNameForCall(const Function &callee,
                                         const CallBase &call) const {
    std::string prefix;
    if (!traceBuildStack_.empty()) {
      prefix = traceBuildStack_.back().baseName;
    } else {
      prefix = baseNameForFunction(*call.getFunction());
    }
    std::string suffix;
    if (const Instruction *inst = llvm::dyn_cast<Instruction>(&call)) {
      const llvm::DebugLoc &debugLoc = inst->getDebugLoc();
      if (debugLoc) {
        suffix = sanitizeToken(baseNameForFunction(callee) + "_" +
                               std::to_string(debugLoc.getLine()));
      }
    }
    if (suffix.empty()) {
      suffix = baseNameForFunction(callee) + "_ctx";
    }
    return prefix + "__" + suffix;
  }

  bool functionNeedsDmaContext(const Function &function,
                               unsigned depth = 0) {
    static std::map<const Function *, bool> cache;
    auto it = cache.find(&function);
    if (it != cache.end()) {
      return it->second;
    }
    if (depth > 12 || function.isDeclaration()) {
      cache[&function] = false;
      return false;
    }
    for (const BasicBlock &block : function) {
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
        if (isSyntheticDmaTraceTarget(callee->getName())) {
          cache[&function] = true;
          return true;
        }
        if (isPrunedHelper(callee->getName()) || callee->isIntrinsic()) {
          continue;
        }
        if (functionNeedsDmaContext(*callee, depth + 1)) {
          cache[&function] = true;
          return true;
        }
      }
    }
    cache[&function] = false;
    return false;
  }

  bool isObservableCall(const CallBase &call) {
    const Function *callee =
        llvm::dyn_cast<Function>(call.getCalledOperand()->stripPointerCasts());
    if (!callee) {
      const auto resolved = resolveIndirectCallees(call);
      if (!resolved) {
        return false;
      }
      for (const std::string &calleeName : *resolved) {
        const Function *resolvedCallee = module_.getFunction(calleeName);
        if (!resolvedCallee || resolvedCallee->isIntrinsic()) {
          continue;
        }
        if (isReadLeaf(resolvedCallee->getName()) ||
            isWriteLeaf(resolvedCallee->getName()) ||
            isSgFunction(resolvedCallee->getName()) ||
            isSyntheticDmaTraceTarget(resolvedCallee->getName()) ||
            isFunctionRelevant(*resolvedCallee)) {
          return true;
        }
      }
      return false;
    }
    if (callee->isIntrinsic()) {
      return false;
    }
    return isReadLeaf(callee->getName()) || isWriteLeaf(callee->getName()) ||
           isSgFunction(callee->getName()) ||
           isSyntheticDmaTraceTarget(callee->getName()) ||
           isFunctionRelevant(*callee);
  }

  bool blockHasObservable(const BasicBlock &block) {
    for (const Instruction &instruction : block) {
      if (const auto *call = llvm::dyn_cast<CallBase>(&instruction)) {
        if (isObservableCall(*call)) {
          return true;
        }
      }
    }
    return false;
  }

  bool isBlockRelevant(const BasicBlock &block) {
    auto it = blockRelevanceCache_.find(&block);
    if (it != blockRelevanceCache_.end()) {
      return it->second == Relevance::Relevant;
    }

    blockRelevanceCache_[&block] = Relevance::Visiting;
    if (blockHasObservable(block)) {
      blockRelevanceCache_[&block] = Relevance::Relevant;
      return true;
    }
    if (currentTraceEntry_ && blockReachesExit(block)) {
      blockRelevanceCache_[&block] = Relevance::Relevant;
      return true;
    }

    const BranchInst *branch =
        llvm::dyn_cast<BranchInst>(block.getTerminator());
    if (branch) {
      for (unsigned index = 0; index < branch->getNumSuccessors(); ++index) {
        BasicBlock *successor = branch->getSuccessor(index);
        auto succIt = blockRelevanceCache_.find(successor);
        if (succIt != blockRelevanceCache_.end() &&
            succIt->second == Relevance::Visiting) {
          continue;
        }
        if (successor && isBlockRelevant(*successor)) {
          blockRelevanceCache_[&block] = Relevance::Relevant;
          return true;
        }
      }
    } else if (const auto *switchInst =
                   llvm::dyn_cast<SwitchInst>(block.getTerminator())) {
      for (unsigned index = 0; index < switchInst->getNumSuccessors(); ++index) {
        BasicBlock *successor = switchInst->getSuccessor(index);
        auto succIt = blockRelevanceCache_.find(successor);
        if (succIt != blockRelevanceCache_.end() &&
            succIt->second == Relevance::Visiting) {
          continue;
        }
        if (successor && isBlockRelevant(*successor)) {
          blockRelevanceCache_[&block] = Relevance::Relevant;
          return true;
        }
      }
    }

    blockRelevanceCache_[&block] = Relevance::Irrelevant;
    return false;
  }

  bool blockReachesExit(const BasicBlock &block) {
    auto it = blockExitCache_.find(&block);
    if (it != blockExitCache_.end()) {
      return it->second == Relevance::Relevant;
    }

    blockExitCache_[&block] = Relevance::Visiting;
    const Instruction *terminator = block.getTerminator();
    if (!terminator) {
      blockExitCache_[&block] = Relevance::Relevant;
      return true;
    }
    if (terminator->getNumSuccessors() == 0) {
      blockExitCache_[&block] = Relevance::Relevant;
      return true;
    }
    for (unsigned index = 0; index < terminator->getNumSuccessors(); ++index) {
      const BasicBlock *successor = terminator->getSuccessor(index);
      auto succIt = blockExitCache_.find(successor);
      if (succIt != blockExitCache_.end() &&
          succIt->second == Relevance::Visiting) {
        continue;
      }
      if (successor && blockReachesExit(*successor)) {
        blockExitCache_[&block] = Relevance::Relevant;
        return true;
      }
    }
    blockExitCache_[&block] = Relevance::Irrelevant;
    return false;
  }

  const BasicBlock *resolveRelevantSuccessor(const BasicBlock *block) {
    const BasicBlock *current = block;
    llvm::SmallPtrSet<const BasicBlock *, 8> seen;

    while (current && seen.insert(current).second) {
      if (isBlockRelevant(*current)) {
        return current;
      }

      const Instruction *terminator = current->getTerminator();
      if (!terminator || terminator->getNumSuccessors() == 0) {
        return nullptr;
      }
      if (terminator->getNumSuccessors() != 1) {
        return nullptr;
      }
      current = terminator->getSuccessor(0);
    }

    return nullptr;
  }

  std::optional<std::vector<std::string>> resolveIndirectCallees(
      const CallBase &call) {
    if (llvm::dyn_cast<Function>(call.getCalledOperand()->stripPointerCasts())) {
      return std::nullopt;
    }

    const llvm::DebugLoc &debugLoc = call.getDebugLoc();
    if (!debugLoc) {
      return std::nullopt;
    }

    const llvm::DILocation *location = debugLoc.get();
    const llvm::DIScope *scope = location->getScope();
    const auto *file = scope ? scope->getFile() : nullptr;
    if (!file) {
      return std::nullopt;
    }

    const std::string filename = trimPath(file->getFilename());
    const std::string directory = trimPath(file->getDirectory());
    const unsigned line = location->getLine();
    if (filename.empty() || line == 0) {
      return std::nullopt;
    }

    std::string combined = filename;
    if (!directory.empty()) {
      combined = directory;
      if (!combined.empty() && combined.back() != '/') {
        combined += "/";
      }
      combined += filename;
    }

    std::vector<std::string> matches;
    for (const auto &kv : indirectCalls_) {
      std::string callsitePath;
      unsigned callsiteLine = 0;
      if (!parseLocationToken(kv.first, callsitePath, callsiteLine) ||
          callsiteLine != line) {
        continue;
      }
      if (callsitePath != combined &&
          callsitePath != filename &&
          !(callsitePath.size() > filename.size() &&
            StringRef(callsitePath).endswith(filename)) &&
          !(combined.size() > callsitePath.size() &&
            StringRef(combined).endswith(callsitePath))) {
        continue;
      }
      matches.insert(matches.end(), kv.second.begin(), kv.second.end());
    }
    if (matches.empty()) {
      matches = resolveIndirectCalleesByHint(call);
      if (matches.empty()) {
        return std::nullopt;
      }
    }
    matches = constrainIndirectCalleeCandidates(call, std::move(matches));
    if (matches.empty()) {
      return std::nullopt;
    }
    return matches;
  }

  std::vector<std::string> collectCalledOperandHints(const Value *value) {
    std::vector<std::string> hints;
    llvm::SmallPtrSet<const Value *, 16> visited;
    std::function<void(const Value *)> visit = [&](const Value *current) {
      if (!current || !visited.insert(current).second) {
        return;
      }
      if (current->hasName()) {
        hints.push_back(sanitizeToken(current->getName()));
      }
      if (auto it = valueNames_.find(current); it != valueNames_.end()) {
        hints.push_back(sanitizeToken(it->second));
      }
      if (const auto *instruction = llvm::dyn_cast<Instruction>(current)) {
        for (const Value *operand : instruction->operands()) {
          visit(operand);
        }
      }
    };
    visit(value);
    std::sort(hints.begin(), hints.end());
    hints.erase(std::unique(hints.begin(), hints.end()), hints.end());
    return hints;
  }

  std::vector<std::string> resolveIndirectCalleesByHint(const CallBase &call) {
    std::vector<std::string> matches;
    const std::vector<std::string> hints =
        collectCalledOperandHints(call.getCalledOperand());
    if (hints.empty()) {
      return matches;
    }
    for (const Function &candidate : module_) {
      if (candidate.isIntrinsic() || candidate.isDeclaration()) {
        continue;
      }
      if (!indirectCalleeMatchesCall(candidate, call)) {
        continue;
      }
      const std::string candidateName = sanitizeToken(candidate.getName());
      for (const std::string &hint : hints) {
        if (hint.empty()) {
          continue;
        }
        if (candidateName.find(hint) != std::string::npos ||
            hint.find(candidateName) != std::string::npos) {
          matches.push_back(candidate.getName().str());
          break;
        }
      }
    }
    return constrainIndirectCalleeCandidates(call, std::move(matches));
  }

  bool indirectCalleeMatchesCall(const Function &callee, const CallBase &call) {
    if (callee.arg_size() != call.arg_size()) {
      return false;
    }
    if (callee.getReturnType() != call.getType()) {
      return false;
    }
    return true;
  }

  template <typename Callback>
  void forEachPhaseCallsiteToFunction(const Function &target,
                                      Callback &&callback) {
    llvm::SmallPtrSet<const CallBase *, 32> seen;
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
          const Function *directCallee = llvm::dyn_cast<Function>(
              call->getCalledOperand()->stripPointerCasts());
          if (directCallee == &target) {
            if (seen.insert(call).second) {
              callback(*call);
            }
            continue;
          }
          if (directCallee) {
            continue;
          }
          if (!indirectCalleeMatchesCall(target, *call)) {
            continue;
          }
          bool matches = false;
          if (const auto resolved = resolveIndirectCallees(*call)) {
            matches = llvm::is_contained(*resolved, target.getName().str());
          }
          if (!matches) {
            const std::vector<std::string> hinted =
                resolveIndirectCalleesByHint(*call);
            matches = llvm::is_contained(hinted, target.getName().str());
          }
          if (matches && seen.insert(call).second) {
            callback(*call);
          }
        }
      }
    }
  }

  const Value *findStoredValueForPointer(const Value *pointer,
                                         const Instruction *context) {
    llvm::SmallPtrSet<const Value *, 16> visited;
    const StoreInst *store = findUniqueStoreForPointer(pointer, context, visited);
    if (!store) {
      return nullptr;
    }
    return store->getValueOperand();
  }

  const StoreInst *findUniqueStoreForPointer(
      const Value *pointer,
      const Instruction *context,
      llvm::SmallPtrSetImpl<const Value *> &visited) {
    if (!pointer || !visited.insert(pointer).second) {
      return nullptr;
    }

    const StoreInst *matchingStore = nullptr;
    for (const llvm::User *user : pointer->users()) {
      if (const auto *store = llvm::dyn_cast<StoreInst>(user)) {
        if (store->getPointerOperand() != pointer) {
          continue;
        }
        if (!context || store->getFunction() != context->getFunction()) {
          continue;
        }
        if (matchingStore) {
          return nullptr;
        }
        matchingStore = store;
        continue;
      }

      const auto *instruction = llvm::dyn_cast<Instruction>(user);
      if (!instruction) {
        continue;
      }
      if (instruction->getOpcode() != llvm::Instruction::BitCast &&
          instruction->getOpcode() != llvm::Instruction::AddrSpaceCast) {
        continue;
      }
      const StoreInst *aliasStore =
          findUniqueStoreForPointer(instruction, context, visited);
      if (!aliasStore) {
        continue;
      }
      if (matchingStore && matchingStore != aliasStore) {
        return nullptr;
      }
      matchingStore = aliasStore;
    }

    return matchingStore;
  }

  bool isFunctionRelevant(const Function &function) {
    auto it = relevanceCache_.find(&function);
    if (it != relevanceCache_.end()) {
      if (it->second == Relevance::Relevant) {
        return true;
      }
      if (it->second == Relevance::Irrelevant) {
        return false;
      }
      if (it->second == Relevance::Visiting) {
        return false;
      }
    }

    if (function.isIntrinsic() || isPrunedHelper(function.getName())) {
      relevanceCache_[&function] = Relevance::Irrelevant;
      return false;
    }

    if (isSyntheticDmaTraceTarget(function.getName())) {
      relevanceCache_[&function] = Relevance::Relevant;
      return true;
    }

    relevanceCache_[&function] = Relevance::Visiting;

    if (function.isDeclaration()) {
      const bool relevant =
          isReadLeaf(function.getName()) ||
          isWriteLeaf(function.getName()) ||
          isSgFunction(function.getName());
      relevanceCache_[&function] =
          relevant ? Relevance::Relevant : Relevance::Irrelevant;
      return relevant;
    }

    bool relevant = false;
    for (const BasicBlock &block : function) {
      for (const Instruction &instruction : block) {
        const auto *call = llvm::dyn_cast<CallBase>(&instruction);
        if (!call) {
          continue;
        }
        const Function *callee =
            llvm::dyn_cast<Function>(call->getCalledOperand()->stripPointerCasts());
        if (callee && callee->isIntrinsic()) {
          continue;
        }
        if (!callee) {
          if (const auto resolved = resolveIndirectCallees(*call)) {
            for (const std::string &calleeName : *resolved) {
              const Function *resolvedCallee = module_.getFunction(calleeName);
              if (!resolvedCallee || resolvedCallee->isIntrinsic()) {
                continue;
              }
              if (isReadLeaf(resolvedCallee->getName()) ||
                  isWriteLeaf(resolvedCallee->getName()) ||
                  isSgFunction(resolvedCallee->getName()) ||
                  isSyntheticDmaTraceTarget(resolvedCallee->getName()) ||
                  isFunctionRelevant(*resolvedCallee)) {
                relevant = true;
                break;
              }
            }
          }
          if (relevant) {
            break;
          }
          continue;
        }
        if (isReadLeaf(callee->getName()) || isWriteLeaf(callee->getName()) ||
            isSgFunction(callee->getName()) ||
            isSyntheticDmaTraceTarget(callee->getName())) {
          relevant = true;
          break;
        }
        if (isPrunedHelper(callee->getName())) {
          continue;
        }
        if (isFunctionRelevant(*callee)) {
          relevant = true;
          break;
        }
      }
      if (relevant) {
        break;
      }
    }

    relevanceCache_[&function] =
        relevant ? Relevance::Relevant : Relevance::Irrelevant;
    return relevant;
  }

  void buildTrace(Function &function,
                  bool force = false,
                  StringRef traceBaseName = "",
                  const CallBase *callerContext = nullptr) {
    if (function.isDeclaration() || (!force && !isFunctionRelevant(function))) {
      return;
    }
    const std::string baseName =
        traceBaseName.empty() ? baseNameForFunction(function) : traceBaseName.str();
    if (!model_.emittedTraceBases.insert(baseName).second) {
      return;
    }
    traceBuildStack_.push_back({&function, callerContext, baseName});
    auto stackGuard = llvm::make_scope_exit([&] { traceBuildStack_.pop_back(); });

    TraceModel trace;
    trace.name = traceNameForBase(baseName);
    trace.entry =
        std::find(request_.entryFunctions.begin(), request_.entryFunctions.end(),
                  function.getName().str()) != request_.entryFunctions.end();

    if (buildSyntheticDmaTrace(function, trace)) {
      model_.traces.push_back(std::move(trace));
      return;
    }

    collectDebugNames(function);
    blockRelevanceCache_.clear();
    blockExitCache_.clear();
    currentTraceEntry_ = trace.entry || !function.getReturnType()->isVoidTy();

    std::map<const BasicBlock *, std::string> labels;
    const std::string labelPrefix = "bb_" + sanitizeFunctionName(function);
    bool entrySeen = false;
    for (const BasicBlock &block : function) {
      if (!entrySeen) {
        labels[&block] = labelPrefix + "_entry";
        entrySeen = true;
        continue;
      }
      labels[&block] = labelPrefix + "_" + std::to_string(labelCounter_++);
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

  bool buildSyntheticDmaTrace(Function &function, TraceModel &trace) {
    const StringRef name = function.getName();
    if (!isSyntheticDmaTraceTarget(name)) {
      return false;
    }

    auto pushBlock = [&](std::string label, std::vector<std::string> lines) {
      TraceBlock block;
      block.label = std::move(label);
      block.lines = std::move(lines);
      trace.blocks.push_back(std::move(block));
    };

    if (name == "vring_map_one_sg") {
      pushBlock("", {
                        "neqj direction, DMA_TO_DEVICE, @bb_vring_map_one_sg_done",
                        "neqj premapped, 0, @bb_vring_map_one_sg_done",
                        "len = sg.length",
                        "neqj vq.use_map_api, 0, @bb_vring_map_one_sg_dma_api",
                        "addr = sg_phys(sg)",
                        "dma_event(op=map, dir=to_device, path=phys, addr=addr, len=len, data_kind=sg_buffer)",
                        "goto @bb_vring_map_one_sg_done",
                    });
      pushBlock("bb_vring_map_one_sg_dma_api", {
                                                  "map_addr = virtqueue_map_page_attrs(vq.vq, sg_page(sg), sg.offset, sg.length, direction, 0)",
                                                  "neqj map_addr, DMA_MAPPING_ERROR, @bb_vring_map_one_sg_dma_ok",
                                              });
      pushBlock("bb_vring_map_one_sg_dma_ok", {
                                                 "addr = map_addr",
                                                 "dma_event(op=map, dir=to_device, path=dma_api, addr=addr, len=len, data_kind=sg_buffer)",
                                             });
      pushBlock("bb_vring_map_one_sg_done", {});
      return true;
    }

    if (name == "vring_map_single") {
      pushBlock("", {
                        "neqj direction, DMA_TO_DEVICE, @bb_vring_map_single_done",
                        "neqj vq.use_map_api, 0, @bb_vring_map_single_dma_api",
                        "addr = virt_to_phys(cpu_addr)",
                        "dma_event(op=map, dir=to_device, path=phys, addr=addr, len=size, data_kind=virtq_desc_table)",
                        "goto @bb_vring_map_single_done",
                    });
      pushBlock("bb_vring_map_single_dma_api", {
                                                  "map_addr = virtqueue_map_single_attrs(vq.vq, cpu_addr, size, direction, 0)",
                                                  "neqj map_addr, DMA_MAPPING_ERROR, @bb_vring_map_single_dma_ok",
                                              });
      pushBlock("bb_vring_map_single_dma_ok", {
                                                 "addr = map_addr",
                                                 "dma_event(op=map, dir=to_device, path=dma_api, addr=addr, len=size, data_kind=virtq_desc_table)",
                                             });
      pushBlock("bb_vring_map_single_done", {});
      return true;
    }

    if (name == "vring_unmap_one_split" || name == "vring_unmap_extra_packed") {
      const std::string doneLabel =
          name == "vring_unmap_one_split" ? "bb_vring_unmap_one_split_done"
                                           : "bb_vring_unmap_extra_packed_done";
      const std::string dmaLabel =
          name == "vring_unmap_one_split" ? "bb_vring_unmap_one_split_dma_api"
                                           : "bb_vring_unmap_extra_packed_dma_api";
      pushBlock("", {
                        "neqj extra.flags & VRING_DESC_F_WRITE, 0, @" + dmaLabel,
                        "goto @" + doneLabel,
                    });
      pushBlock(dmaLabel, {
                                "neqj vq.use_map_api, 0, @" + dmaLabel + "_map",
                                "dma_event(op=unmap, dir=from_device, path=phys, addr=extra.addr, len=extra.len, data_kind=ethernet_frame)",
                                "goto @" + doneLabel,
                            });
      pushBlock(dmaLabel + "_map", {
                                        "dma_event(op=unmap, dir=from_device, path=dma_api, addr=extra.addr, len=extra.len, data_kind=ethernet_frame)",
                                    });
      pushBlock(doneLabel, {});
      return true;
    }

    return false;
  }

  void emitBlock(const BasicBlock &block,
                 const std::map<const BasicBlock *, std::string> &labels,
                 TraceModel &trace,
                 std::set<const BasicBlock *> &emittedBlocks) {
    if (!isBlockRelevant(block)) {
      return;
    }
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
        continue;
      }

      if (const auto *switchInst = llvm::dyn_cast<SwitchInst>(&instruction)) {
        emitSwitch(*switchInst, labels, trace, out.lines);
      }
    }

    if (out.lines.empty()) {
      out.lines.push_back("...");
    }

    trace.blocks.push_back(std::move(out));

    const BranchInst *branch = llvm::dyn_cast<BranchInst>(block.getTerminator());
    const SwitchInst *switchInst = llvm::dyn_cast<SwitchInst>(block.getTerminator());
    if (!branch && !switchInst) {
      return;
    }
    if (branch) {
      if (branch->isUnconditional()) {
        if (BasicBlock *successor = branch->getSuccessor(0)) {
          if (successor && isBlockRelevant(*successor)) {
            emitBlock(*successor, labels, trace, emittedBlocks);
          } else if (const BasicBlock *resolved =
                         resolveRelevantSuccessor(successor)) {
            emitBlock(*resolved, labels, trace, emittedBlocks);
          }
        }
        return;
      }
      BasicBlock *trueBlock = branch->getSuccessor(0);
      BasicBlock *falseBlock = branch->getSuccessor(1);
      if (falseBlock) {
        if (isBlockRelevant(*falseBlock)) {
          emitBlock(*falseBlock, labels, trace, emittedBlocks);
        } else if (const BasicBlock *resolved =
                       resolveRelevantSuccessor(falseBlock)) {
          emitBlock(*resolved, labels, trace, emittedBlocks);
        }
      }
      if (trueBlock) {
        if (isBlockRelevant(*trueBlock)) {
          emitBlock(*trueBlock, labels, trace, emittedBlocks);
        } else if (const BasicBlock *resolved =
                       resolveRelevantSuccessor(trueBlock)) {
          emitBlock(*resolved, labels, trace, emittedBlocks);
        }
      }
      return;
    }
    for (unsigned index = 0; index < switchInst->getNumSuccessors(); ++index) {
      BasicBlock *successor = switchInst->getSuccessor(index);
      if (!successor) {
        continue;
      }
      if (isBlockRelevant(*successor)) {
        emitBlock(*successor, labels, trace, emittedBlocks);
      } else if (const BasicBlock *resolved =
                     resolveRelevantSuccessor(successor)) {
        emitBlock(*resolved, labels, trace, emittedBlocks);
      }
    }
  }

  void emitBranch(const BranchInst &branch,
                  const std::map<const BasicBlock *, std::string> &labels,
                  std::vector<std::string> &lines) {
    const auto emitGoto = [&](const BasicBlock *target) {
      const BasicBlock *resolved = target;
      if (resolved && !isBlockRelevant(*resolved)) {
        resolved = resolveRelevantSuccessor(resolved);
      }
      if (!resolved || !isBlockRelevant(*resolved)) {
        return false;
      }
      const auto labelIt = labels.find(resolved);
      if (labelIt == labels.end() || labelIt->second.empty()) {
        return false;
      }
      lines.push_back("goto @" + labelIt->second);
      return true;
    };
    const auto reachesSilentExit = [&](const BasicBlock *target) {
      return target && !resolveRelevantSuccessor(target) &&
             blockReachesExit(*target);
    };
    if (branch.isUnconditional()) {
      emitGoto(branch.getSuccessor(0));
      return;
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
    const bool falseRelevant = resolvedFalse && isBlockRelevant(*resolvedFalse);
    if (!trueRelevant && !falseRelevant) {
      return;
    }
    if (trueRelevant && !falseRelevant && !reachesSilentExit(falseBlock)) {
      emitGoto(resolvedTrue);
      return;
    }
    if (!trueRelevant && falseRelevant && !reachesSilentExit(trueBlock)) {
      emitGoto(resolvedFalse);
      return;
    }

    if (const auto *icmp =
            llvm::dyn_cast<llvm::ICmpInst>(branch.getCondition())) {
      const std::string lhs = renderValue(icmp->getOperand(0));
      const std::string rhs = renderValue(icmp->getOperand(1));
      const auto predicate = icmp->getPredicate();

      if (predicate == llvm::ICmpInst::ICMP_NE) {
        const auto labelIt = labels.find(resolvedTrue);
        if (labelIt != labels.end() && !labelIt->second.empty()) {
          lines.push_back("neqj " + lhs + ", " + rhs + ", @" + labelIt->second);
          if (reachesSilentExit(falseBlock)) {
            return;
          }
          emitGoto(resolvedFalse);
          return;
        }
      }

      if (predicate == llvm::ICmpInst::ICMP_EQ && trueRelevant &&
          reachesSilentExit(falseBlock)) {
        const auto labelIt = labels.find(resolvedTrue);
        if (labelIt != labels.end() && !labelIt->second.empty()) {
          lines.push_back("neqj " + lhs + ", " + rhs + ", @" + labelIt->second);
          return;
        }
      }

      if (predicate == llvm::ICmpInst::ICMP_EQ && resolvedFalse) {
        const auto labelIt = labels.find(resolvedFalse);
        if (labelIt != labels.end() && !labelIt->second.empty()) {
          lines.push_back("neqj " + lhs + ", " + rhs + ", @" + labelIt->second);
          if (reachesSilentExit(trueBlock)) {
            return;
          }
          emitGoto(resolvedTrue);
          return;
        }
      }
    }

    const std::string condition = renderValue(branch.getCondition());
    const auto labelIt = labels.find(resolvedTrue);
    if (labelIt == labels.end() || labelIt->second.empty()) {
      return;
    }
    lines.push_back("neqj " + condition + ", 0, @" + labelIt->second);
    if (!reachesSilentExit(falseBlock)) {
      emitGoto(resolvedFalse);
    }
  }

  void emitSwitch(const SwitchInst &switchInst,
                  const std::map<const BasicBlock *, std::string> &labels,
                  TraceModel &trace,
                  std::vector<std::string> &lines) {
    struct RelevantCase {
      std::string value;
      std::string label;
    };

    std::vector<RelevantCase> cases;
    std::string defaultLabel;
    if (BasicBlock *defaultDest = switchInst.getDefaultDest();
        defaultDest && isBlockRelevant(*defaultDest)) {
      auto it = labels.find(defaultDest);
      if (it != labels.end() && !it->second.empty()) {
        defaultLabel = it->second;
      }
    }

    for (const auto &switchCase : switchInst.cases()) {
      const BasicBlock *successor = switchCase.getCaseSuccessor();
      if (!successor || !isBlockRelevant(*successor)) {
        continue;
      }
      auto it = labels.find(successor);
      if (it == labels.end() || it->second.empty()) {
        continue;
      }
      llvm::SmallString<32> buffer;
      switchCase.getCaseValue()->getValue().toString(buffer, 10, false);
      cases.push_back({std::string(buffer.str()), it->second});
    }

    const auto emitCaseCheck =
        [&](std::vector<std::string> &blockLines,
            const std::string &condition,
            const RelevantCase &caseValue,
            const std::string &nextLabel) {
          if (!nextLabel.empty()) {
            blockLines.push_back("neqj " + condition + ", " + caseValue.value +
                                 ", @" + nextLabel);
          }
          blockLines.push_back("goto @" + caseValue.label);
        };

    const std::string condition = renderValue(switchInst.getCondition());
    if (cases.empty()) {
      if (!defaultLabel.empty()) {
        lines.push_back("goto @" + defaultLabel);
      }
      return;
    }
    if (cases.size() == 1) {
      emitCaseCheck(lines, condition, cases.front(), defaultLabel);
      return;
    }

    std::vector<std::string> checkLabels;
    for (size_t index = 1; index < cases.size(); ++index) {
      checkLabels.push_back("bb_switch_" + std::to_string(labelCounter_++));
    }

    emitCaseCheck(lines, condition, cases.front(), checkLabels.front());
    for (size_t index = 1; index < cases.size(); ++index) {
      TraceBlock checkBlock;
      checkBlock.label = checkLabels[index - 1];
      const std::string nextLabel =
          index == cases.size() - 1 ? defaultLabel : checkLabels[index];
      emitCaseCheck(checkBlock.lines, condition, cases[index], nextLabel);
      trace.blocks.push_back(std::move(checkBlock));
    }
  }

  void emitCall(const CallBase &call, std::vector<std::string> &lines) {
    const Function *callee =
        llvm::dyn_cast<Function>(call.getCalledOperand()->stripPointerCasts());
    if (callee && callee->isIntrinsic()) {
      if (const auto *dbgValue = llvm::dyn_cast<DbgValueInst>(&call)) {
        captureDebugValue(*dbgValue);
      }
      return;
    }
    if (!callee) {
      const auto resolved = resolveIndirectCallees(call);
      bool emitted = false;
      if (resolved) {
        for (const std::string &calleeName : *resolved) {
          const Function *resolvedCallee = module_.getFunction(calleeName);
          if (!resolvedCallee || resolvedCallee->isIntrinsic()) {
            continue;
          }
          if (!functionInPhaseScope(resolvedCallee)) {
            continue;
          }
          if (!indirectCalleeMatchesCall(*resolvedCallee, call)) {
            continue;
          }
          emitResolvedCall(*resolvedCallee, call, lines);
          emitted = true;
        }
      }
      if (!emitted) {
        for (const std::string &calleeName : resolveIndirectCalleesByHint(call)) {
          const Function *resolvedCallee = module_.getFunction(calleeName);
          if (!resolvedCallee || resolvedCallee->isIntrinsic()) {
            continue;
          }
          if (!functionInPhaseScope(resolvedCallee)) {
            continue;
          }
          emitResolvedCall(*resolvedCallee, call, lines);
          emitted = true;
        }
      }
      return;
    }
    emitResolvedCall(*callee, call, lines);
  }

  bool shouldForceTraceBuild(const Function &callee, const CallBase &call) {
    if (callee.isDeclaration() || isFunctionRelevant(callee)) {
      return false;
    }
    if (call.getType()->isVoidTy() || call.use_empty()) {
      return false;
    }
    const StringRef name = callee.getName();
    if (name != "virtio_has_feature" && name != "__virtio_test_bit" &&
        name != "virtnet_cpu_notif_add") {
      return false;
    }
    return true;
  }

  std::optional<std::string> renderSemanticHelperCall(
      const Function &callee,
      const CallBase &call) {
    if (callee.getName() != "vring_notification_data") {
      return std::nullopt;
    }
    if (call.arg_size() < 1) {
      return std::nullopt;
    }
    const std::string queue = renderValue(call.getArgOperand(0));
    if (queue == "unknown") {
      return std::nullopt;
    }
    return "((" + queue + ".next_avail_or_off_wrap) << 16) | (" +
           queue + ".index)";
  }

  void emitResolvedCall(const Function &callee,
                        const CallBase &call,
                        std::vector<std::string> &lines) {
    StringRef name = callee.getName();
    if (isPrunedHelper(name)) {
      return;
    }
    if (isSyntheticDmaTraceTarget(name)) {
      emitSyntheticDmaCall(callee, call, lines);
      return;
    }
    if (isReadLeaf(name)) {
      observeVirtioMmioAccess(name, call, true);
      const unsigned width = ioWidthFromName(name);
      const std::string scratch = nameForValue(&call);
      valueNames_[&call] = scratch;
      const std::string address =
          call.arg_size() >= 1 ? renderValue(call.getArgOperand(call.arg_size() - 1))
                               : "unknown";
      lines.push_back(scratch + " = read" + std::to_string(width) + "(" + address +
                      ")");
      return;
    }

    if (isWriteLeaf(name)) {
      observeVirtioMmioAccess(name, call, false);
      const unsigned width = ioWidthFromName(name);
      const std::string value =
          call.arg_size() >= 1 ? renderValue(call.getArgOperand(0)) : "unknown";
      const std::string address =
          call.arg_size() >= 2 ? renderValue(call.getArgOperand(1)) : "unknown";
      lines.push_back("write" + std::to_string(width) + "(" + value + ", " +
                      address + ")");
      return;
    }

    if (isSgFunction(name)) {
      lines.push_back("call " + sanitizeToken(name) + renderCallArgs(call));
      return;
    }

    if (renderSemanticHelperCall(callee, call)) {
      return;
    }

    const bool forceTrace = shouldForceTraceBuild(callee, call);
    if (!forceTrace && !isFunctionRelevant(callee)) {
      return;
    }

    const bool specialize = functionNeedsDmaContext(callee);
    const std::string callBaseName =
        specialize ? specializedBaseNameForCall(callee, call)
                   : baseNameForFunction(callee);

    if (!call.getType()->isVoidTy() && !call.use_empty()) {
      const std::string resultName =
          preferredCallResultName(call, &callee).value_or(nameForValue(&call));
      valueNames_[&call] = resultName;
      lines.push_back(resultName + " = " + callBaseName +
                      renderCallExprArgs(call));
    } else {
      lines.push_back("call " + callBaseName + renderCallArgs(call));
    }

    if (!callee.isDeclaration()) {
      const bool savedTraceEntry = currentTraceEntry_;
      auto savedBlockRelevance = blockRelevanceCache_;
      auto savedBlockExit = blockExitCache_;
      buildTrace(*const_cast<Function *>(&callee), forceTrace, callBaseName,
                 specialize ? &call : nullptr);
      currentTraceEntry_ = savedTraceEntry;
      blockRelevanceCache_ = std::move(savedBlockRelevance);
      blockExitCache_ = std::move(savedBlockExit);
    }
  }

  static const Value *stripPointerCastsAndGep(const Value *value) {
    const Value *current = value;
    while (current) {
      if (const auto *cast = llvm::dyn_cast<llvm::CastInst>(current)) {
        current = cast->getOperand(0);
        continue;
      }
      if (const auto *gep = llvm::dyn_cast<llvm::GetElementPtrInst>(current)) {
        current = gep->getPointerOperand();
        continue;
      }
      if (const auto *ce = llvm::dyn_cast<llvm::ConstantExpr>(current)) {
        if (ce->isCast() || ce->getOpcode() == llvm::Instruction::GetElementPtr) {
          current = ce->getOperand(0);
          continue;
        }
      }
      break;
    }
    return current;
  }

  static bool sameUnderlyingPointer(const Value *lhs, const Value *rhs) {
    return stripPointerCastsAndGep(lhs) == stripPointerCastsAndGep(rhs);
  }

  static PointerAccessPath pointerAccessPathFor(const Value *value) {
    PointerAccessPath path;
    const Value *current = value;
    llvm::SmallVector<int64_t, 8> reversed;
    while (current) {
      if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(current)) {
        bool ok = true;
        for (const llvm::Use &indexUse : gep->indices()) {
          const auto *ci = llvm::dyn_cast<ConstantInt>(indexUse.get());
          if (!ci) {
            ok = false;
            break;
          }
          reversed.push_back(ci->getSExtValue());
        }
        if (!ok) {
          break;
        }
        current = gep->getPointerOperand();
        continue;
      }
      if (const auto *ce = llvm::dyn_cast<llvm::ConstantExpr>(current)) {
        if (ce->getOpcode() == llvm::Instruction::GetElementPtr) {
          bool ok = true;
          for (unsigned i = 1; i < ce->getNumOperands(); ++i) {
            const auto *ci = llvm::dyn_cast<ConstantInt>(ce->getOperand(i));
            if (!ci) {
              ok = false;
              break;
            }
            reversed.push_back(ci->getSExtValue());
          }
          if (!ok) {
            break;
          }
          current = ce->getOperand(0);
          continue;
        }
        if (ce->isCast()) {
          current = ce->getOperand(0);
          continue;
        }
      }
      if (const auto *inst = llvm::dyn_cast<Instruction>(current)) {
        if (inst->getOpcode() == llvm::Instruction::BitCast ||
            inst->getOpcode() == llvm::Instruction::AddrSpaceCast) {
          current = inst->getOperand(0);
          continue;
        }
      }
      break;
    }
    path.base = current;
    path.exact = path.base != nullptr;
    path.indices.assign(reversed.rbegin(), reversed.rend());
    return path;
  }

  static bool samePointerAccessPath(const Value *lhs, const Value *rhs) {
    const PointerAccessPath lhsPath = pointerAccessPathFor(lhs);
    const PointerAccessPath rhsPath = pointerAccessPathFor(rhs);
    const Value *lhsBase =
        lhsPath.base ? lhsPath.base->stripPointerCasts() : nullptr;
    const Value *rhsBase =
        rhsPath.base ? rhsPath.base->stripPointerCasts() : nullptr;
    return lhsPath.exact && rhsPath.exact &&
           lhsBase == rhsBase &&
           lhsPath.indices == rhsPath.indices;
  }

  static bool gepIndicesMatch(const Value *value,
                              llvm::ArrayRef<int64_t> indices,
                              const Value *base) {
    const PointerAccessPath path = pointerAccessPathFor(value);
    const Value *pathBase =
        path.base ? path.base->stripPointerCasts() : nullptr;
    const Value *wantBase = base ? base->stripPointerCasts() : nullptr;
    if (path.indices.size() != indices.size()) {
      return false;
    }
    for (size_t i = 0; i < path.indices.size(); ++i) {
      if (path.indices[i] != indices[i]) {
        return false;
      }
    }
    return path.exact && pathBase == wantBase;
  }

  const Value *remapPathAcrossCall(const PointerAccessPath &path,
                                   const Function *callee,
                                   const CallBase *call) const {
    const auto *arg = llvm::dyn_cast<llvm::Argument>(path.base);
    if (!arg || arg->getParent() != callee) {
      return nullptr;
    }
    const unsigned argNo = arg->getArgNo();
    if (call->arg_size() <= argNo) {
      return nullptr;
    }
    const Value *actualBase = call->getArgOperand(argNo);
    if (path.indices.empty()) {
      return actualBase;
    }
    if (const auto *inst = llvm::dyn_cast<Instruction>(actualBase)) {
      for (const llvm::User *user : inst->users()) {
        if (gepIndicesMatch(user, path.indices, actualBase)) {
          return user;
        }
      }
    }
    for (const BasicBlock &block : *call->getFunction()) {
      for (const Instruction &instruction : block) {
        if (gepIndicesMatch(&instruction, path.indices, actualBase)) {
          return &instruction;
        }
      }
    }
    return actualBase;
  }

  const Value *findInterproceduralStoredValueForPointer(const Value *pointer,
                                                        const Instruction *context,
                                                        unsigned depth = 0) {
    if (!pointer || !context || depth > 2) {
      return nullptr;
    }
    const PointerAccessPath path = pointerAccessPathFor(pointer);
    std::optional<int64_t> byteOffset;
    if (auto offsetInfo = pointerByteOffsetFor(pointer)) {
      byteOffset = offsetInfo->second;
    }
    const auto *arg = llvm::dyn_cast<llvm::Argument>(path.base);
    if (!path.exact || !arg || arg->getParent() != context->getFunction()) {
      return nullptr;
    }
    return findInterproceduralStoredValueForPath(path, byteOffset, context, depth);
  }

  std::optional<std::pair<const Value *, int64_t>>
  pointerByteOffsetFor(const Value *pointer) const {
    if (!pointer) {
      return std::nullopt;
    }
    const DataLayout &dl = module_.getDataLayout();
    const Value *current = pointer;
    int64_t total = 0;
    while (current) {
      if (const auto *gep = llvm::dyn_cast<llvm::GEPOperator>(current)) {
        llvm::APInt offset(64, 0, true);
        if (!gep->accumulateConstantOffset(dl, offset)) {
          return std::nullopt;
        }
        total += offset.getSExtValue();
        current = gep->getPointerOperand();
        continue;
      }
      if (const auto *ce = llvm::dyn_cast<llvm::ConstantExpr>(current)) {
        if (ce->isCast()) {
          current = ce->getOperand(0);
          continue;
        }
      }
      if (const auto *instruction = llvm::dyn_cast<Instruction>(current)) {
        if (instruction->getOpcode() == llvm::Instruction::BitCast ||
            instruction->getOpcode() == llvm::Instruction::AddrSpaceCast) {
          current = instruction->getOperand(0);
          continue;
        }
      }
      break;
    }
    if (!current) {
      return std::nullopt;
    }
    return std::pair<const Value *, int64_t>{current, total};
  }

  const StoreInst *findUniqueStoreForAccessPath(const Value *base,
                                                llvm::ArrayRef<int64_t> indices,
                                                const Instruction *context) {
    if (!base || !context) {
      return nullptr;
    }
    const Function *function = context->getFunction();
    if (!function || indices.empty()) {
      return nullptr;
    }
    const StoreInst *match = nullptr;
    for (const BasicBlock &block : *function) {
      for (const Instruction &instruction : block) {
        const auto *store = llvm::dyn_cast<StoreInst>(&instruction);
        if (!store) {
          continue;
        }
        if (!gepIndicesMatch(store->getPointerOperand(), indices, base)) {
          continue;
        }
        if (match && match != store) {
          return nullptr;
        }
        match = store;
      }
    }
    return match;
  }

  const StoreInst *findUniqueStoreForByteOffset(const Value *base,
                                                int64_t byteOffset,
                                                const Instruction *context) const {
    if (!base || !context) {
      return nullptr;
    }
    const Function *function = context->getFunction();
    if (!function) {
      return nullptr;
    }
    const Value *wantBase = base->stripPointerCasts();
    const StoreInst *match = nullptr;
    for (const BasicBlock &block : *function) {
      for (const Instruction &instruction : block) {
        const auto *store = llvm::dyn_cast<StoreInst>(&instruction);
        if (!store) {
          continue;
        }
        auto candidate = pointerByteOffsetFor(store->getPointerOperand());
        const Value *candidateBase =
            candidate && candidate->first ? candidate->first->stripPointerCasts()
                                          : nullptr;
        if (!candidate || candidateBase != wantBase ||
            candidate->second != byteOffset) {
          continue;
        }
        if (match && match != store) {
          return nullptr;
        }
        match = store;
      }
    }
    return match;
  }

  const Value *findInterproceduralStoredValueForPath(const PointerAccessPath &path,
                                                     std::optional<int64_t> byteOffset,
                                                     const Instruction *context,
                                                     unsigned depth = 0) {
    if (!path.exact || !path.base || !context || depth > 2) {
      return nullptr;
    }
    const auto *arg = llvm::dyn_cast<llvm::Argument>(path.base);
    if (!arg) {
      return nullptr;
    }
    const Function *callee = context->getFunction();
    const Value *resolved = nullptr;
    bool conflict = false;
    forEachPhaseCallsiteToFunction(
        *callee, [&](const CallBase &callsite) {
          if (conflict) {
            return;
          }
          if (callsite.arg_size() <= arg->getArgNo()) {
            return;
          }
          const Value *actualBase = callsite.getArgOperand(arg->getArgNo());
          const Instruction *callInst = llvm::dyn_cast<Instruction>(&callsite);
          if (!callInst) {
            return;
          }
          const Value *stored = nullptr;
          if (path.indices.empty()) {
            stored = findStoredValueForPointer(actualBase, callInst);
          } else if (const StoreInst *store =
                         findUniqueStoreForAccessPath(actualBase, path.indices,
                                                      callInst)) {
            stored = store->getValueOperand();
          } else if (byteOffset) {
            if (const StoreInst *store =
                    findUniqueStoreForByteOffset(actualBase, *byteOffset,
                                                 callInst)) {
              stored = store->getValueOperand();
            }
          }
          if (!stored) {
            PointerAccessPath nextPath;
            nextPath.base = actualBase;
            nextPath.indices = path.indices;
            nextPath.exact = true;
            stored = findInterproceduralStoredValueForPath(nextPath, byteOffset,
                                                           callInst,
                                                           depth + 1);
          }
          if (!stored) {
            return;
          }
          if (!resolved) {
            resolved = stored;
            return;
          }
          if (resolved != stored) {
            conflict = true;
          }
        });
    if (conflict) {
      return nullptr;
    }
    return resolved;
  }

