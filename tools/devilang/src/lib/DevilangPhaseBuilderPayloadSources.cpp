  std::vector<PayloadSourceInfo> findSgPayloadSources(const CallBase &call) {
    std::vector<PayloadSourceInfo> out;
    if (call.arg_size() < 2) {
      return out;
    }
    PayloadTraceState state;
    collectSgPayloadSourcesForValue(call.getFunction(), call.getArgOperand(1),
                                    std::move(state), 0, out);
    return out;
  }

  void collectSgPayloadSourcesForValue(const Function *function,
                                       const Value *sgValue,
                                       PayloadTraceState state,
                                       unsigned depth,
                                       std::vector<PayloadSourceInfo> &out) {
    if (!function || !sgValue || depth > 16) {
      return;
    }
    const Value *sgArg = stripPointerCastsAndGep(sgValue);
    if (!sgArg || !state.values.insert(sgValue).second) {
      return;
    }
    const PointerAccessPath sgPath = pointerAccessPathFor(sgValue);
    if (!state.sgSlot && sgPath.exact && !sgPath.indices.empty()) {
      state.sgSlot = sgPath.indices.back();
    }
    const size_t initialOutSize = out.size();

    for (const BasicBlock &block : *function) {
      for (const Instruction &instruction : block) {
        const auto *candidate = llvm::dyn_cast<CallBase>(&instruction);
        if (!candidate) {
          continue;
        }
        const Function *callee =
            llvm::dyn_cast<Function>(candidate->getCalledOperand()->stripPointerCasts());
        if (!callee) {
          continue;
        }
        StringRef calleeName = callee->getName();
        if (calleeName != "sg_set_buf" && calleeName != "sg_init_one" &&
            calleeName != "sg_fill_dma" &&
            calleeName != "skb_to_sgvec" &&
            calleeName != "skb_to_sgvec_nomark") {
          continue;
        }
        if (candidate->arg_size() < 2) {
          continue;
        }
        const unsigned sgArgIndex =
            (calleeName == "skb_to_sgvec" || calleeName == "skb_to_sgvec_nomark")
                ? 1
                : 0;
        if (candidate->arg_size() <= sgArgIndex) {
          continue;
        }
        const Value *candidateSg = candidate->getArgOperand(sgArgIndex);
        const bool pathMatch = samePointerAccessPath(candidateSg, sgValue);
        const bool baseMatch = sameUnderlyingPointer(candidateSg, sgArg);
        const PointerAccessPath candidatePath = pointerAccessPathFor(candidateSg);
        const bool requireExactPath =
            sgPath.exact && candidatePath.exact &&
            (sgPath.base == candidatePath.base) &&
            !sgPath.indices.empty();
        if (requireExactPath ? !pathMatch : (!baseMatch && !pathMatch)) {
          continue;
        }
        PayloadSourceInfo info;
        if (calleeName == "sg_fill_dma") {
          info.value = premappedBufferValueFor(function);
        } else if (calleeName == "skb_to_sgvec" ||
                   calleeName == "skb_to_sgvec_nomark") {
          info.value = candidate->getArgOperand(0);
        } else {
          info.value = candidate->getArgOperand(1);
        }
        info.originCall = candidate;
        info.originCallee = calleeName.str();
        info.originArgIndex =
            (calleeName == "skb_to_sgvec" || calleeName == "skb_to_sgvec_nomark")
                ? 0
                : 1;
        if (calleeName == "skb_to_sgvec" || calleeName == "skb_to_sgvec_nomark") {
          if (candidate->arg_size() >= 4) {
            info.lengthValue = candidate->getArgOperand(3);
          }
        } else if (candidate->arg_size() >= 3) {
          info.lengthValue = candidate->getArgOperand(2);
        }
        info.slotIndex = state.sgSlot;
        appendPayloadSourceInfo(out, info);
      }
    }
    if (out.size() != initialOutSize) {
      return;
    }

    if (const auto *instruction = llvm::dyn_cast<Instruction>(sgArg)) {
      switch (instruction->getOpcode()) {
        case llvm::Instruction::BitCast:
        case llvm::Instruction::AddrSpaceCast:
        case llvm::Instruction::GetElementPtr:
          collectSgPayloadSourcesForValue(function, instruction->getOperand(0),
                                          state, depth + 1, out);
          return;
        case llvm::Instruction::Load:
          collectSgPayloadSourcesForValue(
              function, llvm::cast<LoadInst>(instruction)->getPointerOperand(),
              state, depth + 1, out);
          return;
        default:
          break;
      }
      if (const auto *call = llvm::dyn_cast<CallBase>(instruction)) {
        if (const Function *callee = llvm::dyn_cast<Function>(
                call->getCalledOperand()->stripPointerCasts())) {
          if (callee->getName() == "sg_next" && call->arg_size() >= 1) {
            collectSgPayloadSourcesForValue(function, call->getArgOperand(0),
                                            state, depth + 1, out);
            return;
          }
        }
      }
      if (llvm::isa<llvm::AllocaInst>(instruction)) {
        for (const llvm::User *user : instruction->users()) {
          const auto *store = llvm::dyn_cast<StoreInst>(user);
          if (!store || store->getPointerOperand() != instruction) {
            const auto *gep = llvm::dyn_cast<GetElementPtrInst>(user);
            if (!gep) {
              continue;
            }
            for (const llvm::User *gepUser : gep->users()) {
              const auto *slotStore = llvm::dyn_cast<StoreInst>(gepUser);
              if (!slotStore || slotStore->getPointerOperand() != gep) {
                continue;
              }
              collectSgPayloadSourcesForValue(
                  function, slotStore->getValueOperand(), state, depth + 1, out);
            }
            continue;
          }
          collectSgPayloadSourcesForValue(
              function, store->getValueOperand(), state, depth + 1, out);
        }
      }
      if (const auto *phi = llvm::dyn_cast<PHINode>(instruction)) {
        for (const Value *incoming : phi->incoming_values()) {
          collectSgPayloadSourcesForValue(function, incoming, state, depth + 1, out);
        }
      }
      if (const auto *select = llvm::dyn_cast<llvm::SelectInst>(instruction)) {
        for (const Value *option :
             {select->getTrueValue(), select->getFalseValue()}) {
          collectSgPayloadSourcesForValue(function, option, state, depth + 1, out);
        }
      }
    }

    if (const auto *arg = llvm::dyn_cast<llvm::Argument>(sgArg)) {
      const Function *parent = arg->getParent();
      if (!parent) {
        return;
      }
      const unsigned argNo = arg->getArgNo();
      if (const CallBase *specializedCaller = specializedCallerForFunction(parent)) {
        if (specializedCaller->arg_size() > argNo) {
          const Value *actualValue =
              (sgPath.exact && sgPath.base == arg)
                  ? remapPathAcrossCall(sgPath, parent, specializedCaller)
                  : specializedCaller->getArgOperand(argNo);
          if (!actualValue) {
            actualValue = specializedCaller->getArgOperand(argNo);
          }
          collectSgPayloadSourcesForValue(specializedCaller->getFunction(),
                                          actualValue, state, depth + 1, out);
        }
        return;
      }
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
            if (callee != parent || candidateCall->arg_size() <= argNo) {
              continue;
            }
            const Value *actualValue =
                (sgPath.exact && sgPath.base == arg)
                    ? remapPathAcrossCall(sgPath, parent, candidateCall)
                    : candidateCall->getArgOperand(argNo);
            if (!actualValue) {
              actualValue = candidateCall->getArgOperand(argNo);
            }
            collectSgPayloadSourcesForValue(candidateCall->getFunction(),
                                            actualValue, state, depth + 1, out);
          }
        }
      }
    }
  }

  DmaPayloadVariant inferPayloadVariantFromSource(const Function &caller,
                                                  const PayloadSourceInfo &source) {
    DmaPayloadVariant variant;
    variant.lengthValue = source.lengthValue;
    variant.lengthContext =
        source.originCall ? source.originCall->getFunction() : &caller;
    std::vector<std::string> hintedTypes;
    std::vector<std::string> hintedCalls;
    std::vector<std::string> hintedUseSites;
    if (source.originCall && !source.originCallee.empty()) {
      hintedTypes = lookupPointsToHintTypes(source.originCall,
                                            source.originCallee,
                                            source.originArgIndex);
      hintedCalls = lookupPointsToHintCalls(source.originCall,
                                            source.originCallee,
                                            source.originArgIndex);
      hintedUseSites = lookupPointsToHintUseSites(source.originCall,
                                                  source.originCallee,
                                                  source.originArgIndex);
      variant.payload.fields = normalizeFieldHints(lookupPointsToHintFields(
          source.originCall, source.originCallee, source.originArgIndex));
      if (variant.payload.fields.size() > 64) {
        variant.payload.fields = narrowFieldHintsByNeedle(
            variant.payload.fields, sourceFieldNeedle(source.value));
      }
    }
    std::optional<int64_t> sgSlot = source.slotIndex;
    if (!sgSlot) {
      sgSlot = sgSlotIndexForCall(source.originCall);
    }
    const bool genericControlCommandContext =
        traceContextHasFunction("virtnet_send_command") ||
        traceContextHasFunction("virtnet_send_command_reply");
    const bool rssCommandContext =
        traceContextHasFunction("virtnet_commit_rss_command") ||
        traceContextHasFunction("virtnet_set_hashflow") ||
        traceContextHasFunction("virtnet_set_rxfh");
    if (rssCommandContext && sgSlot && *sgSlot == 0) {
      keepPayloadFieldsByPrefixes(
          variant.payload,
          {"virtnet_info__rss_hdr", "virtio_net_rss_config_hdr__"},
          "virtio_net_rss_config_hdr", "sg_buffer");
    } else if (rssCommandContext && sgSlot && *sgSlot == 1) {
      keepPayloadFieldsByPrefixes(
          variant.payload,
          {"virtnet_info__field_46__rss_trailer",
           "virtio_net_rss_config_trailer__"},
          "virtio_net_rss_config_trailer", "sg_buffer");
    } else if (genericControlCommandContext && sgSlot && *sgSlot == 0) {
      const std::string headerType = specificControlHeaderTypeForTraceContext();
      variant.payload.kind = "sg_buffer";
      variant.payload.type =
          headerType.empty() ? "virtio_net_ctrl_hdr" : headerType;
      variant.payload.fields.clear();
    } else if (genericControlCommandContext && sgSlot && *sgSlot >= 1) {
      const std::string payloadType =
          specificControlPayloadTypeForTraceContext(sgSlot);
      if (!payloadType.empty()) {
        variant.payload.kind = "sg_buffer";
        variant.payload.type = payloadType;
        variant.payload.fields.clear();
      }
    }
    variant.payload.type = refinePayloadTypeFromHints(
        hintedTypes, variant.payload.fields, hintedCalls, hintedUseSites, "",
        &caller);
    std::string typeName =
        source.value ? guessTypeNameFromValue(source.value) : "";
    if ((variant.payload.type.empty() || variant.payload.type == "unknown") &&
        !typeName.empty()) {
      variant.payload.type = typeName;
    }
    variant.payload.type = canonicalizePayloadTypeName(variant.payload.type);
    if (source.value &&
        (variant.payload.type == "virtio_net_hdr" ||
         variant.payload.type == "virtnet_rq_dma")) {
      appendMissingCanonicalFields(
          variant.payload.fields,
          collectCanonicalFieldsFromValueType(source.value, variant.payload.type));
    }
    std::string fallback = source.value && source.value->hasName()
                               ? source.value->getName().str()
                               : "";
    const std::string classifiedHintKind = classifyPayloadKindFromHints(
        hintedTypes, variant.payload.fields, hintedCalls, hintedUseSites,
        &caller);
      variant.payload.kind = classifiedHintKind == "sg_buffer"
                               ? classifyPayloadKind(
                                     variant.payload.type == "unknown"
                                         ? typeName
                                         : variant.payload.type,
                                     fallback, &caller)
                               : classifiedHintKind;
    auto contextContains = [&](StringRef needle) {
      if (caller.getName().contains(needle)) {
        return true;
      }
      if (source.originCallee.find(needle.str()) != std::string::npos) {
        return true;
      }
      for (const std::string &token : hintedCalls) {
        if (StringRef(token).contains(needle)) {
          return true;
        }
      }
      for (const std::string &token : hintedUseSites) {
        if (StringRef(token).contains(needle)) {
          return true;
        }
      }
      return false;
    };
    const bool rxBufferContext =
        (source.originCall &&
         isRxBufferSetupContext(source.originCall->getFunction()->getName())) ||
        contextContains("add_recvbuf") ||
        contextContains("try_fill_recv") ||
        contextContains("virtnet_rx_resume") ||
        contextContains("rq_bind_xsk_pool");
    const bool txBufferContext =
        contextContains("xmit_skb") ||
        contextContains("virtnet_add_outbuf") ||
        contextContains("start_xmit") ||
        contextContains("virtqueue_add_outbuf");
    if (rxBufferContext) {
      const bool controlContaminatedRxPayload =
          isVirtioNetControlPayloadType(variant.payload.type) ||
          llvm::any_of(variant.payload.fields, [](const std::string &field) {
            return isVirtioNetControlField(field);
          });
      if (controlContaminatedRxPayload) {
        variant.payload.type = "unknown";
        variant.payload.fields.clear();
      }
      if (source.originCallee == "sg_fill_dma" ||
          source.originCallee.find("sg_fill_dma") != std::string::npos) {
        variant.payload.kind = "virtio_net_hdr";
        if (contextContains("add_recvbuf_mergeable") ||
            contextContains("add_recvbuf_small") ||
            contextContains("xsk_pool") ||
            traceContextHasFunction("add_recvbuf_mergeable") ||
            traceContextHasFunction("add_recvbuf_small") ||
            traceContextHasFunction("virtnet_xsk_pool_enable") ||
            traceContextHasFunction("virtnet_xsk_pool_disable") ||
            traceContextHasFunction("virtnet_rq_bind_xsk_pool")) {
          variant.payload.type = "virtio_net_hdr_mrg_rxbuf";
        } else {
          variant.payload.type = "virtio_net_hdr";
        }
        variant.payload.fields.clear();
      }
      if (!(source.originCallee == "sg_fill_dma" ||
            source.originCallee.find("sg_fill_dma") != std::string::npos) &&
          sgSlot && *sgSlot == 0) {
        variant.payload.kind = "virtio_net_hdr";
        variant.payload.type = "virtio_net_hdr";
        variant.payload.fields.clear();
      } else if (!(source.originCallee == "sg_fill_dma" ||
                   source.originCallee.find("sg_fill_dma") != std::string::npos) &&
                 (!sgSlot || *sgSlot >= 1)) {
        variant.payload.type = "unknown";
        variant.payload.fields.clear();
        variant.payload.kind = "ethernet_frame";
      }
    }
    if (txBufferContext &&
        (source.originCallee == "skb_to_sgvec" ||
         source.originCallee == "skb_to_sgvec_nomark")) {
      forceEthernetFramePayload(variant.payload);
    }
    if ((variant.payload.type.empty() || variant.payload.type == "unknown" ||
         variant.payload.type == "control_buf" ||
         variant.payload.type == "__virtio16") &&
        std::find(variant.payload.fields.begin(), variant.payload.fields.end(),
                  "__virtio16__value") != variant.payload.fields.end() &&
        (contextContains("virtnet_vlan_rx_add_vid") ||
         contextContains("virtnet_vlan_rx_kill_vid"))) {
      variant.payload.type = "virtio_net_ctrl_vlan";
    }
    if ((variant.payload.type == "sockaddr" ||
         variant.payload.type.empty() || variant.payload.type == "unknown") &&
        std::find(variant.payload.fields.begin(), variant.payload.fields.end(),
                  "sockaddr__sa_data") != variant.payload.fields.end() &&
        contextContains("virtnet_set_mac_address")) {
      variant.payload.type = "virtio_net_ctrl_mac_addr";
    }
    if (contextContains("__virtnet_get_hw_stats") && sgSlot && *sgSlot >= 3) {
      variant.payload.kind = "sg_buffer";
      variant.payload.type = "virtio_net_stats_reply_hdr";
      variant.payload.fields.clear();
    }
    const std::string controlPayloadType =
        specificControlPayloadTypeForTraceContext(sgSlot);
    if (!controlPayloadType.empty() &&
        (variant.payload.type.empty() || variant.payload.type == "unknown" ||
         isLowSignalTypeToken(variant.payload.type) ||
         payloadIsGeneric(variant.payload) ||
         variant.payload.type == "scatterlist" ||
         variant.payload.type == "control_buf")) {
      variant.payload.kind = "sg_buffer";
      variant.payload.type = controlPayloadType;
    }
    normalizeMergedPayloadInfo(variant.payload);
    enrichPayloadInfo(variant.payload);
    variant.inferredLength =
        schemaAwarePayloadSize(variant.payload.type, model_.schemaLengthImmediates);
    if (!variant.inferredLength) {
      variant.inferredLength = constantSizeForValueType(source.value);
    }
    return variant;
  }

  std::vector<DmaPayloadVariant> inferSyntheticDmaPayloadVariants(
      const Function &callee,
      const CallBase &call) {
    std::vector<DmaPayloadVariant> variants;
    DmaPayloadInfo info;
    info.type = "unknown";
    if (callee.getName() == "vring_map_single") {
      DmaPayloadVariant variant;
      variant.payload = info;
      if (call.arg_size() >= 2) {
        const Value *source = call.getArgOperand(1);
        const std::vector<std::string> hintedTypes =
            lookupPointsToHintTypes(&call, callee.getName(), 1);
        const std::vector<std::string> hintedCalls =
            lookupPointsToHintCalls(&call, callee.getName(), 1);
        const std::vector<std::string> hintedUseSites =
            lookupPointsToHintUseSites(&call, callee.getName(), 1);
        variant.payload.fields = normalizeFieldHints(
            lookupPointsToHintFields(&call, callee.getName(), 1));
        variant.payload.type = refinePayloadTypeFromHints(
            hintedTypes, variant.payload.fields, hintedCalls, hintedUseSites, "",
            call.getFunction());
        std::string typeName = guessTypeNameFromValue(source);
        if ((variant.payload.type.empty() || variant.payload.type == "unknown") &&
            !typeName.empty()) {
          variant.payload.type = typeName;
        }
        if (source &&
            (variant.payload.type == "virtio_net_hdr" ||
             variant.payload.type == "virtnet_rq_dma" ||
             variant.payload.type == "vring_desc" ||
             variant.payload.type == "vring_desc_extra")) {
          appendMissingCanonicalFields(
              variant.payload.fields,
              collectCanonicalFieldsFromValueType(source, variant.payload.type));
        }
        const std::string classifiedHintKind = classifyPayloadKindFromHints(
            hintedTypes, variant.payload.fields, hintedCalls, hintedUseSites,
            call.getFunction());
        variant.payload.kind = classifiedHintKind == "sg_buffer"
                        ? classifyPayloadKind(
                              variant.payload.type == "unknown" ? typeName : variant.payload.type,
                              renderValue(source), call.getFunction())
                        : classifiedHintKind;
      }
      if (variant.payload.kind == "sg_buffer") {
        variant.payload.kind = "virtq_desc_table";
      }
      variants.push_back(std::move(variant));
      return variants;
    }

    if (callee.getName() == "vring_map_one_sg") {
      const std::vector<PayloadSourceInfo> sources = findSgPayloadSources(call);
      for (const PayloadSourceInfo &source : sources) {
        appendPayloadVariant(variants,
                             inferPayloadVariantFromSource(*call.getFunction(),
                                                          source));
      }
      for (const PayloadSourceInfo &source :
           collectTraceContextTypedSources("sg_set_buf", 1, 2)) {
        const Function *context =
            source.originCall ? source.originCall->getFunction()
                              : call.getFunction();
        appendPayloadVariant(variants,
                             inferPayloadVariantFromSource(*context, source));
      }
      for (const PayloadSourceInfo &source :
           collectTraceContextTypedSources("sg_init_one", 1, 2)) {
        const Function *context =
            source.originCall ? source.originCall->getFunction()
                              : call.getFunction();
        appendPayloadVariant(variants,
                             inferPayloadVariantFromSource(*context, source));
      }
      if (variants.empty()) {
        DmaPayloadVariant fallback;
        fallback.payload = info;
        variants.push_back(std::move(fallback));
      }
      return variants;
    }

    if (callee.getName() == "sg_fill_dma") {
      DmaPayloadVariant variant;
      PayloadSourceInfo source;
      source.value = premappedBufferValueFor(call.getFunction());
      source.originCall = &call;
      source.originCallee = "sg_fill_dma";
      source.originArgIndex = 1;
      if (call.arg_size() >= 3) {
        source.lengthValue = call.getArgOperand(2);
      }
      variant = inferPayloadVariantFromSource(*call.getFunction(), source);
      variants.push_back(std::move(variant));
      return variants;
    }

    if (callee.getName() == "vring_unmap_one_split" ||
        callee.getName() == "vring_unmap_extra_packed") {
      DmaPayloadVariant variant;
      variant.payload = info;
      variant.payload.kind = classifyPayloadKind("", callee.getName(), call.getFunction());
      std::string callerType = guessTypeNameFromValue(call.getArgOperand(1));
      if (!callerType.empty()) {
        variant.payload.type = callerType;
      }
      variants.push_back(std::move(variant));
      return variants;
    }

    DmaPayloadVariant variant;
    variant.payload = info;
    variants.push_back(std::move(variant));
    return variants;
  }

  void appendSyntheticDmaEvent(std::vector<std::string> &lines,
                               const std::string &op,
                               const std::string &dir,
                               const std::string &path,
                               const std::string &addr,
                               const std::string &len,
                               const DmaPayloadInfo &payload) {
    auto emitSingle = [&](const DmaPayloadInfo &singlePayload) {
      DmaPayloadInfo enriched = singlePayload;
      normalizeMergedPayloadInfo(enriched);
      enrichPayloadInfo(enriched);
      normalizeMergedPayloadInfo(enriched);
      if ((enriched.type == "xdp_frame" || enriched.type == "virtnet_rq_dma") &&
          enriched.kind == "ethernet_frame") {
        enriched.kind = enriched.type;
      }
      notePayloadSchema(enriched);
      std::string line = "dma_event(op=" + op + ", dir=" + dir + ", path=" + path +
                         ", addr=" + addr + ", len=" + len + ", data_kind=" +
                         enriched.kind;
      if (!enriched.type.empty() && enriched.type != "unknown") {
        line += ", data_type=" + enriched.type;
      }
      for (const std::string &field : enriched.fields) {
        if (!field.empty()) {
          line += ", data_field=" + sanitizeToken(field);
        }
      }
      line += ")";
      lines.push_back(std::move(line));
    };

    DmaPayloadInfo enriched = payload;
    normalizeMergedPayloadInfo(enriched);
    enrichPayloadInfo(enriched);
    normalizeMergedPayloadInfo(enriched);
    const bool hasRssHdr = std::any_of(
        enriched.fields.begin(), enriched.fields.end(), [](const std::string &field) {
          return StringRef(field).startswith("virtnet_info__rss_hdr") ||
                 StringRef(field).startswith("virtio_net_rss_config_hdr__");
        });
    const bool hasRssTrailer = std::any_of(
        enriched.fields.begin(), enriched.fields.end(), [](const std::string &field) {
          return StringRef(field).startswith("virtnet_info__field_46__rss_trailer") ||
                 StringRef(field).startswith("virtio_net_rss_config_trailer__");
        });
    if (hasRssHdr && hasRssTrailer) {
      DmaPayloadInfo hdrPayload = extractPayloadFieldsByPrefixes(
          enriched, {"virtnet_info__rss_hdr", "virtio_net_rss_config_hdr"},
          "virtio_net_rss_config_hdr",
          enriched.kind.empty() ? "sg_buffer" : enriched.kind);
      DmaPayloadInfo trailerPayload = extractPayloadFieldsByPrefixes(
          enriched,
          {"virtnet_info__field_46__rss_trailer",
           "virtio_net_rss_config_trailer"},
          "virtio_net_rss_config_trailer",
          enriched.kind.empty() ? "sg_buffer" : enriched.kind);
      if (!hdrPayload.fields.empty()) {
        emitSingle(hdrPayload);
      }
      if (!trailerPayload.fields.empty()) {
        emitSingle(trailerPayload);
      }
      return;
    }
    if (enriched.type == "ethernet_frame") {
      DmaPayloadInfo ipv4Payload =
          specializeEthernetFramePayload(enriched, "ethernet_ipv4_frame");
      DmaPayloadInfo ipv6Payload =
          specializeEthernetFramePayload(enriched, "ethernet_ipv6_frame");
      emitSingle(specializeIpPayload(ipv4Payload, "ipv4_tcp_packet"));
      emitSingle(specializeIpPayload(ipv4Payload, "ipv4_udp_packet"));
      emitSingle(specializeIpPayload(ipv4Payload, "ipv4_icmp_packet"));
      emitSingle(specializeIpPayload(ipv6Payload, "ipv6_tcp_packet"));
      emitSingle(specializeIpPayload(ipv6Payload, "ipv6_udp_packet"));
      emitSingle(specializeIpPayload(ipv6Payload, "ipv6_icmpv6_packet"));
      emitSingle(specializeIpPayload(ipv6Payload, "ipv6_fragment_packet"));
      emitSingle(specializeVlanPayload(
          specializeEthernetFramePayload(enriched, "ethernet_vlan_frame"),
          "vlan_ipv4_packet"));
      emitSingle(specializeVlanPayload(
          specializeEthernetFramePayload(enriched, "ethernet_vlan_frame"),
          "vlan_ipv6_packet"));
      return;
    }
    emitSingle(enriched);
  }

  void appendGenericHeaderHeuristicEvents(std::vector<std::string> &lines,
                                          const std::string &op,
                                          const std::string &dir,
                                          const std::string &path,
                                          const std::string &addr,
                                          const std::string &len,
                                          StringRef labelBase) {
    DmaPayloadInfo headerPayload;
    headerPayload.kind = "virtio_net_hdr";
    headerPayload.type = "virtio_net_hdr";
    enrichPayloadInfo(headerPayload);
    lines.push_back("neqj " + len + " ugt 256, 0, @" + labelBase.str() +
                    "_frame");
    lines.push_back("neqj " + len + " ugt 64, 0, @" + labelBase.str() +
                    "_control");
    appendSyntheticDmaEvent(lines, op, dir, path, addr, len,
                            headerPayload);
    lines.push_back("goto @bb_vring_map_one_sg_done");
  }

  void appendGroupedPayloadBlocks(
      TraceModel &trace,
      const std::string &dispatchLabel,
      const std::string &nextLabel,
      const std::string &op,
      const std::string &dir,
      const std::string &path,
      const std::string &addr,
      const std::string &len,
      const std::vector<std::pair<uint64_t, DmaPayloadInfo>> &groups,
      const DmaPayloadInfo &fallbackPayload,
      bool allowGenericHeaderHeuristic,
      const std::vector<PayloadPatternBranch> &patternBranches = {},
      bool rejectOnFallback = false,
      bool preferCharFallback = false) {
    auto pushBlock = [&](std::string label, std::vector<std::string> lines) {
      TraceBlock block;
      block.label = std::move(label);
      block.lines = std::move(lines);
      trace.blocks.push_back(std::move(block));
    };
    auto pushGenericHeaderHeuristicBlocks =
        [&](const std::string &entryLabel) {
          DmaPayloadInfo controlPayload;
          controlPayload.kind = "sg_buffer";
          controlPayload.type = "control_buf";
          DmaPayloadInfo framePayload;
          forceEthernetFramePayload(framePayload);

          std::vector<std::string> entryLines;
          appendGenericHeaderHeuristicEvents(entryLines, op, dir, path, addr,
                                             len, nextLabel);
          pushBlock(entryLabel, std::move(entryLines));

          std::vector<std::string> controlLines;
          appendSyntheticDmaEvent(controlLines, op, dir, path, addr, len,
                                  controlPayload);
          controlLines.push_back("goto @bb_vring_map_one_sg_done");
          pushBlock(nextLabel + "_control", std::move(controlLines));

          std::vector<std::string> frameLines;
          appendSyntheticDmaEvent(frameLines, op, dir, path, addr, len,
                                  framePayload);
          frameLines.push_back("goto @bb_vring_map_one_sg_done");
          pushBlock(nextLabel + "_frame", std::move(frameLines));
        };
    if (groups.empty()) {
      if (!patternBranches.empty()) {
        for (size_t i = 0; i < patternBranches.size(); ++i) {
          const std::string label =
              i == 0 ? dispatchLabel
                     : (nextLabel + "_pattern_" + std::to_string(i - 1));
          const std::string missLabel =
              i + 1 < patternBranches.size()
                  ? (nextLabel + "_pattern_" + std::to_string(i))
                  : (rejectOnFallback ? "bb_vring_map_one_sg_done"
                                      : (nextLabel + "_fallback"));
          std::vector<std::string> lines = patternBranches[i].guards;
          for (std::string &guard : lines) {
            const size_t marker = guard.find("@MISS");
            if (marker != std::string::npos) {
              guard.replace(marker, 5, "@" + missLabel);
            }
          }
          for (const DmaPayloadInfo &payload : patternBranches[i].payloads) {
            appendSyntheticDmaEvent(lines, op, dir, path, addr, len, payload);
          }
          lines.push_back("goto @bb_vring_map_one_sg_done");
          pushBlock(label, std::move(lines));
        }
        if (rejectOnFallback) {
          return;
        }
      }
      if (preferCharFallback && payloadIsGeneric(fallbackPayload)) {
        DmaPayloadInfo ethernetPayload;
        forceEthernetFramePayload(ethernetPayload);
        std::vector<std::string> lines;
        appendSyntheticDmaEvent(lines, op, dir, path, addr, len,
                                ethernetPayload);
        lines.push_back("goto @bb_vring_map_one_sg_done");
        pushBlock(patternBranches.empty() ? dispatchLabel
                                          : (nextLabel + "_fallback"),
                  std::move(lines));
      } else if (payloadIsGeneric(fallbackPayload)) {
        if (allowGenericHeaderHeuristic) {
          pushGenericHeaderHeuristicBlocks(
              patternBranches.empty() ? dispatchLabel
                                      : (nextLabel + "_fallback"));
        } else {
          std::vector<std::string> lines;
          appendSyntheticDmaEvent(lines, op, dir, path, addr, len,
                                  fallbackPayload);
          lines.push_back("goto @bb_vring_map_one_sg_done");
          pushBlock(patternBranches.empty() ? dispatchLabel
                                            : (nextLabel + "_fallback"),
                    std::move(lines));
        }
      } else {
        std::vector<std::string> lines;
        appendSyntheticDmaEvent(lines, op, dir, path, addr, len,
                                fallbackPayload);
        lines.push_back("goto @bb_vring_map_one_sg_done");
        pushBlock(patternBranches.empty() ? dispatchLabel
                                          : (nextLabel + "_fallback"),
                  std::move(lines));
      }
      return;
    }
    std::vector<std::pair<uint64_t, std::vector<DmaPayloadInfo>>> groupedByLen;
    for (const auto &group : groups) {
      if (!groupedByLen.empty() && groupedByLen.back().first == group.first) {
        groupedByLen.back().second.push_back(group.second);
      } else {
        groupedByLen.push_back({group.first, {group.second}});
      }
    }

    for (size_t i = 0; i < groupedByLen.size(); ++i) {
      const std::string label = i == 0 ? dispatchLabel
                                       : (nextLabel + "_" + std::to_string(i - 1));
      const std::string missLabel =
          i + 1 < groupedByLen.size()
              ? (nextLabel + "_" + std::to_string(i))
              : (!patternBranches.empty()
                     ? (nextLabel + "_pattern_0")
                     : (rejectOnFallback ? "bb_vring_map_one_sg_done"
                                         : (nextLabel + "_fallback")));
      std::vector<std::string> lines;
      lines.push_back("neqj " + len + ", " +
                      std::to_string(groupedByLen[i].first) + ", @" +
                      missLabel);
      for (const DmaPayloadInfo &payload : groupedByLen[i].second) {
        appendSyntheticDmaEvent(lines, op, dir, path, addr, len, payload);
      }
      lines.push_back("goto @bb_vring_map_one_sg_done");
      pushBlock(label, std::move(lines));
    }

    for (size_t i = 0; i < patternBranches.size(); ++i) {
      const std::string label = nextLabel + "_pattern_" + std::to_string(i);
      const std::string missLabel =
          i + 1 < patternBranches.size()
              ? (nextLabel + "_pattern_" + std::to_string(i + 1))
              : (rejectOnFallback
                     ? "bb_vring_map_one_sg_done"
                     : (nextLabel + "_fallback"));
      std::vector<std::string> lines = patternBranches[i].guards;
      for (std::string &guard : lines) {
        const size_t marker = guard.find("@MISS");
        if (marker != std::string::npos) {
          guard.replace(marker, 5, "@" + missLabel);
        }
      }
      for (const DmaPayloadInfo &payload : patternBranches[i].payloads) {
        appendSyntheticDmaEvent(lines, op, dir, path, addr, len, payload);
      }
      lines.push_back("goto @bb_vring_map_one_sg_done");
      pushBlock(label, std::move(lines));
    }

    if (rejectOnFallback) {
      return;
    }

    std::vector<std::string> fallbackLines;
    if (preferCharFallback && payloadIsGeneric(fallbackPayload)) {
      DmaPayloadInfo ethernetPayload;
      forceEthernetFramePayload(ethernetPayload);
      appendSyntheticDmaEvent(fallbackLines, op, dir, path, addr, len,
                              ethernetPayload);
      fallbackLines.push_back("goto @bb_vring_map_one_sg_done");
    } else if (payloadIsGeneric(fallbackPayload)) {
      if (allowGenericHeaderHeuristic) {
        pushGenericHeaderHeuristicBlocks(nextLabel + "_fallback");
        return;
      } else {
        appendSyntheticDmaEvent(fallbackLines, op, dir, path, addr, len,
                                fallbackPayload);
        fallbackLines.push_back("goto @bb_vring_map_one_sg_done");
      }
    } else {
      appendSyntheticDmaEvent(fallbackLines, op, dir, path, addr, len,
                              fallbackPayload);
      fallbackLines.push_back("goto @bb_vring_map_one_sg_done");
    }
    pushBlock(nextLabel + "_fallback", std::move(fallbackLines));
  }

  void buildSyntheticDmaTraceForCall(const Function &callee,
                                     const CallBase &call,
                                     StringRef traceBaseName) {
    const std::string traceName = traceNameForBase(traceBaseName);
    if (!emittedSyntheticTraces_.insert(traceName).second) {
      return;
    }

    TraceModel trace;
    trace.name = traceName;
    trace.entry = false;

    auto pushBlock = [&](std::string label, std::vector<std::string> lines) {
      TraceBlock block;
      block.label = std::move(label);
      block.lines = std::move(lines);
      trace.blocks.push_back(std::move(block));
    };

    const std::vector<DmaPayloadVariant> variants =
        inferSyntheticDmaPayloadVariants(callee, call);
    const StringRef name = callee.getName();

    if (name == "vring_map_one_sg") {
      const bool genericSgTrace =
          sanitizeToken(traceBaseName) == "vring_map_one_sg__sg_buffer";
      const bool hashTunnelTrace =
          sanitizeToken(traceBaseName) ==
          "vring_map_one_sg__virtio_net_hdr_v1_hash_tunnel";
      const bool knownInbufOnly =
          traceContextHasFunction("virtqueue_add_inbuf") ||
          traceContextHasFunction("virtqueue_add_inbuf_ctx") ||
          traceContextHasFunction("virtqueue_add_inbuf_premapped");
      const bool knownOutbufOnly =
          traceContextHasFunction("virtqueue_add_outbuf") ||
          traceContextHasFunction("virtqueue_add_outbuf_premapped");
      std::vector<std::string> entryLines = {
          "neqj premapped, 0, @bb_vring_map_one_sg_done",
          "len = sg.length",
      };
      if (knownInbufOnly) {
        entryLines.push_back("neqj vq.use_map_api, 0, @bb_vring_map_one_sg_from_dma_api");
        entryLines.push_back("addr = sg_phys(sg)");
        entryLines.push_back("goto @bb_vring_map_one_sg_from_phys_dispatch");
      } else if (knownOutbufOnly) {
        entryLines.push_back("neqj vq.use_map_api, 0, @bb_vring_map_one_sg_dma_api");
        entryLines.push_back("addr = sg_phys(sg)");
        entryLines.push_back("goto @bb_vring_map_one_sg_phys_dispatch");
      } else {
        entryLines.push_back("neqj direction, DMA_TO_DEVICE, @bb_vring_map_one_sg_from_device");
        entryLines.push_back("neqj vq.use_map_api, 0, @bb_vring_map_one_sg_dma_api");
        entryLines.push_back("addr = sg_phys(sg)");
        entryLines.push_back("goto @bb_vring_map_one_sg_phys_dispatch");
      }
      pushBlock("", std::move(entryLines));

      if (!knownInbufOnly && !knownOutbufOnly) {
        std::vector<std::string> fromDeviceLines = {
            "neqj direction, DMA_FROM_DEVICE, @bb_vring_map_one_sg_done",
            "neqj vq.use_map_api, 0, @bb_vring_map_one_sg_from_dma_api",
            "addr = sg_phys(sg)",
            "goto @bb_vring_map_one_sg_from_phys_dispatch",
        };
        pushBlock("bb_vring_map_one_sg_from_device", std::move(fromDeviceLines));
      }

      std::vector<std::pair<uint64_t, DmaPayloadInfo>> lengthGroups;
      DmaPayloadInfo fallbackPayload;
      DmaPayloadInfo allPayload;
      bool haveAnyPayload = false;
      bool haveFallback = false;
      for (const DmaPayloadVariant &variant : variants) {
        if (!haveAnyPayload) {
          allPayload = variant.payload;
          haveAnyPayload = true;
        } else {
          mergePayloadInfoInto(allPayload, variant.payload);
          normalizeMergedPayloadInfo(allPayload);
          enrichPayloadInfo(allPayload);
        }
        std::optional<uint64_t> lenConst =
            constantLengthForValue(variant.lengthContext, variant.lengthValue);
        if (!lenConst) {
          lenConst = variant.inferredLength;
        }
        if (lenConst) {
          bool merged = false;
          for (auto &group : lengthGroups) {
            if (group.first == *lenConst) {
              mergePayloadInfoInto(group.second, variant.payload);
              normalizeMergedPayloadInfo(group.second);
              merged = true;
              break;
            }
          }
        if (!merged) {
          lengthGroups.push_back({*lenConst, variant.payload});
          normalizeMergedPayloadInfo(lengthGroups.back().second);
          enrichPayloadInfo(lengthGroups.back().second);
        }
      } else {
        if (!haveFallback) {
          fallbackPayload = variant.payload;
          haveFallback = true;
        } else {
          mergePayloadInfoInto(fallbackPayload, variant.payload);
          normalizeMergedPayloadInfo(fallbackPayload);
          enrichPayloadInfo(fallbackPayload);
        }
      }
    }
      if (!haveFallback) {
        fallbackPayload = DmaPayloadInfo();
      }
      if (!haveAnyPayload) {
        allPayload = DmaPayloadInfo();
      }
      const bool rxReceiveBufferContext =
          traceContextHasFunction("add_recvbuf_big") ||
          traceContextHasFunction("add_recvbuf_mergeable") ||
          traceContextHasFunction("add_recvbuf_small") ||
          traceContextHasFunction("try_fill_recv") ||
          traceContextHasFunction("__virtnet_rx_resume") ||
          traceContextHasFunction("virtnet_rx_resume");
      const bool controlCommandContext =
          traceContextHasFunction("virtnet_send_command") ||
          traceContextHasFunction("virtnet_send_command_reply");
      const bool txDataContext =
          traceContextHasFunction("virtnet_add_outbuf") ||
          traceContextHasFunction("xmit_skb") ||
          traceContextHasFunction("__virtnet_xdp_xmit_one") ||
          traceContextHasFunction("virtnet_xdp_xmit") ||
          traceContextHasFunction("virtqueue_add_outbuf") ||
          traceContextHasFunction("virtqueue_add_outbuf_premapped");
      const bool txTraceContext =
          txDataContext ||
          StringRef(traceBaseName).contains("start_xmit") ||
          StringRef(traceBaseName).contains("xmit_skb") ||
          StringRef(traceBaseName).contains("virtnet_add_outbuf");
      const bool txSemanticTrace =
          hashTunnelTrace ||
          std::any_of(variants.begin(), variants.end(),
                      [](const DmaPayloadVariant &variant) {
                        return variant.payload.type == "virtio_net_hdr" ||
                               variant.payload.type ==
                                   "virtio_net_hdr_v1_hash_tunnel" ||
                               variant.payload.type == "xdp_frame";
                      });
      const bool rssCommandContext =
          traceContextHasFunction("virtnet_commit_rss_command") ||
          traceContextHasFunction("virtnet_set_hashflow") ||
          traceContextHasFunction("virtnet_set_rxfh");
      const bool allowGenericHeaderHeuristic =
          !controlCommandContext && !genericSgTrace && !hashTunnelTrace &&
          !txTraceContext;
      if (!controlCommandContext && (rxReceiveBufferContext || txTraceContext)) {
        stripVirtioNetControlPayloadInfo(allPayload);
        stripVirtioNetControlPayloadInfo(fallbackPayload);
        llvm::erase_if(lengthGroups, [](auto &group) {
          if (isVirtioNetControlPayloadType(group.second.type)) {
            return true;
          }
          for (const std::string &field : group.second.fields) {
            if (isVirtioNetControlField(field)) {
              return true;
            }
          }
          return false;
        });
      }
      if (rxReceiveBufferContext) {
        for (auto &group : lengthGroups) {
          if (group.first >= 4064) {
            group.second.kind = "ethernet_frame";
            group.second.type = "unknown";
            group.second.fields.clear();
          }
        }
      }
      auto noteDescriptorRoleLengths =
          [&](const std::pair<uint64_t, DmaPayloadInfo> &group) {
            const auto isHeaderPayload = [&](const DmaPayloadInfo &payload) {
              const StringRef type(payload.type);
              const StringRef kind(payload.kind);
              return type.startswith("virtio_net_hdr") ||
                     kind.startswith("virtio_net_hdr");
            };
            const auto isFramePayload = [&](const DmaPayloadInfo &payload) {
              const StringRef type(payload.type);
              const StringRef kind(payload.kind);
              return kind == "ethernet_frame" || type == "xdp_frame" ||
                     type == "arp_packet" || type == "ipv4_icmp_packet" ||
                     type == "ipv4_tcp_packet" || type == "ipv4_udp_packet" ||
                     type == "ipv6_fragment_packet" ||
                     type == "ipv6_icmpv6_packet" || type == "ipv6_tcp_packet" ||
                     type == "ipv6_udp_packet" || type == "vlan_arp_packet" ||
                     type == "vlan_ipv4_packet" || type == "vlan_ipv6_packet";
            };
            if (rxReceiveBufferContext) {
              if (isHeaderPayload(group.second)) {
                noteSchemaLengthImmediate("vring_desc_rx_hdr", group.first);
                noteSchemaLengthImmediate("vring_packed_desc_rx_hdr", group.first);
                noteSchemaLengthImmediate("vring_desc_extra_rx_hdr", group.first);
              }
              if (isFramePayload(group.second)) {
                noteSchemaLengthImmediate("vring_desc_rx_frame", group.first);
                noteSchemaLengthImmediate("vring_packed_desc_rx_frame",
                                          group.first);
                noteSchemaLengthImmediate("vring_desc_extra_rx_frame",
                                          group.first);
                if (traceContextHasFunction("add_recvbuf_big") ||
                    traceContextHasFunction("add_recvbuf_mergeable")) {
                  noteSchemaLengthImmediate("vring_desc_rx_frame_large",
                                            group.first);
                }
                if (traceContextHasFunction("add_recvbuf_small")) {
                  noteSchemaLengthImmediate("vring_desc_rx_frame_small",
                                            group.first);
                }
              }
              if (traceContextHasFunction("add_recvbuf_small") &&
                  group.first < 64 && group.first != 12) {
                noteSchemaLengthImmediate("vring_desc_rx_frame_small",
                                          group.first);
              }
            } else if (txDataContext || txSemanticTrace) {
              if (isHeaderPayload(group.second)) {
                noteSchemaLengthImmediate("vring_desc_tx_hdr", group.first);
                noteSchemaLengthImmediate("vring_packed_desc_tx_hdr", group.first);
                noteSchemaLengthImmediate("vring_desc_extra_tx_hdr", group.first);
                if (canonicalizePayloadTypeName(group.second.type) ==
                    "virtio_net_hdr_v1_hash_tunnel") {
                  noteSchemaLengthImmediate(
                      "vring_desc_tx_hdr_hash_tunnel", group.first);
                  noteSchemaLengthImmediate(
                      "vring_packed_desc_tx_hdr_hash_tunnel", group.first);
                  noteSchemaLengthImmediate(
                      "vring_desc_extra_tx_hdr_hash_tunnel", group.first);
                } else {
                  noteSchemaLengthImmediate("vring_desc_tx_hdr_plain",
                                            group.first);
                  noteSchemaLengthImmediate(
                      "vring_packed_desc_tx_hdr_plain", group.first);
                  noteSchemaLengthImmediate(
                      "vring_desc_extra_tx_hdr_plain", group.first);
                }
              }
              if (isFramePayload(group.second)) {
                noteSchemaLengthImmediate("vring_desc_tx_frame", group.first);
                noteSchemaLengthImmediate("vring_packed_desc_tx_frame",
                                          group.first);
                noteSchemaLengthImmediate("vring_desc_extra_tx_frame",
                                          group.first);
                if (canonicalizePayloadTypeName(group.second.type) ==
                    "xdp_frame") {
                  noteSchemaLengthImmediate("vring_desc_tx_frame_xdp",
                                            group.first);
                } else {
                  noteSchemaLengthImmediate("vring_desc_tx_frame_skb",
                                            group.first);
                }
              }
            }
          };
      bool hasInformativeControlPayload = false;
      for (const auto &group : lengthGroups) {
        if (rxReceiveBufferContext) {
          noteSchemaLengthImmediate("VIRTIO_NET_RX_VRING", group.first);
        } else if (controlCommandContext) {
          noteSchemaLengthImmediate("VIRTIO_NET_CTRL_VRING", group.first);
        } else if (txDataContext || txSemanticTrace) {
          noteSchemaLengthImmediate("VIRTIO_NET_TX_VRING", group.first);
        }
        noteDescriptorRoleLengths(group);
        if (!payloadIsPureControlBuf(group.second) &&
            !payloadIsGeneric(group.second)) {
          hasInformativeControlPayload = true;
        }
      }
      if (!hasInformativeControlPayload &&
          haveFallback &&
          !payloadIsPureControlBuf(fallbackPayload) &&
          !payloadIsGeneric(fallbackPayload)) {
        hasInformativeControlPayload = true;
      }
      if (hasInformativeControlPayload) {
        llvm::erase_if(lengthGroups, [](const auto &group) {
          return payloadIsPureControlBuf(group.second);
        });
        if (payloadIsPureControlBuf(fallbackPayload)) {
          fallbackPayload = DmaPayloadInfo();
        }
      }
      if ((txTraceContext || txSemanticTrace) &&
          (payloadIsGeneric(fallbackPayload) ||
           fallbackPayload.type.empty() ||
           fallbackPayload.type == "unknown")) {
        forceEthernetFramePayload(fallbackPayload);
        enrichPayloadInfo(fallbackPayload);
      }
      for (auto &group : lengthGroups) {
        if (group.first == 4096 && payloadIsGeneric(group.second)) {
          forceEthernetFramePayload(group.second);
          enrichPayloadInfo(group.second);
        }
      }
      DmaPayloadInfo hashTunnelHeaderPayload = extractPayloadFieldsByPrefixes(
          allPayload, {"virtio_net_hdr_v1_hash_tunnel"},
          "virtio_net_hdr_v1_hash_tunnel", "virtio_net_hdr_v1_hash_tunnel");
      if (!hashTunnelHeaderPayload.fields.empty()) {
        const uint64_t hashTunnelLen = schemaAwarePayloadSize(
                                           "virtio_net_hdr_v1_hash_tunnel",
                                           model_.schemaLengthImmediates)
                                           .value_or(12);
        bool merged = false;
        for (auto &group : lengthGroups) {
          if (group.first == hashTunnelLen) {
            mergePayloadInfoInto(group.second, hashTunnelHeaderPayload);
            normalizeMergedPayloadInfo(group.second);
            merged = true;
            break;
          }
        }
        if (!merged) {
          lengthGroups.push_back({hashTunnelLen, hashTunnelHeaderPayload});
        }
        if (fallbackPayload.type == "virtio_net_hdr_v1_hash_tunnel") {
          fallbackPayload = DmaPayloadInfo();
        }
      }
      if (hashTunnelHeaderPayload.fields.empty()) {
        if (traceContextHasTypedSourceHint("sg_set_buf", 1,
                                           "virtio_net_hdr_v1_hash_tunnel")) {
          DmaPayloadInfo payload;
          payload.kind = "virtio_net_hdr_v1_hash_tunnel";
          payload.type = "virtio_net_hdr_v1_hash_tunnel";
          enrichPayloadInfo(payload);
          const uint64_t hashTunnelLen = schemaAwarePayloadSize(
                                             "virtio_net_hdr_v1_hash_tunnel",
                                             model_.schemaLengthImmediates)
                                             .value_or(12);
          const bool exists = llvm::any_of(
              lengthGroups, [&](const std::pair<uint64_t, DmaPayloadInfo> &group) {
                return group.first == hashTunnelLen &&
                       group.second.type == "virtio_net_hdr_v1_hash_tunnel";
              });
          if (!exists) {
            lengthGroups.push_back({hashTunnelLen, payload});
          }
        }
      }
      if (hashTunnelTrace) {
        std::vector<std::pair<uint64_t, DmaPayloadInfo>> filteredGroups;
        filteredGroups.reserve(lengthGroups.size());
        for (const auto &group : lengthGroups) {
          if (group.second.type == "virtio_net_hdr_v1_hash_tunnel" ||
              group.second.kind == "virtio_net_hdr_v1_hash_tunnel") {
            filteredGroups.push_back(group);
          }
        }
        lengthGroups = std::move(filteredGroups);
        if (fallbackPayload.type != "virtio_net_hdr_v1_hash_tunnel" &&
            fallbackPayload.kind != "virtio_net_hdr_v1_hash_tunnel") {
          fallbackPayload = DmaPayloadInfo();
        }
      }
      DmaPayloadInfo len4Payload = extractPayloadFieldsByPrefixes(
          allPayload, {"virtio_net_ctrl_mac__entries"},
          "virtio_net_ctrl_mac", "sg_buffer");
      if (!len4Payload.fields.empty()) {
        lengthGroups.push_back({4, len4Payload});
      }
      DmaPayloadInfo len6Payload = extractPayloadFieldsByPrefixes(
          allPayload, {"net_device__dev_addr", "sockaddr__sa_data"},
          "virtio_net_ctrl_mac_addr", "sg_buffer");
      if (!len6Payload.fields.empty()) {
        lengthGroups.push_back({6, len6Payload});
      }
      for (const auto &group : lengthGroups) {
        if (rxReceiveBufferContext) {
          noteSchemaLengthImmediate("VIRTIO_NET_RX_VRING", group.first);
        } else if (controlCommandContext) {
          noteSchemaLengthImmediate("VIRTIO_NET_CTRL_VRING", group.first);
        } else if (txDataContext || txSemanticTrace) {
          noteSchemaLengthImmediate("VIRTIO_NET_TX_VRING", group.first);
        }
      }
      std::vector<PayloadPatternBranch> patternBranches;
      if (rssCommandContext) {
        const auto hasFieldPrefix = [](const DmaPayloadInfo &payload,
                                       StringRef prefix) {
          for (const std::string &field : payload.fields) {
            if (StringRef(field).startswith(prefix)) {
              return true;
            }
          }
          return false;
        };
        if (!hasFieldPrefix(allPayload, "virtnet_info__field_46__rss_trailer") &&
            !hasFieldPrefix(allPayload, "virtio_net_rss_config_trailer__")) {
          DmaPayloadInfo rssTrailerPayload;
          rssTrailerPayload.kind = "sg_buffer";
          rssTrailerPayload.type = "virtio_net_rss_config_trailer";
          enrichPayloadInfo(rssTrailerPayload);
          appendMissingCanonicalFields(allPayload.fields, rssTrailerPayload.fields);
          appendMissingCanonicalFields(fallbackPayload.fields,
                                       rssTrailerPayload.fields);
        }
        auto ensureLengthGroup = [&](StringRef typeName) {
          const std::optional<uint64_t> len =
              schemaAwarePayloadSize(typeName, model_.schemaLengthImmediates);
          if (!len) {
            return;
          }
          const bool exists = llvm::any_of(
              lengthGroups, [&](const std::pair<uint64_t, DmaPayloadInfo> &group) {
                return group.first == *len &&
                       canonicalizePayloadTypeName(group.second.type) ==
                           canonicalizePayloadTypeName(typeName);
              });
          if (exists) {
            return;
          }
          DmaPayloadInfo payload;
          payload.kind = "sg_buffer";
          payload.type = typeName.str();
          enrichPayloadInfo(payload);
          lengthGroups.push_back({*len, payload});
        };
        ensureLengthGroup("virtio_net_rss_config_hdr");
        ensureLengthGroup("virtio_net_rss_config_trailer");
      }
      if (rxReceiveBufferContext) {
        DmaPayloadInfo rxFramePayload;
        forceEthernetFramePayload(rxFramePayload);
        patternBranches.push_back({
            {
                "neqj len ult 4064, 0, @MISS",
            },
            {rxFramePayload},
        });
        llvm::erase_if(lengthGroups, [](const auto &group) {
          return group.first >= 4064;
        });
      }
      if (!controlCommandContext && !rssCommandContext) {
        DmaPayloadInfo arpPacketPayload = specializeArpPayload(
            specializeEthernetFramePayload(allPayload, "ethernet_arp_frame"),
            "arp_packet");
        if (!arpPacketPayload.fields.empty()) {
          patternBranches.push_back({
              {
                  "neqj len, 60, @MISS",
              },
              {arpPacketPayload},
          });
        }
        DmaPayloadInfo vlanArpPayload = specializeVlanPayload(
            specializeEthernetFramePayload(allPayload, "ethernet_vlan_frame"),
            "vlan_arp_packet");
        if (!vlanArpPayload.fields.empty()) {
          patternBranches.push_back({
              {
                  "neqj len, 64, @MISS",
              },
              {vlanArpPayload},
          });
        }
      }
      DmaPayloadInfo xdpPayload = extractPayloadFieldsByPrefixes(
          allPayload, {"xdp_frame__data"},
          "xdp_frame", "xdp_frame");
      if (!xdpPayload.fields.empty()) {
        patternBranches.push_back({
            {
                "neqj len ult 256, 0, @MISS",
            },
            {xdpPayload},
        });
      }
      DmaPayloadInfo queueStatsPayload = extractPayloadFieldsByPrefixes(
          allPayload, {"virtio_net_ctrl_queue_stats"},
          "virtio_net_ctrl_queue_stats", "sg_buffer");
      if (controlCommandContext && !queueStatsPayload.fields.empty()) {
        patternBranches.push_back({
            {
                "neqj len & 15, 0, @MISS",
                "neqj len ult 16, 0, @MISS",
            },
            {queueStatsPayload},
        });
      }
      DmaPayloadInfo rssTrailerPayload = extractPayloadFieldsByPrefixes(
          allPayload,
          {"virtnet_info__field_46__rss_trailer",
           "virtio_net_rss_config_trailer__"},
          "virtio_net_rss_config_trailer", "sg_buffer");
      if (rssCommandContext && !rssTrailerPayload.fields.empty()) {
        patternBranches.push_back({
            {
                "neqj len ult 64, 0, @MISS",
                "neqj len & 1, 1, @MISS",
            },
            {rssTrailerPayload},
        });
      }
      llvm::erase_if(lengthGroups, [](const auto &group) {
        if (group.second.type == "arp_packet" ||
            group.second.type == "vlan_arp_packet") {
          return true;
        }
        for (const std::string &field : group.second.fields) {
          if (StringRef(field).startswith("arp_packet__") ||
              StringRef(field).startswith("vlan_arp_packet__")) {
            return true;
          }
        }
        return false;
      });
      std::vector<std::pair<uint64_t, DmaPayloadInfo>> toLengthGroups = lengthGroups;
      std::vector<std::pair<uint64_t, DmaPayloadInfo>> fromLengthGroups = lengthGroups;
      std::vector<PayloadPatternBranch> toPatternBranches = patternBranches;
      std::vector<PayloadPatternBranch> fromPatternBranches = patternBranches;
      DmaPayloadInfo zeroFromPayload;
      zeroFromPayload.kind = "zero_buffer";
      zeroFromPayload.type.clear();
      zeroFromPayload.fields.clear();
      fromPatternBranches.insert(fromPatternBranches.begin(), {{
          {
              "neqj len ult 256, 0, @MISS",
          },
          {zeroFromPayload},
      }});
      if (controlCommandContext) {
        auto isControlReplyPayload = [](const DmaPayloadInfo &payload) {
          const std::string type = canonicalizePayloadTypeName(payload.type);
          return type == "virtio_net_ctrl_status" ||
                 type == "virtio_net_stats_capabilities" ||
                 type == "virtio_net_stats_reply_hdr" ||
                 type == "virtio_net_stats_cvq" ||
                 type == "virtio_net_stats_rx_basic" ||
                 type == "virtio_net_stats_tx_basic" ||
                 type == "virtio_net_stats_rx_csum" ||
                 type == "virtio_net_stats_tx_csum" ||
                 type == "virtio_net_stats_rx_gso" ||
                 type == "virtio_net_stats_tx_gso" ||
                 type == "virtio_net_stats_rx_speed" ||
                 type == "virtio_net_stats_tx_speed";
        };
        auto isControlRequestPayload = [&](const DmaPayloadInfo &payload) {
          if (isControlReplyPayload(payload)) {
            return false;
          }
          const std::string type = canonicalizePayloadTypeName(payload.type);
          return type == "virtio_net_ctrl_hdr" ||
                 type == "virtio_net_ctrl_hdr_mac" ||
                 type == "virtio_net_ctrl_hdr_vlan_add" ||
                 type == "virtio_net_ctrl_hdr_vlan_del" ||
                 type == "virtio_net_ctrl_hdr_mq" ||
                 type == "virtio_net_ctrl_hdr_guest_offloads" ||
                 type == "virtio_net_ctrl_hdr_coal_rx" ||
                 type == "virtio_net_ctrl_hdr_coal_tx" ||
                 type == "virtio_net_ctrl_hdr_coal_vq" ||
                 type == "virtio_net_ctrl_hdr_queue_stats" ||
                 type == "virtio_net_ctrl_mac_addr" ||
                 type == "virtio_net_ctrl_vlan" ||
                 type == "virtio_net_ctrl_mq" ||
                 type == "virtio_net_ctrl_coal_rx" ||
                 type == "virtio_net_ctrl_coal_tx" ||
                 type == "virtio_net_ctrl_coal_vq" ||
                 type == "virtio_net_ctrl_queue_stats" ||
                 type == "virtio_net_guest_offloads" ||
                 type == "virtio_net_rss_config_hdr" ||
                 type == "virtio_net_rss_config_trailer";
        };
        const bool hasLen2Group = llvm::any_of(
            toLengthGroups, [](const std::pair<uint64_t, DmaPayloadInfo> &group) {
              return group.first == 2;
            });
        DmaPayloadInfo ctrlHdrPayload;
        ctrlHdrPayload.kind = "sg_buffer";
        ctrlHdrPayload.type = specificControlHeaderTypeForTraceContext();
        const bool haveSpecificCtrlHdr = !ctrlHdrPayload.type.empty();
        if (!haveSpecificCtrlHdr) {
          ctrlHdrPayload.type = "virtio_net_ctrl_hdr";
        }
        enrichPayloadInfo(ctrlHdrPayload);
        if (haveSpecificCtrlHdr) {
          toLengthGroups.insert(toLengthGroups.begin(), {2, ctrlHdrPayload});
        } else if (!hasLen2Group) {
          toPatternBranches.insert(toPatternBranches.begin(), {{
              {
                  "neqj len, 2, @MISS",
              },
              {ctrlHdrPayload},
          }});
        }
        DmaPayloadInfo ctrlStatusPayload;
        ctrlStatusPayload.kind = "sg_buffer";
        ctrlStatusPayload.type = "virtio_net_ctrl_status";
        enrichPayloadInfo(ctrlStatusPayload);
        fromPatternBranches.insert(fromPatternBranches.begin(), {{
            {
                "neqj len, 1, @MISS",
            },
            {ctrlStatusPayload},
        }});
        llvm::erase_if(toLengthGroups, [](const auto &group) {
          return group.second.type == "control_buf" ||
                 payloadIsPureControlBuf(group.second);
        });
        llvm::erase_if(fromLengthGroups, [](const auto &group) {
          return group.second.type == "control_buf" ||
                 payloadIsPureControlBuf(group.second);
        });
        llvm::erase_if(toLengthGroups, [&](const auto &group) {
          return isControlReplyPayload(group.second);
        });
        llvm::erase_if(fromLengthGroups, [&](const auto &group) {
          return isControlRequestPayload(group.second);
        });
        llvm::erase_if(toPatternBranches, [&](const PayloadPatternBranch &branch) {
          return llvm::all_of(branch.payloads, [&](const DmaPayloadInfo &payload) {
            return isControlReplyPayload(payload);
          });
        });
        llvm::erase_if(fromPatternBranches,
                       [&](const PayloadPatternBranch &branch) {
                         return llvm::all_of(
                             branch.payloads,
                             [&](const DmaPayloadInfo &payload) {
                               return isControlRequestPayload(payload);
                             });
                       });
      }
      if (traceContextHasFunction("virtnet_send_command")) {
        auto isNonStatusPayload = [](const DmaPayloadInfo &payload) {
          return payload.type != "virtio_net_ctrl_status";
        };
        llvm::erase_if(fromLengthGroups, [&](const auto &group) {
          return isNonStatusPayload(group.second);
        });
        llvm::erase_if(fromPatternBranches,
                       [&](const PayloadPatternBranch &branch) {
                         return llvm::all_of(
                             branch.payloads, [&](const DmaPayloadInfo &payload) {
                               return isNonStatusPayload(payload);
                             });
                       });
      }
      if (traceContextHasFunction("__virtnet_get_hw_stats")) {
        auto isDisallowedStatsReplyPayload = [](const DmaPayloadInfo &payload) {
          const std::string type = canonicalizePayloadTypeName(payload.type);
          return type != "virtio_net_stats_reply_hdr" &&
                 type != "virtio_net_ctrl_status";
        };
        llvm::erase_if(fromLengthGroups, [&](const auto &group) {
          return isDisallowedStatsReplyPayload(group.second);
        });
        llvm::erase_if(fromPatternBranches,
                       [&](const PayloadPatternBranch &branch) {
                         return llvm::all_of(
                             branch.payloads, [&](const DmaPayloadInfo &payload) {
                               return isDisallowedStatsReplyPayload(payload);
                             });
                       });
        llvm::erase_if(fromLengthGroups, [&](const auto &group) {
          return canonicalizePayloadTypeName(group.second.type) ==
                 "virtio_net_stats_reply_hdr";
        });
        DmaPayloadInfo statsReplyHdrPayload;
        statsReplyHdrPayload.kind = "sg_buffer";
        statsReplyHdrPayload.type = "virtio_net_stats_reply_hdr";
        enrichPayloadInfo(statsReplyHdrPayload);
        std::vector<DmaPayloadInfo> statsReplyPayloads = {statsReplyHdrPayload};
        for (StringRef typeName :
             {"virtio_net_stats_cvq",
              "virtio_net_stats_rx_basic",
              "virtio_net_stats_tx_basic",
              "virtio_net_stats_rx_csum",
              "virtio_net_stats_tx_csum",
              "virtio_net_stats_rx_gso",
              "virtio_net_stats_tx_gso",
              "virtio_net_stats_rx_speed",
              "virtio_net_stats_tx_speed"}) {
          DmaPayloadInfo payload;
          payload.kind = "sg_buffer";
          payload.type = typeName.str();
          enrichPayloadInfo(payload);
          statsReplyPayloads.push_back(std::move(payload));
        }
        fromPatternBranches.insert(fromPatternBranches.begin(), {{
            {
                "neqj len ult 8, 0, @MISS",
            },
            statsReplyPayloads,
        }});
      }
      if (rssCommandContext) {
        auto isRssPayload = [](const DmaPayloadInfo &payload) {
          if (payload.type == "virtio_net_rss_config_hdr" ||
              payload.type == "virtio_net_rss_config_trailer") {
            return true;
          }
          for (const std::string &field : payload.fields) {
            if (StringRef(field).startswith("virtio_net_rss_config_hdr__") ||
                StringRef(field).startswith("virtio_net_rss_config_trailer__") ||
                StringRef(field).startswith("virtnet_info__rss_hdr") ||
                StringRef(field).startswith("virtnet_info__field_46__rss_trailer")) {
              return true;
            }
          }
          return false;
        };
        llvm::erase_if(fromLengthGroups, [&](const auto &group) {
          return isRssPayload(group.second);
        });
        llvm::erase_if(fromPatternBranches,
                       [&](const PayloadPatternBranch &branch) {
                         return llvm::all_of(
                             branch.payloads, [&](const DmaPayloadInfo &payload) {
                               return isRssPayload(payload);
                             });
                       });
      }
      if (txTraceContext || rxReceiveBufferContext) {
        auto isControlPayload = [](const DmaPayloadInfo &payload) {
          if (isVirtioNetControlPayloadType(payload.type)) {
            return true;
          }
          for (const std::string &field : payload.fields) {
            if (isVirtioNetControlField(field)) {
              return true;
            }
          }
          return false;
        };
        llvm::erase_if(toLengthGroups, [&](const auto &group) {
          return isControlPayload(group.second);
        });
        llvm::erase_if(fromLengthGroups, [&](const auto &group) {
          return isControlPayload(group.second);
        });
        llvm::erase_if(toPatternBranches, [&](const PayloadPatternBranch &branch) {
          return llvm::all_of(
              branch.payloads, [&](const DmaPayloadInfo &payload) {
                return isControlPayload(payload);
              });
        });
        llvm::erase_if(fromPatternBranches,
                       [&](const PayloadPatternBranch &branch) {
                         return llvm::all_of(
                             branch.payloads, [&](const DmaPayloadInfo &payload) {
                               return isControlPayload(payload);
                             });
                       });
        if (isControlPayload(fallbackPayload)) {
          fallbackPayload = DmaPayloadInfo();
        }
      }
      dedupeLengthGroups(toLengthGroups);
      dedupeLengthGroups(fromLengthGroups);
      if (controlCommandContext) {
        filterLengthGroupsByFixedSchemaSize(toLengthGroups,
                                            model_.schemaLengthImmediates);
        filterLengthGroupsByFixedSchemaSize(fromLengthGroups,
                                            model_.schemaLengthImmediates);
      }
      if (!knownInbufOnly) {
        const bool rejectToFallback = hashTunnelTrace || controlCommandContext;
        appendGroupedPayloadBlocks(trace, "bb_vring_map_one_sg_phys_dispatch",
                                     "bb_vring_map_one_sg_phys_next", "map", "to_device", "phys",
                                     "addr", "len", toLengthGroups, fallbackPayload,
                                     allowGenericHeaderHeuristic,
                                     toPatternBranches,
                                     rejectToFallback,
                                     txTraceContext || txSemanticTrace);
      }
      if (!knownInbufOnly) {
        pushBlock("bb_vring_map_one_sg_dma_api", {
                                                    "map_addr = virtqueue_map_page_attrs(vq.vq, sg_page(sg), sg.offset, sg.length, direction, 0)",
                                                    "neqj map_addr, DMA_MAPPING_ERROR, @bb_vring_map_one_sg_dma_ok",
                                                });
        std::vector<std::string> okLines = {
            "addr = map_addr",
            "goto @bb_vring_map_one_sg_dma_dispatch",
        };
        pushBlock("bb_vring_map_one_sg_dma_ok", std::move(okLines));
        const bool rejectToFallback = hashTunnelTrace || controlCommandContext;
        appendGroupedPayloadBlocks(trace, "bb_vring_map_one_sg_dma_dispatch",
                                     "bb_vring_map_one_sg_dma_next", "map", "to_device", "dma_api",
                                     "addr", "len", toLengthGroups, fallbackPayload,
                                     allowGenericHeaderHeuristic,
                                     toPatternBranches,
                                     rejectToFallback,
                                     txTraceContext || txSemanticTrace);
      }
      if (!knownOutbufOnly) {
        const bool rejectFromFallback = hashTunnelTrace || controlCommandContext;
        appendGroupedPayloadBlocks(trace, "bb_vring_map_one_sg_from_phys_dispatch",
                                     "bb_vring_map_one_sg_from_phys_next", "map", "from_device", "phys",
                                     "addr", "len", fromLengthGroups, fallbackPayload,
                                     allowGenericHeaderHeuristic,
                                     fromPatternBranches,
                                     rejectFromFallback);
      }
      if (!knownOutbufOnly) {
        pushBlock("bb_vring_map_one_sg_from_dma_api", {
                                                    "map_addr = virtqueue_map_page_attrs(vq.vq, sg_page(sg), sg.offset, sg.length, direction, 0)",
                                                    "neqj map_addr, DMA_MAPPING_ERROR, @bb_vring_map_one_sg_from_dma_ok",
                                                });
        std::vector<std::string> fromOkLines = {
            "addr = map_addr",
            "goto @bb_vring_map_one_sg_from_dma_dispatch",
        };
        pushBlock("bb_vring_map_one_sg_from_dma_ok", std::move(fromOkLines));
        const bool rejectFromFallback = hashTunnelTrace || controlCommandContext;
        appendGroupedPayloadBlocks(trace, "bb_vring_map_one_sg_from_dma_dispatch",
                                     "bb_vring_map_one_sg_from_dma_next", "map", "from_device", "dma_api",
                                     "addr", "len", fromLengthGroups, fallbackPayload,
                                     allowGenericHeaderHeuristic,
                                     fromPatternBranches,
                                     rejectFromFallback);
      }
      pushBlock("bb_vring_map_one_sg_done", {});
      model_.traces.push_back(std::move(trace));
      return;
    }

    const DmaPayloadInfo payload =
        variants.empty() ? DmaPayloadInfo() : variants.front().payload;

    if (name == "vring_map_single") {
      std::vector<std::string> entryLines = {
          "neqj direction, DMA_TO_DEVICE, @bb_vring_map_single_done",
          "neqj vq.use_map_api, 0, @bb_vring_map_single_dma_api",
          "addr = virt_to_phys(cpu_addr)",
      };
      appendSyntheticDmaEvent(entryLines, "map", "to_device", "phys", "addr",
                              "size", payload);
      entryLines.push_back("goto @bb_vring_map_single_done");
      pushBlock("", std::move(entryLines));
      pushBlock("bb_vring_map_single_dma_api", {
                                                  "map_addr = virtqueue_map_single_attrs(vq.vq, cpu_addr, size, direction, 0)",
                                                  "neqj map_addr, DMA_MAPPING_ERROR, @bb_vring_map_single_dma_ok",
                                              });
      std::vector<std::string> okLines = {
          "addr = map_addr",
      };
      appendSyntheticDmaEvent(okLines, "map", "to_device", "dma_api", "addr",
                              "size", payload);
      pushBlock("bb_vring_map_single_dma_ok", std::move(okLines));
      pushBlock("bb_vring_map_single_done", {});
      model_.traces.push_back(std::move(trace));
      return;
    }

    if (name == "sg_fill_dma") {
      std::vector<std::string> entryLines;
      appendSyntheticDmaEvent(entryLines, "map", "from_device", "dma_api",
                              "dma", "len", payload);
      pushBlock("", std::move(entryLines));
      model_.traces.push_back(std::move(trace));
      return;
    }

    if (name == "vring_unmap_one_split" || name == "vring_unmap_extra_packed") {
      const std::string doneLabel =
          name == "vring_unmap_one_split" ? "bb_vring_unmap_one_split_done"
                                           : "bb_vring_unmap_extra_packed_done";
      const std::string fromPhysLabel =
          name == "vring_unmap_one_split" ? "bb_vring_unmap_one_split_from_phys"
                                           : "bb_vring_unmap_extra_packed_from_phys";
      const std::string toPhysLabel =
          name == "vring_unmap_one_split" ? "bb_vring_unmap_one_split_to_phys"
                                           : "bb_vring_unmap_extra_packed_to_phys";
      pushBlock("", {
                        "neqj extra.flags & VRING_DESC_F_WRITE, 0, @" + fromPhysLabel,
                        "goto @" + toPhysLabel,
                    });
      std::vector<std::string> fromPhysLines;
      appendSyntheticDmaEvent(fromPhysLines, "unmap", "from_device", "phys",
                              "extra.addr", "extra.len", payload);
      fromPhysLines.push_back("goto @" + doneLabel);
      pushBlock(fromPhysLabel, std::move(fromPhysLines));
      std::vector<std::string> toPhysLines;
      appendSyntheticDmaEvent(toPhysLines, "unmap", "to_device", "phys",
                              "extra.addr", "extra.len", payload);
      toPhysLines.push_back("goto @" + doneLabel);
      pushBlock(toPhysLabel, std::move(toPhysLines));
      pushBlock(doneLabel, {});
      model_.traces.push_back(std::move(trace));
      return;
    }
  }

  void emitSyntheticDmaCall(const Function &callee,
                            const CallBase &call,
                            std::vector<std::string> &lines) {
    const std::vector<DmaPayloadVariant> variants =
        inferSyntheticDmaPayloadVariants(callee, call);
    const DmaPayloadInfo payload =
        variants.empty() ? DmaPayloadInfo() : variants.front().payload;
    std::string suffix;
    const bool genericVringMapOneSg =
        callee.getName() == "vring_map_one_sg" &&
        variants.size() == 1 &&
        payload.kind == "sg_buffer" &&
        (payload.type.empty() || payload.type == "unknown");
    if (callee.getName() == "vring_map_one_sg" &&
        (variants.size() > 1 || genericVringMapOneSg)) {
      std::string callsiteSuffix;
      if (const Instruction *inst = llvm::dyn_cast<Instruction>(&call)) {
        const llvm::DebugLoc &debugLoc = inst->getDebugLoc();
        if (debugLoc) {
          std::string prefix;
          if (!traceBuildStack_.empty()) {
            prefix = traceBuildStack_.back().baseName;
          } else {
            prefix = baseNameForFunction(*call.getFunction());
          }
          callsiteSuffix = sanitizeToken(
              prefix + "__vring_map_one_sg_" + std::to_string(debugLoc.getLine()));
        }
      }
      if (genericVringMapOneSg) {
        suffix = callsiteSuffix.empty() ? "sg_buffer_ctx"
                                        : ("sg_buffer_" + callsiteSuffix);
      } else {
        suffix = callsiteSuffix.empty() ? "multi"
                                        : ("multi_" + callsiteSuffix);
      }
    } else if (callee.getName() == "sg_fill_dma") {
      std::string callsiteSuffix;
      if (const Instruction *inst = llvm::dyn_cast<Instruction>(&call)) {
        const llvm::DebugLoc &debugLoc = inst->getDebugLoc();
        if (debugLoc) {
          std::string prefix;
          if (!traceBuildStack_.empty()) {
            prefix = traceBuildStack_.back().baseName;
          } else {
            prefix = baseNameForFunction(*call.getFunction());
          }
          callsiteSuffix = sanitizeToken(
              prefix + "__sg_fill_dma_" + std::to_string(debugLoc.getLine()));
        }
      }
      suffix = callsiteSuffix.empty()
                   ? (payload.type != "unknown" ? payload.type : payload.kind)
                   : callsiteSuffix;
    } else {
      suffix = payload.type != "unknown" ? payload.type : payload.kind;
    }
    if (suffix.empty()) {
      suffix = payload.kind;
    }
    const std::string syntheticBaseName =
        sanitizeToken(callee.getName()) + "__" + sanitizeToken(suffix);

    if (!call.getType()->isVoidTy() && !call.use_empty()) {
      const std::string resultName =
          preferredCallResultName(call, &callee).value_or(nameForValue(&call));
      valueNames_[&call] = resultName;
      lines.push_back(resultName + " = " + syntheticBaseName +
                      renderCallExprArgs(call));
    } else {
      lines.push_back("call " + syntheticBaseName + renderCallArgs(call));
    }
    buildSyntheticDmaTraceForCall(callee, call, syntheticBaseName);
  }
