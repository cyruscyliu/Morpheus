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
    if (!renderingValues_.insert(value).second) {
      if (value->hasName()) {
        return sanitizeToken(value->getName());
      }
      return "unknown";
    }
    auto guard = llvm::make_scope_exit([&] { renderingValues_.erase(value); });
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
        if (auto helperExpr = renderSemanticHelperCall(*callee, *call)) {
          return *helperExpr;
        }
        auto it = valueNames_.find(call);
        if (it != valueNames_.end() && !isLowSignalLocalName(it->second)) {
          return it->second;
        }
        if (callee->getName() == "devm_platform_ioremap_resource") {
          return "mmio_base";
        }
        if (isPrunedHelper(callee->getName())) {
          if (const auto passthrough =
                  passthroughArgumentIndexForPrunedHelper(callee->getName())) {
            if (*passthrough < call->arg_size()) {
              return renderValue(call->getArgOperand(*passthrough));
            }
          }
          return "unknown";
        }
        if (!isReadLeaf(callee->getName()) &&
            !isWriteLeaf(callee->getName()) &&
            !isSgFunction(callee->getName())) {
          if (call->getType()->isPointerTy()) {
            return sanitizeToken(callee->getName()) + renderCallExprArgs(*call);
          }
          if (!call->getType()->isVoidTy()) {
            if (auto preferred = preferredCallResultName(*call)) {
              return *preferred;
            }
            return nameForValue(call);
          }
          return "unknown";
        }
        return sanitizeToken(callee->getName()) + renderCallExprArgs(*call);
      }
      if (auto it = valueNames_.find(call); it != valueNames_.end()) {
        return it->second;
      }
      if (!call->getType()->isVoidTy()) {
        return nameForValue(call);
      }
      return "unknown";
    }
    if (const auto *instruction = llvm::dyn_cast<Instruction>(value)) {
      if ((llvm::isa<GetElementPtrInst>(instruction) ||
           llvm::isa<LoadInst>(instruction)) &&
          valueNames_.find(instruction) != valueNames_.end()) {
        return valueNames_.find(instruction)->second;
      }
      if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(instruction)) {
        llvm::APInt offset(module_.getDataLayout().getPointerSizeInBits(
                               gep->getPointerAddressSpace()),
                           0, true);
        if (gep->accumulateConstantOffset(module_.getDataLayout(), offset)) {
          const std::string base = renderValue(gep->getPointerOperand());
          if (auto fieldAccess = renderDebugFieldAccess(*gep, base)) {
            return *fieldAccess;
          }
          llvm::SmallString<32> buffer;
          offset.toString(buffer, 10, true);
          const std::string off = std::string(buffer.str());
          if (off == "0") {
            return base;
          }
          if (!off.empty() && off[0] == '-') {
            return base + " - " + off.substr(1);
          }
          return base + " + " + off;
        }
        if (gep->getSourceElementType()->isIntegerTy(8) &&
            gep->getNumIndices() == 1) {
          const std::string base = renderValue(gep->getPointerOperand());
          const std::string index = renderValue(gep->idx_begin()->get());
          if (base == "unknown") {
            return "unknown";
          }
          if (index == "0") {
            return base;
          }
          return base + " + " + index;
        }
      }
      if (const auto *load = llvm::dyn_cast<LoadInst>(instruction)) {
        if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(
                load->getPointerOperand())) {
          if (auto fieldAccess =
                  renderDebugFieldAccess(*gep, renderValue(gep->getPointerOperand()))) {
            return *fieldAccess;
          }
        }
        if (const Value *storedValue =
                findStoredValueForPointer(load->getPointerOperand(), load)) {
          return renderValue(storedValue);
        }
        if (auto fieldName = inferMmioFieldNameFromLoad(load)) {
          return *fieldName;
        }
        if (auto it = valueNames_.find(load); it != valueNames_.end()) {
          return it->second;
        }
        return renderValue(load->getPointerOperand());
      }
      if (instruction->getOpcode() == llvm::Instruction::BitCast ||
          instruction->getOpcode() == llvm::Instruction::AddrSpaceCast ||
          instruction->getOpcode() == llvm::Instruction::PtrToInt ||
          instruction->getOpcode() == llvm::Instruction::IntToPtr ||
          instruction->getOpcode() == llvm::Instruction::ZExt ||
          instruction->getOpcode() == llvm::Instruction::SExt ||
          instruction->getOpcode() == llvm::Instruction::Trunc ||
          instruction->getOpcode() == llvm::Instruction::FPTrunc ||
          instruction->getOpcode() == llvm::Instruction::FPExt ||
          instruction->getOpcode() == llvm::Instruction::UIToFP ||
          instruction->getOpcode() == llvm::Instruction::SIToFP ||
          instruction->getOpcode() == llvm::Instruction::FPToUI ||
          instruction->getOpcode() == llvm::Instruction::FPToSI) {
        return renderValue(instruction->getOperand(0));
      }
      if (const auto *icmp = llvm::dyn_cast<llvm::ICmpInst>(instruction)) {
        return renderValue(icmp->getOperand(0)) + " " +
               std::string(
                   llvm::CmpInst::getPredicateName(icmp->getPredicate())) +
               " " +
               renderValue(icmp->getOperand(1));
      }
      if (const auto *fcmp = llvm::dyn_cast<llvm::FCmpInst>(instruction)) {
        return renderValue(fcmp->getOperand(0)) + " " +
               std::string(
                   llvm::CmpInst::getPredicateName(fcmp->getPredicate())) +
               " " +
               renderValue(fcmp->getOperand(1));
      }
      if (const auto *phi = llvm::dyn_cast<PHINode>(instruction)) {
        std::set<std::string> incomingValues;
        for (unsigned index = 0; index < phi->getNumIncomingValues(); ++index) {
          incomingValues.insert(renderValue(phi->getIncomingValue(index)));
        }
        if (incomingValues.empty()) {
          return "unknown";
        }
        if (incomingValues.size() == 1) {
          return *incomingValues.begin();
        }
        std::string out = "phi(";
        bool first = true;
        for (const std::string &incoming : incomingValues) {
          if (!first) {
            out += ", ";
          }
          out += incoming;
          first = false;
        }
        out += ")";
        return out;
      }
      if (const auto *select = llvm::dyn_cast<llvm::SelectInst>(instruction)) {
        return "select(" + renderValue(select->getCondition()) + ", " +
               renderValue(select->getTrueValue()) + ", " +
               renderValue(select->getFalseValue()) + ")";
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
      if (instruction->hasName()) {
        if (auto it = valueNames_.find(instruction); it != valueNames_.end()) {
          return it->second;
        }
        return sanitizeToken(instruction->getName());
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

  std::optional<std::string> inferSemanticName(const Value *value) {
    llvm::SmallVector<const Value *, 8> worklist;
    llvm::SmallPtrSet<const Value *, 16> visited;
    worklist.push_back(value);

    while (!worklist.empty()) {
      const Value *current = worklist.pop_back_val();
      if (!current || !visited.insert(current).second) {
        continue;
      }

      for (const llvm::User *user : current->users()) {
        if (const auto *store = llvm::dyn_cast<StoreInst>(user)) {
          if (store->getValueOperand() != current) {
            continue;
          }
          const Value *pointer = store->getPointerOperand();
          if (auto pointerName = inferPointerName(pointer)) {
            return pointerName;
          }
          continue;
        }

        const auto *instruction = llvm::dyn_cast<Instruction>(user);
        if (!instruction) {
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
            worklist.push_back(instruction);
            break;
          default:
            break;
        }
      }
    }

    return std::nullopt;
  }

  std::optional<std::string> inferPointerName(const Value *pointer) {
    const Value *current = pointer;
    llvm::SmallPtrSet<const Value *, 8> visited;

    while (current && visited.insert(current).second) {
      if (auto it = valueNames_.find(current); it != valueNames_.end()) {
        return it->second;
      }
      if (current->hasName()) {
        return sanitizeToken(current->getName());
      }
      if (const auto *instruction = llvm::dyn_cast<Instruction>(current)) {
        switch (instruction->getOpcode()) {
          case llvm::Instruction::Load:
            current = llvm::cast<LoadInst>(instruction)->getPointerOperand();
            continue;
          case llvm::Instruction::BitCast:
          case llvm::Instruction::AddrSpaceCast:
          case llvm::Instruction::GetElementPtr:
            current = instruction->getOperand(0);
            continue;
          default:
            break;
        }
      }
      break;
    }

    return std::nullopt;
  }

  std::string nameForValue(const Value *value) {
    if (value) {
      if (const auto *call = llvm::dyn_cast<CallBase>(value)) {
        if (auto preferred = preferredCallResultName(*call)) {
          model_.scratchVars.insert(*preferred);
          return *preferred;
        }
      }
      if (auto it = valueNames_.find(value); it != valueNames_.end()) {
        model_.scratchVars.insert(it->second);
        return it->second;
      }
      if (auto inferred = inferSemanticName(value)) {
        model_.scratchVars.insert(*inferred);
        return *inferred;
      }
    }
    if (value && value->hasName()) {
      const std::string named = sanitizeToken(value->getName());
      model_.scratchVars.insert(named);
      return named;
    }
    return nextScratch();
  }

  void captureDebugValue(const DbgValueInst &dbgValue) {
    const Value *value = dbgValue.getValue();
    const auto *variable = dbgValue.getVariable();
    if (!value || !variable || llvm::isa<llvm::UndefValue>(value) ||
        llvm::isa<llvm::ConstantPointerNull>(value)) {
      return;
    }
    std::string name = sanitizeToken(variable->getName());
    if (name.empty() || name == "unnamed") {
      return;
    }
    if (const auto *call = llvm::dyn_cast<CallBase>(value)) {
      if (isLowSignalLocalName(name)) {
        if (const Function *callee = llvm::dyn_cast<Function>(
                call->getCalledOperand()->stripPointerCasts())) {
          if (!isReadLeaf(callee->getName()) &&
              !isWriteLeaf(callee->getName()) &&
              !isSgFunction(callee->getName())) {
            const std::string calleeName = sanitizeToken(callee->getName());
            const std::string suffix =
                call->hasName() && isLowSignalLocalName(call->getName())
                    ? sanitizeToken(call->getName())
                    : name;
            if (!calleeName.empty() && !suffix.empty()) {
              name = calleeName + "_" + suffix;
            }
          }
        }
      }
    }
    valueNames_[value] = name;
    model_.scratchVars.insert(name);
  }

  void collectDebugNames(Function &function) {
    for (const BasicBlock &block : function) {
      for (const Instruction &instruction : block) {
        if (const auto *dbgValue = llvm::dyn_cast<DbgValueInst>(&instruction)) {
          captureDebugValue(*dbgValue);
        }
      }
    }
  }

  void noteSchemaLengthImmediate(StringRef schemaType, uint64_t value) {
    const std::string token = sanitizeToken(schemaType);
    if (token.empty()) {
      return;
    }
    model_.schemaLengthImmediates[token].insert(value);
  }

  std::string renderModel() {
    auto traceExists = [&](StringRef traceName) {
      const std::string token = sanitizeToken(traceName);
      return std::find_if(model_.traces.begin(), model_.traces.end(),
                          [&](const TraceModel &trace) {
                            return sanitizeToken(trace.name) == token;
                          }) != model_.traces.end();
    };

    std::vector<std::string> entryTraceNames;
    for (const std::string &entryName : request_.entryFunctions) {
      if (Function *entry = module_.getFunction(entryName)) {
        const std::string traceName = traceNameFor(*entry);
        if (traceExists(traceName)) {
          entryTraceNames.push_back(sanitizeToken(traceName));
        }
      }
    }
    std::vector<std::string> chainedTraceNames = entryTraceNames;
    if (request_.chainedEntries && !bootingTransitionTraceNames_.empty()) {
      chainedTraceNames.clear();
      for (const std::string &traceName : bootingTransitionTraceNames_) {
        const std::string token = sanitizeToken(traceName);
        if (traceExists(token) &&
            !llvm::is_contained(chainedTraceNames, token)) {
          chainedTraceNames.push_back(token);
        }
      }
      if (chainedTraceNames.empty()) {
        chainedTraceNames = entryTraceNames;
      }
    }

    std::ostringstream out;
    std::set<std::string> schemaTypes = model_.schemaTypes;
    if (schemaTypes.find("virtnet_rq_dma") != schemaTypes.end() ||
        schemaTypes.find("virtnet_rq_dma_addr_only") != schemaTypes.end()) {
      schemaTypes.insert("VIRTIO_NET_RX_BUF0");
    }
    std::map<std::string, std::set<std::string>> schemaHeadPositions =
        model_.schemaHeadPositions;
    expandDerivedDmaSchemaTypes(schemaTypes, schemaHeadPositions,
                                model_.schemaObservedFields,
                                model_.schemaLengthImmediates);
    for (const std::string &schemaType : schemaTypes) {
      if (std::optional<std::string> decl =
              renderSchemaDecl(schemaType, model_.explicitSchemas,
                               model_.schemaLengthImmediates,
                               model_.schemaImmediateRanges,
                               model_.mmioObservedBitRanges,
                               model_.mmioObservedBitRangesBySelector)) {
        out << *decl << "\n";
        auto posIt = schemaHeadPositions.find(schemaType);
        if (posIt != schemaHeadPositions.end()) {
          if (std::optional<std::string> head =
                  renderSchemaHead(schemaType, posIt->second)) {
            out << *head << "\n";
          }
        }
      }
    }
    for (const std::string &opName : model_.mmioOpNames) {
      for (uint64_t offset : {0ULL,   4ULL,   8ULL,   12ULL,  16ULL,  20ULL,
                              32ULL,  36ULL,  40ULL,  48ULL,  52ULL,  56ULL,
                              60ULL,  64ULL,  68ULL,  80ULL,  96ULL,  100ULL,
                              112ULL, 128ULL, 132ULL, 144ULL, 148ULL, 160ULL,
                              164ULL, 172ULL, 176ULL, 180ULL, 184ULL, 188ULL,
                              252ULL}) {
        auto info = lookupVirtioMmioRegisterInfo(offset);
        if (!info) {
          continue;
        }
        const bool isRead = opName == sanitizeToken(info->readOpName);
        const bool isWrite = opName == sanitizeToken(info->writeOpName);
        if (!isRead && !isWrite) {
          continue;
        }
        out << "op " << opName << " {\n";
        out << "    mmio " << opName << " {\n";
        out << "        direction = " << (isRead ? "r" : "w") << ";\n";
        out << "        region = 0;\n";
        out << "        address = " << offset << ";\n";
        out << "        size = 4;\n";
        if (isWrite) {
          auto immIt =
              model_.schemaLengthImmediates.find(sanitizeToken(info->schemaName));
          if (immIt != model_.schemaLengthImmediates.end() &&
              immIt->second.size() == 1) {
            out << "        data = " << *immIt->second.begin() << ";\n";
          }
        }
        out << "    }\n";
        out << "}\n\n";
        break;
      }
    }
    for (const auto &op : model_.dynamicMmioOps) {
      out << "op " << op.name << " {\n";
      out << "    mmio " << op.name << " {\n";
      out << "        direction = " << (op.isRead ? "r" : "w") << ";\n";
      out << "        region = 0;\n";
      out << "        address = " << op.offset << ";\n";
      out << "        size = " << op.size << ";\n";
      out << "    }\n";
      out << "}\n\n";
    }
    if (std::optional<std::string> pointers =
            renderSchemaPointers(schemaTypes)) {
      out << *pointers;
    }
    out << "machine " << sanitizeToken(request_.machineName) << " {\n";
    out << "    initial state_0\n";
    out << "\n";
    if (!model_.scratchVars.empty()) {
      out << "    scratch {\n";
      for (const std::string &scratch : model_.scratchVars) {
        out << "        " << scratch << ";\n";
      }
      out << "    }\n\n";
    }
    if (request_.chainedEntries) {
      for (size_t index = 0; index < chainedTraceNames.size(); ++index) {
        out << "    state state_" << index << "\n";
      }
      out << "    state state_" << chainedTraceNames.size() << "\n";
      out << "\n";
      for (size_t index = 0; index < chainedTraceNames.size(); ++index) {
        out << "    transition state_" << index << " -> state_"
            << (index + 1) << " on " << chainedTraceNames[index] << "\n";
      }
      out << "\n";
    } else {
      out << "    state state_0\n";
      out << "\n";
      for (const std::string &entryTraceName : entryTraceNames) {
        out << "    transition state_0 -> state_0 on " << entryTraceName
            << "\n";
      }
      out << "\n";
    }
    for (const TraceModel &trace : model_.traces) {
      out << "    ";
      if (trace.entry) {
        out << "entry ";
      }
      out << "trace " << sanitizeToken(trace.name) << " {\n";
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
    out << "}\n";
    return out.str();
  }

  static std::string dumpHexValue(uint64_t value) {
    std::ostringstream out;
    out << "0x" << std::hex << value;
    return out.str();
  }

  static void writeDumpFile(const std::string &path,
                            const std::string &content) {
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    if (!stream) {
      llvm::errs() << "warning: failed to open analysis dump file " << path
                   << "\n";
      return;
    }
    stream << content;
  }

  void dumpAnalysisIntermediates() {
    if (request_.analysisDumpDir.empty()) {
      return;
    }
    std::error_code error;
    llvm::sys::fs::create_directories(request_.analysisDumpDir);
    if (error) {
      llvm::errs() << "warning: failed to create analysis dump dir "
                   << request_.analysisDumpDir << ": " << error.message()
                   << "\n";
      return;
    }
    const std::string machine = sanitizeToken(request_.machineName);
    writeDumpFile(request_.analysisDumpDir + "/" + machine +
                      "-control-plane.txt",
                  renderControlPlaneDump());
    writeDumpFile(request_.analysisDumpDir + "/" + machine + "-data-plane.txt",
                  renderDataPlaneDump());
  }

  std::string renderControlPlaneDump() const {
    std::ostringstream out;
    out << "machine " << sanitizeToken(request_.machineName) << "\n";
    out << "chained_entries = " << (request_.chainedEntries ? "yes" : "no")
        << "\n";
    for (const std::string &entryName : request_.entryFunctions) {
      out << "entry_function = " << entryName << "\n";
    }
    out << "\n";

    std::vector<std::pair<std::string, std::string>> scopeFunctions;
    for (const Function *function : phaseScopeFunctions_) {
      if (!function) {
        continue;
      }
      scopeFunctions.emplace_back(function->getName().str(),
                                  function->isDeclaration() ? "declaration"
                                                            : "defined");
    }
    std::sort(scopeFunctions.begin(), scopeFunctions.end());
    out << "phase_scope_functions = " << scopeFunctions.size() << "\n";
    for (const auto &[name, state] : scopeFunctions) {
      out << "    " << name << " " << state << "\n";
    }
    out << "\n";

    std::vector<std::string> bridgeFunctions;
    for (const Function *bridge : bootingGraphBridgeFunctions_) {
      if (bridge) {
        bridgeFunctions.push_back(bridge->getName().str());
      }
    }
    std::sort(bridgeFunctions.begin(), bridgeFunctions.end());
    out << "bridge_functions = " << bridgeFunctions.size() << "\n";
    for (const std::string &name : bridgeFunctions) {
      out << "    " << name << "\n";
    }
    out << "\n";

    out << "transition_traces = " << bootingTransitionTraceNames_.size()
        << "\n";
    for (const std::string &traceName : bootingTransitionTraceNames_) {
      out << "    " << traceName << "\n";
    }
    out << "\n";

    std::vector<std::pair<std::string, std::string>> relevanceRows;
    for (const auto &entry : relevanceCache_) {
      const Function *function = entry.first;
      if (!function) {
        continue;
      }
      const char *verdict = "unknown";
      if (entry.second == Relevance::Relevant) {
        verdict = "relevant";
      } else if (entry.second == Relevance::Irrelevant) {
        verdict = "irrelevant";
      }
      relevanceRows.emplace_back(function->getName().str(), verdict);
    }
    std::sort(relevanceRows.begin(), relevanceRows.end());
    out << "function_relevance = " << relevanceRows.size() << "\n";
    for (const auto &[name, verdict] : relevanceRows) {
      out << "    " << name << " " << verdict << "\n";
    }
    out << "\n";

    out << "emitted_trace_bases = " << model_.emittedTraceBases.size() << "\n";
    for (const std::string &base : model_.emittedTraceBases) {
      out << "    " << base << "\n";
    }
    out << "\n";

    out << "traces = " << model_.traces.size() << "\n";
    for (const TraceModel &trace : model_.traces) {
      size_t lineCount = 0;
      for (const TraceBlock &block : trace.blocks) {
        lineCount += block.lines.size();
      }
      out << "    " << sanitizeToken(trace.name)
          << " entry=" << (trace.entry ? "yes" : "no")
          << " blocks=" << trace.blocks.size() << " lines=" << lineCount
          << "\n";
    }
    return out.str();
  }

  std::string renderDataPlaneDump() const {
    std::ostringstream out;
    out << "machine " << sanitizeToken(request_.machineName) << "\n\n";

    std::vector<const MachineModel::DynamicMmioOp *> dynamicOps;
    for (const MachineModel::DynamicMmioOp &op : model_.dynamicMmioOps) {
      dynamicOps.push_back(&op);
    }
    std::sort(dynamicOps.begin(), dynamicOps.end(),
              [](const MachineModel::DynamicMmioOp *lhs,
                 const MachineModel::DynamicMmioOp *rhs) {
                return std::tie(lhs->schemaName, lhs->offset, lhs->name) <
                       std::tie(rhs->schemaName, rhs->offset, rhs->name);
              });
    out << "dynamic_mmio_ops = " << dynamicOps.size() << "\n";
    for (const MachineModel::DynamicMmioOp *op : dynamicOps) {
      out << "    " << op->name << " " << (op->isRead ? "read" : "write")
          << " offset=" << dumpHexValue(op->offset) << " size=" << op->size
          << " schema=" << op->schemaName << "\n";
    }
    out << "\n";

    out << "mmio_op_names = " << model_.mmioOpNames.size() << "\n";
    for (const std::string &name : model_.mmioOpNames) {
      out << "    " << name << "\n";
    }
    out << "\n";

    out << "schema_types = " << model_.schemaTypes.size() << "\n";
    for (const std::string &schema : model_.schemaTypes) {
      out << "    " << schema << "\n";
    }
    out << "\n";

    out << "schema_positions = " << model_.schemaHeadPositions.size() << "\n";
    for (const auto &[schema, positions] : model_.schemaHeadPositions) {
      out << "    " << schema << " count=" << positions.size() << "\n";
      for (const std::string &position : positions) {
        out << "        " << position << "\n";
      }
    }
    out << "\n";

    out << "schema_observed_fields = " << model_.schemaObservedFields.size()
        << "\n";
    for (const auto &[schema, fields] : model_.schemaObservedFields) {
      out << "    " << schema << "\n";
      for (const std::string &field : fields) {
        out << "        " << field << "\n";
      }
    }
    out << "\n";

    out << "schema_length_immediates = "
        << model_.schemaLengthImmediates.size() << "\n";
    for (const auto &[schema, values] : model_.schemaLengthImmediates) {
      for (const uint64_t value : values) {
        out << "    " << schema << " = " << dumpHexValue(value) << "\n";
      }
    }
    out << "\n";

    out << "schema_immediate_ranges = "
        << model_.schemaImmediateRanges.size() << "\n";
    for (const auto &[schema, ranges] : model_.schemaImmediateRanges) {
      for (const auto &range : ranges) {
        out << "    " << schema << " = [" << dumpHexValue(range.first) << ", "
            << dumpHexValue(range.second) << "]\n";
      }
    }
    out << "\n";

    out << "mmio_bit_ranges = " << model_.mmioObservedBitRanges.size() << "\n";
    for (const auto &[schema, ranges] : model_.mmioObservedBitRanges) {
      for (const auto &range : ranges) {
        out << "    " << schema << " bits=[" << range.first << ", "
            << range.second << "]\n";
      }
    }
    out << "\n";

    out << "mmio_bit_ranges_by_selector = "
        << model_.mmioObservedBitRangesBySelector.size() << "\n";
    for (const auto &[schema, bySelector] :
         model_.mmioObservedBitRangesBySelector) {
      for (const auto &[selector, ranges] : bySelector) {
        for (const auto &range : ranges) {
          out << "    " << schema << " selector=" << selector
              << " bits=[" << range.first << ", " << range.second << "]\n";
        }
      }
    }
    out << "\n";

    out << "explicit_schemas = " << model_.explicitSchemas.size() << "\n";
    for (const auto &[schema, decl] : model_.explicitSchemas) {
      out << "    " << schema << " fields=" << decl.fields.size() << "\n";
      for (const MachineModel::ExplicitSchemaField &field : decl.fields) {
        out << "        " << field.name << " : " << field.typeName << "\n";
      }
    }
    out << "\n";

    out << "field_range_hints = " << fieldRangeHints_.size() << "\n";
    for (const auto &entry : fieldRangeHints_) {
      out << "    " << entry.first.first << " offset=" << dumpHexValue(
                            static_cast<uint64_t>(entry.first.second))
          << " = [" << dumpHexValue(entry.second.first) << ", "
          << dumpHexValue(entry.second.second) << "]\n";
    }
    out << "\n";

    std::vector<std::string> readCalls;
    for (const CallBase *call : observedMmioReadSemanticCalls_) {
      if (call) {
        readCalls.push_back(callsiteKeyFor(call));
      }
    }
    std::sort(readCalls.begin(), readCalls.end());
    readCalls.erase(std::unique(readCalls.begin(), readCalls.end()),
                    readCalls.end());
    out << "observed_read_semantic_calls = " << readCalls.size() << "\n";
    for (const std::string &callsite : readCalls) {
      out << "    " << callsite << "\n";
    }
    out << "\n";

    std::vector<std::string> writeCalls;
    for (const CallBase *call : observedMmioWriteSemanticCalls_) {
      if (call) {
        writeCalls.push_back(callsiteKeyFor(call));
      }
    }
    std::sort(writeCalls.begin(), writeCalls.end());
    writeCalls.erase(std::unique(writeCalls.begin(), writeCalls.end()),
                     writeCalls.end());
    out << "observed_write_semantic_calls = " << writeCalls.size() << "\n";
    for (const std::string &callsite : writeCalls) {
      out << "    " << callsite << "\n";
    }
    out << "\n";

    out << "emitted_synthetic_traces = "
        << emittedSyntheticTraces_.size() << "\n";
    for (const std::string &traceName : emittedSyntheticTraces_) {
      out << "    " << traceName << "\n";
    }
    return out.str();
  }
};

}  // namespace
