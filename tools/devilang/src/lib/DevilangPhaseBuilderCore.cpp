class PhaseBuilder {
public:
  PhaseBuilder(
      Module &module,
      PhaseRequest request,
      const std::map<std::string, std::vector<std::string>> &indirectCalls,
      const std::map<std::string, std::vector<std::string>> &functionEdges,
      const std::map<std::string, std::vector<std::string>> &pointsToHints,
      const std::map<std::string, std::vector<std::string>> &pointsToFieldHints,
      const std::map<std::string, std::vector<std::string>> &pointsToCallHints,
      const std::map<std::string, std::vector<std::string>> &pointsToUseSiteHints,
      llvm::FunctionAnalysisManager *functionAnalysisManager)
      : module_(module),
        request_(std::move(request)),
        indirectCalls_(indirectCalls),
        functionEdges_(functionEdges),
        pointsToHints_(pointsToHints),
        pointsToFieldHints_(pointsToFieldHints),
        pointsToCallHints_(pointsToCallHints),
        pointsToUseSiteHints_(pointsToUseSiteHints),
        functionAnalysisManager_(functionAnalysisManager) {
    model_.name = request_.machineName;
  }

  std::string build() {
    phaseScopeFunctions_.clear();
    bootingTransitionTraceNames_.clear();
    for (const std::string &entryName : request_.entryFunctions) {
      if (Function *entry = module_.getFunction(entryName)) {
        collectPhaseScopeFunction(entry);
      }
    }
    collectBootingGraphProbeBridges();
    if (request_.chainedEntries) {
      if (Function *virtioDevProbe = module_.getFunction("virtio_dev_probe")) {
        if (!llvm::is_contained(bootingGraphBridgeFunctions_,
                                static_cast<const Function *>(virtioDevProbe))) {
          bootingGraphBridgeFunctions_.push_back(virtioDevProbe);
        }
      }
    }
    bootingTransitionTraceNames_ = collectBootingTransitionTraceNames();
    for (const Function *function : phaseScopeFunctions_) {
      if (function && !function->isDeclaration()) {
        collectDebugNames(*const_cast<Function *>(function));
      }
    }
    for (const Function *bridge : bootingGraphBridgeFunctions_) {
      if (bridge && !bridge->isDeclaration()) {
        collectDebugNames(*const_cast<Function *>(bridge));
      }
    }
    collectPhaseFieldRangeHints();
    collectGlobalMmioSemantics();
    collectPhaseConfigMmioSemantics();
    collectPhaseMmioValueSemantics();
    collectPhaseDriverFeatureTableSemantics();
    collectPhaseDeviceIdSemantics();
    for (const Function *bridge : bootingGraphBridgeFunctions_) {
      if (bridge) {
        buildTrace(*const_cast<Function *>(bridge), true);
      }
    }
    for (const std::string &entryName : request_.entryFunctions) {
      if (Function *entry = module_.getFunction(entryName)) {
        buildTrace(*entry);
      }
    }
    collectTraceModelConfigMmioSemantics();
    return renderModel();
  }

private:
  enum class Relevance {
    Unknown,
    Visiting,
    Relevant,
    Irrelevant,
  };

  struct TraceBuildFrame {
    const Function *function = nullptr;
    const CallBase *caller = nullptr;
    std::string baseName;
  };

  Module &module_;
  PhaseRequest request_;
  MachineModel model_;
  unsigned scratchCounter_ = 0;
  unsigned labelCounter_ = 0;
  const std::map<std::string, std::vector<std::string>> &indirectCalls_;
  const std::map<std::string, std::vector<std::string>> &functionEdges_;
  const std::map<std::string, std::vector<std::string>> &pointsToHints_;
  const std::map<std::string, std::vector<std::string>> &pointsToFieldHints_;
  const std::map<std::string, std::vector<std::string>> &pointsToCallHints_;
  const std::map<std::string, std::vector<std::string>> &pointsToUseSiteHints_;
  llvm::FunctionAnalysisManager *functionAnalysisManager_ = nullptr;
  std::map<const Function *, Relevance> relevanceCache_;
  std::map<const BasicBlock *, Relevance> blockRelevanceCache_;
  std::map<const BasicBlock *, Relevance> blockExitCache_;
  std::map<const Value *, std::string> valueNames_;
  std::map<std::pair<std::string, int64_t>, std::pair<uint64_t, uint64_t>>
      fieldRangeHints_;
  std::set<const Value *> renderingValues_;
  bool currentTraceEntry_ = false;
  std::vector<std::string> bootingTransitionTraceNames_;
  std::set<std::string> emittedSyntheticTraces_;
  std::vector<TraceBuildFrame> traceBuildStack_;
  std::set<const Function *> phaseScopeFunctions_;
  std::vector<const Function *> bootingGraphBridgeFunctions_;
  std::set<const CallBase *> observedMmioReadSemanticCalls_;
  std::set<const CallBase *> observedMmioWriteSemanticCalls_;

  static constexpr size_t kMaxMmioSemanticSlices = 256;

  std::string callsiteKeyFor(const Instruction *inst) const {
    if (!inst) {
      return "";
    }
    const llvm::DebugLoc &debugLoc = inst->getDebugLoc();
    if (!debugLoc) {
      return "";
    }
    const llvm::DILocation *location = debugLoc.get();
    const llvm::DIScope *scope = location->getScope();
    const auto *file = scope ? scope->getFile() : nullptr;
    if (!file) {
      return "";
    }
    const std::string filename = trimPath(file->getFilename());
    const std::string directory = trimPath(file->getDirectory());
    const unsigned line = location->getLine();
    if (filename.empty() || line == 0) {
      return "";
    }
    if (!directory.empty()) {
      return directory + "/" + filename + ":" + std::to_string(line);
    }
    return filename + ":" + std::to_string(line);
  }

  bool functionInSourceFile(const Function &function, StringRef suffix) const {
    const auto *subprogram = function.getSubprogram();
    if (!subprogram) {
      return false;
    }
    const auto *file = subprogram->getFile();
    if (!file) {
      return false;
    }
    const std::string filename = trimPath(file->getFilename());
    const std::string directory = trimPath(file->getDirectory());
    std::string combined = filename;
    if (!directory.empty()) {
      combined = directory;
      if (!combined.empty() && combined.back() != '/') {
        combined += "/";
      }
      combined += filename;
    }
    return filename == suffix || combined == suffix ||
           StringRef(combined).endswith(suffix) ||
           StringRef(filename).endswith(suffix);
  }

  bool shouldCollectGlobalMmioFor(const Function &function) const {
    return functionInSourceFile(function, "virtio_mmio.c");
  }

  static bool isTransportHeadNoisePosition(StringRef position) {
    return position.contains("caller = virtqueue_") ||
           position.contains("caller = vring_") ||
           position.contains("callee = virtqueue_") ||
           position.contains("callee = vring_");
  }

  std::vector<std::string> currentSchemaPositionsFor(StringRef calleeName,
                                                     unsigned argIndex) const {
    auto renderPosition = [&](const TraceBuildFrame &frame,
                              unsigned depth) -> std::string {
      if (!frame.caller) {
        return "";
      }
      std::string fileToken = "generated";
      if (const Instruction *inst = llvm::dyn_cast<Instruction>(frame.caller)) {
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
      return "[file = " + fileToken + "; caller = " +
             sanitizeToken(frame.caller->getFunction()->getName()) +
             "; callee = " + sanitizeToken(calleeName) +
             "; call_depth = " + std::to_string(depth) +
             "; argument_index = " + std::to_string(argIndex) + "]";
    };

    std::vector<std::string> currentPositions;
    if (traceBuildStack_.empty()) {
      return currentPositions;
    }
    unsigned depth = 0;
    const TraceBuildFrame *nearest = nullptr;
    const TraceBuildFrame *surface = nullptr;
    for (auto it = traceBuildStack_.rbegin(); it != traceBuildStack_.rend();
         ++it, ++depth) {
      if (!it->caller) {
        continue;
      }
      if (!nearest) {
        nearest = &*it;
      }
      const StringRef callerName = it->caller->getFunction()->getName();
      const StringRef fnName = it->function->getName();
      if (!surface &&
          !isQueueTransportFunctionName(callerName) &&
          !isQueueTransportFunctionName(fnName) &&
          std::find(request_.entryFunctions.begin(), request_.entryFunctions.end(),
                    callerName.str()) != request_.entryFunctions.end()) {
        surface = &*it;
        break;
      }
      if (!surface &&
          !isQueueTransportFunctionName(callerName) &&
          !isQueueTransportFunctionName(fnName)) {
        surface = &*it;
      }
    }
    if (nearest) {
      currentPositions.push_back(renderPosition(*nearest, 0));
    }
    if (surface && surface != nearest) {
      unsigned surfaceDepth = 0;
      for (auto it = traceBuildStack_.rbegin(); it != traceBuildStack_.rend();
           ++it, ++surfaceDepth) {
        if (&*it == surface) {
          currentPositions.push_back(renderPosition(*surface, surfaceDepth));
          break;
        }
      }
    }
    if (currentPositions.empty()) {
      currentPositions.push_back("[file = generated; caller = " +
                                 sanitizeToken(traceBuildStack_.back().baseName) +
                                 "; callee = " + sanitizeToken(calleeName) +
                                 "; call_depth = 0; argument_index = " +
                                 std::to_string(argIndex) + "]");
    }
    return currentPositions;
  }

  bool isVirtioMmioBaseValue(const Value *value) {
    if (!value) {
      return false;
    }
    const Value *stripped = value->stripPointerCasts();
    if (auto pointerName = inferPointerName(stripped)) {
      return *pointerName == "base" || *pointerName == "mmio_base";
    }
    if (const auto *call = llvm::dyn_cast<CallBase>(stripped)) {
      if (const auto *callee = llvm::dyn_cast<Function>(
              call->getCalledOperand()->stripPointerCasts())) {
        if (callee->getName() == "devm_platform_ioremap_resource") {
          return true;
        }
      }
    }
    if (const auto *load = llvm::dyn_cast<LoadInst>(stripped)) {
      if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(
              load->getPointerOperand()->stripPointerCasts())) {
        llvm::APInt offset(module_.getDataLayout().getPointerSizeInBits(
                               gep->getPointerAddressSpace()),
                           0, true);
        if (gep->accumulateConstantOffset(module_.getDataLayout(), offset) &&
            offset.getSExtValue() == 872) {
          return true;
        }
      }
    }
    return false;
  }

  std::optional<uint64_t> inferRenderedVirtioMmioOffset(StringRef rendered) {
    rendered = rendered.trim();
    if (rendered == "mmio_base" || rendered == "base") {
      return 0;
    }
    for (StringRef prefix : {"mmio_base + ", "base + "}) {
      if (!rendered.startswith(prefix)) {
        continue;
      }
      uint64_t offset = 0;
      if (!rendered.substr(prefix.size()).getAsInteger(10, offset)) {
        return offset;
      }
    }
    return std::nullopt;
  }

  bool isVirtioMmioDeviceFieldPointer(const Value *pointer,
                                      int64_t expectedOffset) {
    if (!pointer) {
      return false;
    }
    const auto *gep = llvm::dyn_cast<GetElementPtrInst>(
        pointer->stripPointerCasts());
    if (!gep) {
      return false;
    }
    llvm::APInt offset(module_.getDataLayout().getPointerSizeInBits(
                           gep->getPointerAddressSpace()),
                       0, true);
    return gep->accumulateConstantOffset(module_.getDataLayout(), offset) &&
           offset.getSExtValue() == expectedOffset;
  }

  std::optional<std::string> inferMmioFieldNameFromLoad(const LoadInst *load) {
    if (!load) {
      return std::nullopt;
    }
    if (isVirtioMmioDeviceFieldPointer(load->getPointerOperand(), 872)) {
      return std::string("mmio_base");
    }
    if (isVirtioMmioDeviceFieldPointer(load->getPointerOperand(), 880)) {
      return std::string("version");
    }
    return std::nullopt;
  }

  const Function *functionForValue(const Value *value) const {
    if (!value) {
      return nullptr;
    }
    if (const auto *instruction = llvm::dyn_cast<Instruction>(value)) {
      return instruction->getFunction();
    }
    if (const auto *argument = llvm::dyn_cast<llvm::Argument>(value)) {
      return argument->getParent();
    }
    return nullptr;
  }

  std::optional<uint64_t> inferVirtioMmioOffset(const Value *addressValue,
                                                bool allowRenderFallback = true) {
    if (!addressValue) {
      return std::nullopt;
    }
    const Value *stripped = addressValue->stripPointerCasts();
    if (isVirtioMmioBaseValue(stripped)) {
      return 0;
    }
    if (const auto *gep = llvm::dyn_cast<GetElementPtrInst>(stripped)) {
      llvm::APInt offsetBits(64, 0);
      if (gep->accumulateConstantOffset(module_.getDataLayout(), offsetBits) &&
          isVirtioMmioBaseValue(gep->getPointerOperand())) {
        return offsetBits.getZExtValue();
      }
    }
    if (const auto *instruction = llvm::dyn_cast<Instruction>(stripped)) {
      if (instruction->getOpcode() == llvm::Instruction::Add &&
          instruction->getNumOperands() == 2) {
        const Value *lhs = instruction->getOperand(0);
        const Value *rhs = instruction->getOperand(1);
        if (auto rhsConst = constantValueFor(rhs); rhsConst &&
            isVirtioMmioBaseValue(lhs)) {
          return *rhsConst;
        }
        if (auto lhsConst = constantValueFor(lhs); lhsConst &&
            isVirtioMmioBaseValue(rhs)) {
          return *lhsConst;
        }
      }
    }
    if (allowRenderFallback) {
      if (auto renderedOffset =
              inferRenderedVirtioMmioOffset(renderValue(addressValue))) {
        return renderedOffset;
      }
    }
    return std::nullopt;
  }

  std::optional<uint64_t> constantValueFor(const Value *value) {
    if (!value) {
      return std::nullopt;
    }
    if (const auto *ci = llvm::dyn_cast<ConstantInt>(value)) {
      return ci->getZExtValue();
    }
    if (const auto *instruction = llvm::dyn_cast<Instruction>(value)) {
      if (instruction->getOpcode() == llvm::Instruction::BitCast ||
          instruction->getOpcode() == llvm::Instruction::AddrSpaceCast ||
          instruction->getOpcode() == llvm::Instruction::PtrToInt ||
          instruction->getOpcode() == llvm::Instruction::IntToPtr ||
          instruction->getOpcode() == llvm::Instruction::ZExt ||
          instruction->getOpcode() == llvm::Instruction::SExt ||
          instruction->getOpcode() == llvm::Instruction::Trunc) {
        return constantValueFor(instruction->getOperand(0));
      }
      if ((instruction->getOpcode() == llvm::Instruction::Add ||
           instruction->getOpcode() == llvm::Instruction::Or) &&
          instruction->getNumOperands() == 2) {
        if (auto lhs = constantValueFor(instruction->getOperand(0));
            lhs && *lhs == 0) {
          return constantValueFor(instruction->getOperand(1));
        }
        if (auto rhs = constantValueFor(instruction->getOperand(1));
            rhs && *rhs == 0) {
          return constantValueFor(instruction->getOperand(0));
        }
      }
    }
    return std::nullopt;
  }

  static std::optional<unsigned> fixedVirtioConfigWidthFromHelperName(
      StringRef calleeName) {
    if (calleeName.endswith("cread8") || calleeName.endswith("cwrite8")) {
      return 1;
    }
    if (calleeName.endswith("cread16") || calleeName.endswith("cwrite16")) {
      return 2;
    }
    if (calleeName.endswith("cread32") || calleeName.endswith("cwrite32")) {
      return 4;
    }
    if (calleeName.endswith("cread64") || calleeName.endswith("cwrite64")) {
      return 8;
    }
    return std::nullopt;
  }

  static bool isVirtioConfigReadHelperName(StringRef calleeName) {
    return calleeName == "__virtio_cread_many" ||
           calleeName == "virtio_cread_bytes" ||
           calleeName.endswith("cread8") || calleeName.endswith("cread16") ||
           calleeName.endswith("cread32") || calleeName.endswith("cread64");
  }

  static bool isVirtioConfigWriteHelperName(StringRef calleeName) {
    return calleeName.endswith("cwrite8") || calleeName.endswith("cwrite16") ||
           calleeName.endswith("cwrite32") || calleeName.endswith("cwrite64");
  }

  std::optional<uint64_t> constantBaseOffsetForValue(const Value *value) {
    if (auto constant = constantValueFor(value)) {
      return constant;
    }
    if (const auto *phi = llvm::dyn_cast<PHINode>(value)) {
      std::optional<uint64_t> best;
      for (const Value *incoming : phi->incoming_values()) {
        if (auto constant = constantBaseOffsetForValue(incoming)) {
          if (!best || *constant < *best) {
            best = constant;
          }
        }
      }
      return best;
    }
    const auto *instruction = llvm::dyn_cast<Instruction>(value);
    if (!instruction || instruction->getNumOperands() != 2) {
      return std::nullopt;
    }
    if (instruction->getOpcode() != llvm::Instruction::Add &&
        instruction->getOpcode() != llvm::Instruction::Or) {
      return std::nullopt;
    }
    if (auto lhs = constantValueFor(instruction->getOperand(0))) {
      return lhs;
    }
    if (auto rhs = constantValueFor(instruction->getOperand(1))) {
      return rhs;
    }
    return std::nullopt;
  }

  struct DebugFieldDescriptor {
    llvm::DIType *leafType = nullptr;
    uint64_t fieldOffset = 0;
    uint64_t fieldSize = 0;
    uint64_t elementOffset = 0;
    uint64_t elementSize = 0;
    uint64_t elementCount = 0;
    bool fieldIsArray = false;
    std::vector<std::string> path;
  };

  std::string configFieldSchemaName(const DebugFieldDescriptor &field) {
    std::string out = "virtio_net_config";
    for (const std::string &part : field.path) {
      const std::string token = sanitizeToken(part);
      if (token.empty() || token == "value") {
        continue;
      }
      out += "__" + token;
    }
    if (out == "virtio_net_config") {
      out += "__value";
    }
    return out;
  }

  void recordExplicitSchemaField(StringRef schemaName,
                                 StringRef fieldName,
                                 uint64_t sizeBytes) {
    const std::string schemaToken = sanitizeToken(schemaName);
    const std::string fieldToken = sanitizeToken(fieldName);
    if (schemaToken.empty() || fieldToken.empty() || sizeBytes == 0) {
      return;
    }
    auto &decl = model_.explicitSchemas[schemaToken];
    if (llvm::any_of(decl.fields, [&](const MachineModel::ExplicitSchemaField &field) {
          return field.name == fieldToken;
        })) {
      return;
    }
    decl.fields.push_back({fieldToken, schemaFieldTypeNameForByteWidth(sizeBytes)});
    model_.schemaTypes.insert(schemaToken);
  }

  void recordDynamicMmioOp(StringRef schemaName,
                           bool isRead,
                           uint64_t offset,
                           unsigned sizeBytes) {
    const std::string schemaToken = sanitizeToken(schemaName);
    if (schemaToken.empty() || sizeBytes == 0) {
      return;
    }
    std::string opName = schemaToken + (isRead ? "_read" : "_write");
    if (llvm::none_of(model_.dynamicMmioOps,
                      [&](const MachineModel::DynamicMmioOp &op) {
                        return op.name == opName && op.isRead == isRead &&
                               op.offset == offset && op.size == sizeBytes &&
                               op.schemaName == schemaToken;
                      })) {
      model_.dynamicMmioOps.push_back(
          {opName, schemaToken, isRead, offset, sizeBytes});
    }
  }

  void recordConfigSchemaHeadPosition(StringRef schemaName,
                                      const Instruction &instruction,
                                      StringRef calleeName,
                                      unsigned argIndex) {
    std::string fileToken = "generated";
    const llvm::DebugLoc &debugLoc = instruction.getDebugLoc();
    if (debugLoc) {
      const llvm::DILocation *location = debugLoc.get();
      const llvm::DIScope *scope = location->getScope();
      if (const auto *file = scope ? scope->getFile() : nullptr) {
        fileToken = llvm::sys::path::filename(file->getFilename()).str();
      }
    }
    model_.schemaHeadPositions[sanitizeToken(schemaName)].insert(
        "[file = " + fileToken + "; caller = " +
        sanitizeToken(instruction.getFunction()->getName()) +
        "; callee = " + sanitizeToken(calleeName) +
        "; call_depth = 0; argument_index = " + std::to_string(argIndex) +
        "]");
  }

  static std::optional<std::pair<std::string, std::string>>
  fallbackVirtioNetConfigFieldAtOffset(uint64_t offset, unsigned sizeBytes) {
    if (sizeBytes == 1 && offset < 6) {
      const std::string elem = "elem_" + std::to_string(offset);
      return std::make_pair("virtio_net_config__mac__" + elem, elem);
    }
    switch (offset) {
      case 6:
        if (sizeBytes == 2) {
          return std::make_pair("virtio_net_config__status", "status");
        }
        break;
      case 8:
        if (sizeBytes == 2) {
          return std::make_pair("virtio_net_config__max_virtqueue_pairs",
                                "max_virtqueue_pairs");
        }
        break;
      case 10:
        if (sizeBytes == 2) {
          return std::make_pair("virtio_net_config__mtu", "mtu");
        }
        break;
      case 12:
        if (sizeBytes == 4) {
          return std::make_pair("virtio_net_config__speed", "speed");
        }
        break;
      case 16:
        if (sizeBytes == 1) {
          return std::make_pair("virtio_net_config__duplex", "duplex");
        }
        break;
      case 17:
        if (sizeBytes == 1) {
          return std::make_pair("virtio_net_config__rss_max_key_size",
                                "rss_max_key_size");
        }
        break;
      case 18:
        if (sizeBytes == 2) {
          return std::make_pair(
              "virtio_net_config__rss_max_indirection_table_length",
              "rss_max_indirection_table_length");
        }
        break;
      case 20:
        if (sizeBytes == 4) {
          return std::make_pair("virtio_net_config__supported_hash_types",
                                "supported_hash_types");
        }
        break;
      default:
        break;
    }
    return std::nullopt;
  }

  void recordVirtioNetConfigOffsetAccess(uint64_t offset,
                                         unsigned sizeBytes,
                                         bool isRead,
                                         const Instruction *instruction,
                                         StringRef helperName) {
    std::string schemaName;
    std::string fieldName = "value";
    if (llvm::DIType *configType = findNamedDebugType("virtio_net_config")) {
      std::optional<DebugFieldDescriptor> field =
          describeDebugFieldAtOffset(configType, offset);
      if (field) {
        schemaName = configFieldSchemaName(*field);
        for (auto it = field->path.rbegin(); it != field->path.rend(); ++it) {
          const std::string token = sanitizeToken(*it);
          if (token.empty() || token == "value") {
            continue;
          }
          fieldName = token;
          break;
        }
      }
    }
    if (schemaName.empty()) {
      auto fallback = fallbackVirtioNetConfigFieldAtOffset(offset, sizeBytes);
      if (!fallback) {
        return;
      }
      schemaName = fallback->first;
      fieldName = fallback->second;
    }
    recordExplicitSchemaField(schemaName, fieldName, sizeBytes);
    recordDynamicMmioOp(schemaName, isRead, 0x100 + offset, sizeBytes);
    if (instruction) {
      recordConfigSchemaHeadPosition(schemaName, *instruction, helperName, 1);
    }
  }

  void recordVirtioNetConfigSequentialAccesses(uint64_t startOffset,
                                               unsigned sizeBytes,
                                               uint64_t count,
                                               bool isRead,
                                               const Instruction *instruction,
                                               StringRef helperName) {
    if (sizeBytes == 0 || count == 0) {
      return;
    }
    for (uint64_t index = 0; index < count; ++index) {
      recordVirtioNetConfigOffsetAccess(startOffset + index * sizeBytes,
                                        sizeBytes,
                                        isRead,
                                        instruction,
                                        helperName);
    }
  }

  void recordVirtioNetConfigArraySpanFromBase(const Value *offsetValue,
                                              unsigned sizeBytes,
                                              bool isRead,
                                              const Instruction *instruction,
                                              StringRef helperName) {
    if (sizeBytes == 0) {
      return;
    }
    auto baseOffset = constantBaseOffsetForValue(offsetValue);
    if (!baseOffset) {
      return;
    }
    bool recorded = false;
    if (llvm::DIType *configType = findNamedDebugType("virtio_net_config")) {
      std::optional<DebugFieldDescriptor> field =
          describeDebugFieldAtOffset(configType, *baseOffset);
      if (field && field->fieldIsArray && field->elementSize == sizeBytes &&
          field->elementCount != 0) {
        const uint64_t elemIndex =
            field->elementSize != 0 ? field->elementOffset / field->elementSize : 0;
        if (elemIndex < field->elementCount) {
          recordVirtioNetConfigSequentialAccesses(*baseOffset,
                                                  sizeBytes,
                                                  field->elementCount - elemIndex,
                                                  isRead,
                                                  instruction,
                                                  helperName);
          recorded = true;
        }
      }
    }
    if (!recorded && *baseOffset == 0 && sizeBytes == 1) {
      recordVirtioNetConfigSequentialAccesses(0,
                                              1,
                                              6,
                                              isRead,
                                              instruction,
                                              helperName);
    }
  }

  static std::optional<uint64_t> parseRenderedUnsigned(StringRef text) {
    text = text.trim();
    uint64_t value = 0;
    if (!text.getAsInteger(10, value)) {
      return value;
    }
    return std::nullopt;
  }

  static std::vector<std::string> splitRenderedCallArgs(StringRef argsText) {
    std::vector<std::string> out;
    std::string current;
    int depth = 0;
    for (char ch : argsText) {
      if (ch == '(') {
        ++depth;
      } else if (ch == ')') {
        --depth;
      }
      if (ch == ',' && depth == 0) {
        out.push_back(StringRef(current).trim().str());
        current.clear();
        continue;
      }
      current.push_back(ch);
    }
    if (!current.empty()) {
      out.push_back(StringRef(current).trim().str());
    }
    return out;
  }

  static std::optional<std::vector<std::string>> parseRenderedCallArgsForName(
      StringRef line,
      StringRef calleeName) {
    const std::string needle = calleeName.str() + "(";
    const size_t open = line.find(needle);
    if (open == std::string::npos) {
      return std::nullopt;
    }
    size_t start = open + needle.size();
    int depth = 1;
    for (size_t index = start; index < line.size(); ++index) {
      if (line[index] == '(') {
        ++depth;
      } else if (line[index] == ')') {
        --depth;
        if (depth == 0) {
          return splitRenderedCallArgs(line.slice(start, index));
        }
      }
    }
    return std::nullopt;
  }
