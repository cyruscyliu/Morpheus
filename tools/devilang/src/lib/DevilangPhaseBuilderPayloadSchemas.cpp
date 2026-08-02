  static void addSchemaWithPositions(
      MachineModel &model,
      llvm::StringRef name,
      const std::vector<std::string> &positions) {
    const std::string token = sanitizeToken(name);
    if (token.empty() || token == "unknown" || token == "unnamed") {
      return;
    }
    model.schemaTypes.insert(token);
    for (const std::string &position : positions) {
      if (!position.empty()) {
        model.schemaHeadPositions[token].insert(position);
      }
    }
  }

  static bool payloadHasFieldPrefix(const DmaPayloadInfo &payload,
                                    llvm::StringRef prefix) {
    for (const std::string &field : payload.fields) {
      if (llvm::StringRef(field).startswith(prefix)) {
        return true;
      }
    }
    return false;
  }

  static void notePayloadContextSchemas(
      MachineModel &model,
      const std::vector<std::string> &positions,
      const std::set<std::string> &contextFunctions,
      const DmaPayloadInfo &payload,
      bool hasHwStatsTraceContext) {
    const auto hasFn = [&](llvm::StringRef token) {
      return contextFunctions.find(sanitizeToken(token)) !=
             contextFunctions.end();
    };

    if (hasFn("virtnet_add_outbuf") || hasFn("xmit_skb") ||
        hasFn("__virtnet_xdp_xmit_one") || hasFn("virtnet_xdp_xmit")) {
      addSchemaWithPositions(model, "VIRTIO_NET_TX_VRING", positions);
      addSchemaWithPositions(model, "VIRTIO_NET_TX_BUF0", positions);
    }
    if (hasFn("add_recvbuf_big") || hasFn("add_recvbuf_mergeable") ||
        hasFn("add_recvbuf_small") || hasFn("try_fill_recv") ||
        hasFn("__virtnet_rx_resume") || hasFn("virtnet_rq_alloc")) {
      addSchemaWithPositions(model, "VIRTIO_NET_RX_VRING", positions);
      addSchemaWithPositions(model, "VIRTIO_NET_RX_BUF0", positions);
    }
    if (hasFn("virtnet_send_command") || hasFn("virtnet_send_command_reply") ||
        hasFn("virtqueue_add_sgs")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_VRING", positions);
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_BUF0", positions);
      addSchemaWithPositions(model, "virtio_net_ctrl_status", positions);
      addSchemaWithPositions(model, "virtio_net_stats_reply_hdr", positions);
    }
    if (payloadHasFieldPrefix(payload, "sockaddr__sa_data")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_11", positions);
    }
    if (payload.type == "virtio_net_ctrl_mac_addr" ||
        payloadHasFieldPrefix(payload, "virtio_net_ctrl_mac_addr__mac") ||
        payloadHasFieldPrefix(payload, "sockaddr__sa_data")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_11", positions);
    }
    if (payloadHasFieldPrefix(payload, "virtio_net_ctrl_mq__virtqueue_pairs")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_40", positions);
    }
    if (payload.type == "virtio_net_ctrl_vlan" ||
        payloadHasFieldPrefix(payload, "virtio_net_ctrl_vlan__vid")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_2", positions);
    }
    if (payloadHasFieldPrefix(payload, "virtnet_info__rss_hdr") ||
        payloadHasFieldPrefix(payload, "virtnet_info__field_46__rss_trailer") ||
        payloadHasFieldPrefix(payload, "virtio_net_rss_config_hdr__") ||
        payloadHasFieldPrefix(payload, "virtio_net_rss_config_trailer__")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_41", positions);
    }
    if (payload.type == "virtio_net_guest_offloads" ||
        payloadHasFieldPrefix(payload, "virtio_net_guest_offloads__value") ||
        payloadHasFieldPrefix(payload, "__virtio64__value")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_5", positions);
    }
    if (payloadHasFieldPrefix(payload, "virtio_net_ctrl_coal_tx__")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_COAL_TX", positions);
    }
    if (payloadHasFieldPrefix(payload, "virtio_net_ctrl_coal_rx__")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_COAL_RX", positions);
    }
    if (payloadHasFieldPrefix(payload, "virtio_net_ctrl_coal_vq__")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_COAL_VQ", positions);
    }
    if (payloadHasFieldPrefix(payload, "virtio_net_ctrl_queue_stats__")) {
      addSchemaWithPositions(model, "VIRTIO_NET_CTRL_CTRL_HDR_QUEUE_STATS", positions);
    }
    if (payload.type == "virtio_net_stats_capabilities" ||
        payloadHasFieldPrefix(payload, "virtio_net_stats_capabilities__")) {
      addSchemaWithPositions(model, "virtio_net_stats_capabilities", positions);
    }
    if (payload.type == "virtio_net_stats_reply_hdr" ||
        payloadHasFieldPrefix(payload, "virtio_net_stats_reply_hdr__")) {
      addSchemaWithPositions(model, "virtio_net_stats_reply_hdr", positions);
      if (hasHwStatsTraceContext) {
        for (llvm::StringRef name : {"virtio_net_stats_cvq",
                                     "virtio_net_stats_rx_basic",
                                     "virtio_net_stats_tx_basic",
                                     "virtio_net_stats_rx_csum",
                                     "virtio_net_stats_tx_csum",
                                     "virtio_net_stats_rx_gso",
                                     "virtio_net_stats_tx_gso",
                                     "virtio_net_stats_rx_speed",
                                     "virtio_net_stats_tx_speed"}) {
          addSchemaWithPositions(model, name, positions);
        }
      }
    }
  }

  static void notePayloadFieldDerivedSchemas(
      MachineModel &model,
      const std::vector<std::string> &positions,
      const std::vector<std::string> &fields) {
    static const std::pair<llvm::StringRef, llvm::StringRef> kFieldSchemas[] = {
        {"virtnet_info__rss_hdr", "virtio_net_rss_config_hdr"},
        {"virtio_net_rss_config_hdr__", "virtio_net_rss_config_hdr"},
        {"virtnet_info__field_46__rss_trailer", "virtio_net_rss_config_trailer"},
        {"virtio_net_rss_config_trailer__", "virtio_net_rss_config_trailer"},
        {"virtio_net_hdr__", "virtio_net_hdr"},
        {"virtio_net_hdr_mrg_rxbuf__", "virtio_net_hdr_mrg_rxbuf"},
        {"virtio_net_hdr_v1_hash_tunnel__", "virtio_net_hdr_v1_hash_tunnel"},
        {"virtnet_rq_dma__", "virtnet_rq_dma"},
        {"virtio_net_ctrl_mac_addr__", "virtio_net_ctrl_mac_addr"},
        {"virtio_net_ctrl_hdr_mac__", "virtio_net_ctrl_hdr_mac"},
        {"virtio_net_ctrl_hdr_vlan_add__", "virtio_net_ctrl_hdr_vlan_add"},
        {"virtio_net_ctrl_hdr_vlan_del__", "virtio_net_ctrl_hdr_vlan_del"},
        {"virtio_net_ctrl_hdr_mq__", "virtio_net_ctrl_hdr_mq"},
        {"virtio_net_ctrl_hdr_guest_offloads__", "virtio_net_ctrl_hdr_guest_offloads"},
        {"virtio_net_ctrl_hdr_coal_tx__", "virtio_net_ctrl_hdr_coal_tx"},
        {"virtio_net_ctrl_hdr_coal_rx__", "virtio_net_ctrl_hdr_coal_rx"},
        {"virtio_net_ctrl_hdr_coal_vq__", "virtio_net_ctrl_hdr_coal_vq"},
        {"virtio_net_ctrl_hdr_queue_stats__", "virtio_net_ctrl_hdr_queue_stats"},
        {"virtio_net_ctrl_hdr__", "virtio_net_ctrl_hdr"},
        {"virtio_net_ctrl_status__", "virtio_net_ctrl_status"},
        {"virtio_net_ctrl_vlan__", "virtio_net_ctrl_vlan"},
        {"virtio_net_guest_offloads__", "virtio_net_guest_offloads"},
        {"virtio_net_stats_capabilities__", "virtio_net_stats_capabilities"},
        {"sockaddr__", "sockaddr"},
        {"net_device__dev_addr", "net_device"},
        {"xdp_frame__", "xdp_frame"},
        {"ethernet_ipv4_frame__", "ethernet_ipv4_frame"},
        {"ethernet_ipv6_frame__", "ethernet_ipv6_frame"},
        {"ethernet_arp_frame__", "ethernet_arp_frame"},
        {"arp_packet__", "arp_packet"},
        {"ethernet_vlan_frame__", "ethernet_vlan_frame"},
        {"ipv4_tcp_packet__", "ipv4_tcp_packet"},
        {"ipv4_udp_packet__", "ipv4_udp_packet"},
        {"ipv4_icmp_packet__", "ipv4_icmp_packet"},
        {"ipv6_tcp_packet__", "ipv6_tcp_packet"},
        {"ipv6_udp_packet__", "ipv6_udp_packet"},
        {"ipv6_icmpv6_packet__", "ipv6_icmpv6_packet"},
        {"ipv6_fragment_packet__", "ipv6_fragment_packet"},
        {"vlan_ipv4_packet__", "vlan_ipv4_packet"},
        {"vlan_ipv6_packet__", "vlan_ipv6_packet"},
        {"vlan_arp_packet__", "vlan_arp_packet"},
        {"control_buf__", "control_buf"},
    };

    for (const std::string &field : fields) {
      llvm::StringRef fieldRef(field);
      for (const auto &[prefix, schema] : kFieldSchemas) {
        if (fieldRef.startswith(prefix)) {
          addSchemaWithPositions(model, schema, positions);
          break;
        }
      }
    }
  }

  void notePayloadSchema(const DmaPayloadInfo &payload) {
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
             "; callee = " + sanitizeToken(frame.function->getName()) +
             "; call_depth = " + std::to_string(depth) +
             "; argument_index = 0]";
    };
    std::vector<std::string> currentPositions;
    std::set<std::string> contextFunctions;
    if (!traceBuildStack_.empty()) {
      unsigned depth = 0;
      const TraceBuildFrame *nearest = nullptr;
      const TraceBuildFrame *surface = nullptr;
      for (auto it = traceBuildStack_.rbegin(); it != traceBuildStack_.rend();
           ++it, ++depth) {
        contextFunctions.insert(sanitizeToken(it->function->getName()));
        if (!it->caller) {
          continue;
        }
        contextFunctions.insert(
            sanitizeToken(it->caller->getFunction()->getName()));
        if (!nearest) {
          nearest = &*it;
        }
        const StringRef callerName = it->caller->getFunction()->getName();
        const StringRef calleeName = it->function->getName();
        if (!surface &&
            !isQueueTransportFunctionName(callerName) &&
            !isQueueTransportFunctionName(calleeName) &&
            std::find(request_.entryFunctions.begin(), request_.entryFunctions.end(),
                      callerName.str()) != request_.entryFunctions.end()) {
          surface = &*it;
          break;
        }
        if (!surface &&
            !isQueueTransportFunctionName(callerName) &&
            !isQueueTransportFunctionName(calleeName)) {
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
                                   "; callee = dma_event; call_depth = 0; argument_index = 0]");
      }
    }
    notePayloadContextSchemas(model_, currentPositions, contextFunctions, payload,
                              traceContextHasFunction("__virtnet_get_hw_stats"));
    addSchemaWithPositions(model_, payload.type, currentPositions);
    const std::string payloadTypeToken = sanitizeToken(payload.type);
    if (!payloadTypeToken.empty() && payloadTypeToken != "unknown" &&
        payloadTypeToken != "unnamed") {
      auto &observed = model_.schemaObservedFields[payloadTypeToken];
      for (const std::string &field : payload.fields) {
        observed.insert(field);
      }
    }
    notePayloadFieldDerivedSchemas(model_, currentPositions, payload.fields);
  }

  static std::optional<std::string> renderSchemaDecl(
      StringRef typeName,
      const std::map<std::string, MachineModel::ExplicitSchemaDecl> &explicitSchemas,
      const std::map<std::string, std::set<uint64_t>> &schemaLengthImmediates,
      const std::map<std::string, std::set<std::pair<uint64_t, uint64_t>>>
          &schemaImmediateRanges,
      const std::map<std::string, std::set<std::pair<unsigned, unsigned>>>
          &mmioObservedBitRanges,
      const std::map<std::string,
                     std::map<unsigned, std::set<std::pair<unsigned, unsigned>>>>
          &mmioObservedBitRangesBySelector) {
    const std::string name = sanitizeToken(typeName);
    auto isOneOf = [&](std::initializer_list<StringRef> names) {
      for (StringRef candidate : names) {
        if (name == sanitizeToken(candidate)) {
          return true;
        }
      }
      return false;
    };
    auto renderSingleFieldStruct =
        [](StringRef structName,
           std::initializer_list<std::string> fieldLines) -> std::string {
      std::ostringstream out;
      out << "struct " << structName.str() << " {\n";
      for (const std::string &fieldLine : fieldLines) {
        out << "    " << fieldLine << "\n";
      }
      out << "}\n";
      return out.str();
    };
    auto renderFieldOnlyStruct =
        [&](StringRef structName, const std::string &fieldLine) -> std::string {
      return renderSingleFieldStruct(structName, {fieldLine});
    };
    auto explicitIt = explicitSchemas.find(name);
    if (explicitIt != explicitSchemas.end() &&
        !explicitIt->second.fields.empty()) {
      std::ostringstream out;
      out << "struct " << name << " {\n";
      for (const auto &field : explicitIt->second.fields) {
        out << "    " << field.name << ": " << field.typeName << ";\n";
      }
      out << "}\n";
      return out.str();
    }
    auto renderVirtioMmioRegisterStruct =
        [&](const VirtioMmioRegisterInfo &info) -> std::string {
      std::ostringstream out;
      out << "struct " << info.schemaName << " {\n";
      auto immIt = schemaLengthImmediates.find(sanitizeToken(info.schemaName));
      auto bitIt = mmioObservedBitRanges.find(sanitizeToken(info.schemaName));
      auto bankIt = mmioObservedBitRangesBySelector.find(sanitizeToken(info.schemaName));
      auto bankItFor = [&](StringRef schemaKey) {
        return mmioObservedBitRangesBySelector.find(sanitizeToken(schemaKey));
      };
      const auto emitScalarField = [&](StringRef fieldName, StringRef typeName) {
        out << "    " << fieldName.str() << ": " << typeName.str() << ";\n";
      };
      const auto emitNamedImmediateField =
          [&](StringRef fieldName, StringRef typeName,
              std::initializer_list<uint64_t> defaults,
              std::initializer_list<std::pair<uint64_t, uint64_t>>
                  defaultRanges = {}) {
            std::set<uint64_t> values;
            std::set<std::pair<uint64_t, uint64_t>> ranges;
            if (immIt != schemaLengthImmediates.end()) {
              values.insert(immIt->second.begin(), immIt->second.end());
            }
            if (auto rangeIt = schemaImmediateRanges.find(sanitizeToken(info.schemaName));
                rangeIt != schemaImmediateRanges.end()) {
              ranges.insert(rangeIt->second.begin(), rangeIt->second.end());
            }
            values.insert(defaults.begin(), defaults.end());
            ranges.insert(defaultRanges.begin(), defaultRanges.end());
            if (values.empty() && ranges.empty()) {
              emitScalarField(fieldName, typeName);
              return;
            }
            out << "    " << fieldName.str() << ": " << typeName.str()
                << " immediate [\n";
            for (uint64_t value : values) {
              out << "        imm " << value << ";\n";
            }
            for (const auto &[lo, hi] : ranges) {
              out << "        range " << lo << ".." << hi << ";\n";
            }
            out << "    ];\n";
          };
      const auto emitImmediateField =
          [&](std::initializer_list<uint64_t> defaults,
              std::initializer_list<std::pair<uint64_t, uint64_t>>
                  defaultRanges = {}) {
            emitNamedImmediateField("value", "u32", defaults, defaultRanges);
          };
      const auto emitBitField =
          [&](std::initializer_list<std::pair<unsigned, unsigned>> defaults) {
            std::set<std::pair<unsigned, unsigned>> bits;
            if (bitIt != mmioObservedBitRanges.end()) {
              bits.insert(bitIt->second.begin(), bitIt->second.end());
            }
            bits.insert(defaults.begin(), defaults.end());
            if (bits.empty()) {
              return false;
            }
            out << "    value: u32 flag [\n";
            for (const auto &[lo, hi] : bits) {
              out << "        bits " << lo << ".." << hi << ";\n";
            }
            out << "    ];\n";
            return true;
          };
      const auto emitSelectorBitField =
          [&](unsigned selector,
              const std::set<std::pair<unsigned, unsigned>> &bits) {
            if (bits.empty()) {
              return false;
            }
            out << "    sel" << selector << ": u32 flag [\n";
            for (const auto &[lo, hi] : bits) {
              out << "        bits " << lo << ".." << hi << ";\n";
            }
            out << "    ];\n";
            return true;
          };
      const auto emitNamedBitField = [&](StringRef fieldName,
                                         unsigned bit) {
        out << "    " << fieldName.str() << ": u32 flag [\n";
        out << "        bits " << bit << ".." << bit << ";\n";
        out << "    ];\n";
      };
      const auto immContains = [&](uint64_t value) {
        return immIt != schemaLengthImmediates.end() &&
               immIt->second.find(value) != immIt->second.end();
      };
      const auto emitRawImmediateField = [&]() {
        if (immIt == schemaLengthImmediates.end() || immIt->second.empty()) {
          return;
        }
        out << "    raw: u32 immediate [\n";
        for (uint64_t value : immIt->second) {
          out << "        imm " << value << ";\n";
        }
        out << "    ];\n";
      };
      const auto emitTaggedSelectorBitFields =
          [&](StringRef tag, StringRef fieldPrefix) {
            auto taggedIt =
                bankItFor((StringRef(info.schemaName) + "__" + tag).str());
            if (taggedIt == mmioObservedBitRangesBySelector.end()) {
              return false;
            }
            bool emitted = false;
            for (const auto &[selector, bits] : taggedIt->second) {
              if (bits.empty()) {
                continue;
              }
              out << "    " << fieldPrefix.str() << selector << ": u32 flag [\n";
              for (const auto &[lo, hi] : bits) {
                out << "        bits " << lo << ".." << hi << ";\n";
              }
              out << "    ];\n";
              emitted = true;
            }
            return emitted;
          };
      const bool hasObservedBits =
          bitIt != mmioObservedBitRanges.end() && !bitIt->second.empty();
      const bool hasSelectorObservedBits =
          bankIt != mmioObservedBitRangesBySelector.end() &&
          !bankIt->second.empty();
      switch (info.valueKind) {
        case VirtioMmioRegisterInfo::ValueKind::Immediate:
          if (std::string(info.schemaName) == "virtio_mmio_magic_value") {
            emitNamedImmediateField("magic", "u32", {1953655158ULL});
          } else if (std::string(info.schemaName) == "virtio_mmio_version") {
            emitNamedImmediateField("version", "u32", {}, {{1ULL, 2ULL}});
          } else if (std::string(info.schemaName) ==
                         "virtio_mmio_device_features_sel" ||
                     std::string(info.schemaName) ==
                         "virtio_mmio_driver_features_sel") {
            emitNamedImmediateField("selector", "u32", {}, {{0ULL, 1ULL}});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_guest_page_size") {
            emitNamedImmediateField("page_size", "u32", {});
          } else if (std::string(info.schemaName) == "virtio_mmio_queue_sel") {
            auto rangeIt = schemaImmediateRanges.find(sanitizeToken(info.schemaName));
            std::vector<std::pair<uint64_t, uint64_t>> usableRanges;
            if (rangeIt != schemaImmediateRanges.end()) {
              for (const auto &entry : rangeIt->second) {
                if (entry.second >= 2) {
                  usableRanges.push_back(entry);
                }
              }
            }
            if (!usableRanges.empty()) {
              llvm::sort(usableRanges, [](const auto &lhs, const auto &rhs) {
                return lhs.first < rhs.first ||
                       (lhs.first == rhs.first && lhs.second < rhs.second);
              });
              std::vector<std::pair<uint64_t, uint64_t>> mergedRanges;
              for (const auto &entry : usableRanges) {
                if (mergedRanges.empty() ||
                    entry.first > mergedRanges.back().second + 1) {
                  mergedRanges.push_back(entry);
                  continue;
                }
                mergedRanges.back().second =
                    std::max(mergedRanges.back().second, entry.second);
              }
              usableRanges.swap(mergedRanges);
            }
            const bool hasRanges = !usableRanges.empty();
            if (hasRanges) {
              out << "    queue_index: u32 immediate [\n";
              for (const auto &[lo, hi] : usableRanges) {
                out << "        range " << lo << ".." << hi << ";\n";
              }
              out << "    ];\n";
            } else {
              emitScalarField("queue_index", "u32");
            }
          } else if (std::string(info.schemaName) == "virtio_mmio_queue_num") {
            emitNamedImmediateField("queue_size", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_align") {
            emitNamedImmediateField("alignment", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_notify") {
            emitScalarField("queue_index", "u16");
            out << "    next_avail_or_off_wrap: u16 flag [\n";
            out << "        bits 0..14;\n";
            out << "        bits 15..15;\n";
            out << "    ];\n";
            emitScalarField("split_next_avail_idx", "u16");
            out << "    packed_off_wrap: u16 flag [\n";
            out << "        bits 0..14;\n";
            out << "        bits 15..15;\n";
            out << "    ];\n";
            out << "    packed_event_idx: u16 flag [\n";
            out << "        bits 0..14;\n";
            out << "    ];\n";
            out << "    packed_wrap_counter: u16 flag [\n";
            out << "        bits 15..15;\n";
            out << "    ];\n";
            emitRawImmediateField();
          } else if (std::string(info.schemaName) == "virtio_mmio_shm_sel") {
            emitNamedImmediateField("region_id", "u32", {});
          } else {
            emitImmediateField({});
          }
          break;
        case VirtioMmioRegisterInfo::ValueKind::Flags:
          if (std::string(info.schemaName) == "virtio_mmio_interrupt_status" ||
              std::string(info.schemaName) == "virtio_mmio_interrupt_ack") {
            emitBitField({{0, 0}, {1, 1}});
            emitNamedBitField("vring", 0);
            emitNamedBitField("config", 1);
          } else if (std::string(info.schemaName) == "virtio_mmio_status") {
            emitBitField({{0, 0}, {1, 1}, {2, 2}, {3, 3}, {7, 7}});
            if (immContains(1)) {
              emitNamedBitField("acknowledge", 0);
            }
            if (immContains(2)) {
              emitNamedBitField("driver", 1);
            }
            if (immContains(4)) {
              emitNamedBitField("driver_ok", 2);
            }
            if (immContains(8)) {
              emitNamedBitField("features_ok", 3);
            }
            if (immContains(128)) {
              emitNamedBitField("failed", 7);
            }
          } else if (std::string(info.schemaName) == "virtio_mmio_queue_ready") {
            emitBitField({{0, 0}});
            emitNamedBitField("ready", 0);
          } else if (std::string(info.schemaName) == "virtio_mmio_device_features" ||
                     std::string(info.schemaName) == "virtio_mmio_driver_features") {
            if (hasSelectorObservedBits) {
              bool emittedBank = false;
              for (const auto &[selector, bits] : bankIt->second) {
                emittedBank = emitSelectorBitField(selector, bits) || emittedBank;
              }
              if (!emittedBank) {
                emitBitField({{0, 31}});
              }
              if (std::string(info.schemaName) == "virtio_mmio_device_features") {
                emitTaggedSelectorBitFields("validate", "validate_sel");
                emitTaggedSelectorBitFields("probe", "probe_sel");
                emitTaggedSelectorBitFields("vq", "vq_sel");
                emitTaggedSelectorBitFields("status", "status_sel");
              }
            } else if (hasObservedBits) {
              emitBitField({});
            } else {
              emitBitField({{0, 31}});
            }
          } else {
            emitBitField({{0, 31}});
          }
          break;
        case VirtioMmioRegisterInfo::ValueKind::Plain:
          if (std::string(info.schemaName) == "virtio_mmio_device_id") {
            emitNamedImmediateField("device_id", "u32", {});
          } else if (std::string(info.schemaName) == "virtio_mmio_vendor_id") {
            emitNamedImmediateField("vendor_id", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_num_max") {
            emitNamedImmediateField("queue_size_max", "u32", {});
          } else if (std::string(info.schemaName) == "virtio_mmio_queue_pfn") {
            emitNamedImmediateField("page_frame_number", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_desc_low") {
            emitNamedImmediateField("desc_addr_low", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_desc_high") {
            emitNamedImmediateField("desc_addr_high", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_avail_low") {
            emitNamedImmediateField("avail_addr_low", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_avail_high") {
            emitNamedImmediateField("avail_addr_high", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_used_low") {
            emitNamedImmediateField("used_addr_low", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_queue_used_high") {
            emitNamedImmediateField("used_addr_high", "u32", {});
          } else if (std::string(info.schemaName) == "virtio_mmio_shm_len_low") {
            emitNamedImmediateField("region_len_low", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_shm_len_high") {
            emitNamedImmediateField("region_len_high", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_shm_base_low") {
            emitNamedImmediateField("region_addr_low", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_shm_base_high") {
            emitNamedImmediateField("region_addr_high", "u32", {});
          } else if (std::string(info.schemaName) ==
                     "virtio_mmio_config_generation") {
            emitNamedImmediateField("generation", "u32", {});
          } else if (hasObservedBits && emitBitField({})) {
            emitRawImmediateField();
          } else if (immIt != schemaLengthImmediates.end() &&
                     !immIt->second.empty()) {
            emitImmediateField({});
          } else {
            out << "    value: u32;\n";
          }
          break;
      }
      out << "}\n";
      return out.str();
    };
    for (uint64_t offset : {0ULL,   4ULL,   8ULL,   12ULL,  16ULL,  20ULL,
                            32ULL,  36ULL,  40ULL,  48ULL,  52ULL,  56ULL,
                            60ULL,  64ULL,  68ULL,  80ULL,  96ULL,  100ULL,
                            112ULL, 128ULL, 132ULL, 144ULL, 148ULL, 160ULL,
                            164ULL, 172ULL, 176ULL, 180ULL, 184ULL, 188ULL,
                            252ULL}) {
      auto info = lookupVirtioMmioRegisterInfo(offset);
      if (info && name == sanitizeToken(info->schemaName)) {
        return renderVirtioMmioRegisterStruct(*info);
      }
    }
    auto renderDescriptorStruct = [&](StringRef structName) -> std::string {
      std::ostringstream out;
      const bool packed = structName.startswith("vring_packed_desc");
      out << "struct " << structName.str() << " {\n";
      out << "    addr: u64;\n";
      auto lenIt = schemaLengthImmediates.find(sanitizeToken(structName));
      if (lenIt != schemaLengthImmediates.end() && !lenIt->second.empty()) {
        out << "    len: u32 immediate [\n";
        for (uint64_t value : lenIt->second) {
          out << "        imm " << value << ";\n";
        }
        out << "    ];\n";
      } else {
        out << "    len: u32;\n";
      }
      out << "    flags: u16;\n";
      if (packed) {
        out << "    id: u16;\n";
      } else {
        out << "    next: u16;\n";
      }
      out << "}\n";
      return out.str();
    };
    auto renderTwoSlotChain = [&](StringRef structName,
                                  StringRef hdrSource,
                                  StringRef frameSource) -> std::string {
      std::ostringstream out;
      out << "struct " << structName.str() << " {\n";
      out << "    addr0: ptr<u64> align 0;\n";
      out << "    len0: u32 immediate [\n";
      auto hdrIt = schemaLengthImmediates.find(sanitizeToken(hdrSource));
      if (hdrIt != schemaLengthImmediates.end()) {
        for (uint64_t value : hdrIt->second) {
          out << "        imm " << value << ";\n";
        }
      }
      out << "    ];\n";
      out << "    addr1: ptr<u64> align 0;\n";
      out << "    len1: u32 immediate [\n";
      auto frameIt = schemaLengthImmediates.find(sanitizeToken(frameSource));
      if (frameIt != schemaLengthImmediates.end()) {
        for (uint64_t value : frameIt->second) {
          out << "        imm " << value << ";\n";
        }
      }
      out << "    ];\n";
      out << "}\n";
      return out.str();
    };
    auto renderVring = [&](StringRef structName, bool ctrlStyle) -> std::string {
      std::ostringstream out;
      std::vector<uint64_t> lengthValues;
      auto lenIt = schemaLengthImmediates.find(sanitizeToken(structName));
      if (lenIt != schemaLengthImmediates.end()) {
        lengthValues.assign(lenIt->second.begin(), lenIt->second.end());
      }
      if (lengthValues.empty()) {
        lengthValues.push_back(256);
      }
      out << "struct " << structName.str() << " {\n";
      for (int i = 0; i < 8; ++i) {
        out << "    addr" << i << ": ptr<u64> align 0;\n";
        out << "    len" << i << ": u32 immediate [\n";
        for (uint64_t value : lengthValues) {
          out << "        imm " << value << ";\n";
        }
        out << "    ];\n";
        out << "    flags" << i << ": u16 flag";
        if (ctrlStyle) {
          out << " [\n"
              << "        bits 0..0;\n"
              << "        bits 1..1;\n"
              << "        bits 2..2;\n"
              << "        bits 3..3;\n"
              << "        bits 4..6;\n"
              << "        bits 7..15;\n"
              << "    ];\n";
        } else {
          out << " [\n"
              << "        bits 0..0;\n"
              << "        bits 1..1;\n"
              << "        bits 2..2;\n"
              << "        bits 3..3;\n"
              << "        bits 4..15;\n"
              << "    ];\n";
        }
        out << "    next" << i << ": u16 flag [\n";
        out << "        bits 0..7;\n";
        out << "        bits 8..15 = 0;\n";
        out << "    ];\n";
      }
      out << "}\n";
      return out.str();
    };
    if (name == "VIRTIO_NET_TX_CHAIN_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_2", "vring_desc_tx_hdr",
                                "vring_desc_tx_frame");
    }
    if (name == "VIRTIO_NET_TX_CHAIN_XDP_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_XDP_2",
                                "vring_desc_tx_hdr",
                                "vring_desc_tx_frame_xdp");
    }
    if (name == "VIRTIO_NET_TX_CHAIN_SKB_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_SKB_2",
                                "vring_desc_tx_hdr",
                                "vring_desc_tx_frame_skb");
    }
    if (name == "VIRTIO_NET_TX_CHAIN_HDR12_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_HDR12_2",
                                "vring_desc_tx_hdr_plain",
                                "vring_desc_tx_frame");
    }
    if (name == "VIRTIO_NET_TX_CHAIN_HDR24_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_HDR24_2",
                                "vring_desc_tx_hdr_hash_tunnel",
                                "vring_desc_tx_frame");
    }
    if (name == "VIRTIO_NET_TX_CHAIN_XDP_HDR12_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_XDP_HDR12_2",
                                "vring_desc_tx_hdr_plain",
                                "vring_desc_tx_frame_xdp");
    }
    if (name == "VIRTIO_NET_TX_CHAIN_XDP_HDR24_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_XDP_HDR24_2",
                                "vring_desc_tx_hdr_hash_tunnel",
                                "vring_desc_tx_frame_xdp");
    }
    if (name == "VIRTIO_NET_TX_CHAIN_SKB_HDR12_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_SKB_HDR12_2",
                                "vring_desc_tx_hdr_plain",
                                "vring_desc_tx_frame_skb");
    }
    if (name == "VIRTIO_NET_TX_CHAIN_SKB_HDR24_2") {
      return renderTwoSlotChain("VIRTIO_NET_TX_CHAIN_SKB_HDR24_2",
                                "vring_desc_tx_hdr_hash_tunnel",
                                "vring_desc_tx_frame_skb");
    }
    if (name == "VIRTIO_NET_RX_CHAIN_2") {
      return renderTwoSlotChain("VIRTIO_NET_RX_CHAIN_2", "vring_desc_rx_hdr",
                                "vring_desc_rx_frame");
    }
    if (name == "VIRTIO_NET_RX_CHAIN_LARGE_2") {
      return renderTwoSlotChain("VIRTIO_NET_RX_CHAIN_LARGE_2",
                                "vring_desc_rx_hdr",
                                "vring_desc_rx_frame_large");
    }
    if (name == "VIRTIO_NET_RX_CHAIN_SMALL_2") {
      return renderTwoSlotChain("VIRTIO_NET_RX_CHAIN_SMALL_2",
                                "vring_desc_rx_hdr",
                                "vring_desc_rx_frame_small");
    }
    if (isOneOf({"vring_desc", "vring_desc_tx", "vring_desc_rx",
                 "vring_desc_ctrl_cmd", "vring_desc_ctrl_stats",
                 "vring_desc_tx_hdr", "vring_desc_tx_frame",
                 "vring_desc_tx_hdr_plain",
                 "vring_desc_tx_hdr_hash_tunnel",
                 "vring_desc_tx_frame_xdp", "vring_desc_tx_frame_skb",
                 "vring_desc_rx_hdr", "vring_desc_rx_frame",
                 "vring_desc_rx_frame_large",
                 "vring_desc_rx_frame_small"})) {
      return renderDescriptorStruct(name);
    }
    if (isOneOf({"vring_desc_addr_only", "vring_desc_tx_addr_only",
                 "vring_desc_rx_addr_only", "vring_desc_ctrl_cmd_addr_only",
                 "vring_desc_ctrl_stats_addr_only", "vring_desc_tx_hdr_addr_only",
                 "vring_desc_tx_hdr_plain_addr_only",
                 "vring_desc_tx_hdr_hash_tunnel_addr_only",
                 "vring_desc_tx_frame_addr_only",
                 "vring_desc_tx_frame_xdp_addr_only",
                 "vring_desc_tx_frame_skb_addr_only",
                 "vring_desc_rx_hdr_addr_only",
                 "vring_desc_rx_frame_addr_only",
                 "vring_desc_rx_frame_large_addr_only",
                 "vring_desc_rx_frame_small_addr_only"})) {
      return renderSingleFieldStruct(name,
                                     {"addr: ptr<u64> align 0;"});
    }
    if (isOneOf({"vring_desc_len_only", "vring_desc_tx_len_only",
                 "vring_desc_rx_len_only", "vring_desc_ctrl_cmd_len_only",
                 "vring_desc_ctrl_stats_len_only", "vring_desc_tx_hdr_len_only",
                 "vring_desc_tx_hdr_plain_len_only",
                 "vring_desc_tx_hdr_hash_tunnel_len_only",
                 "vring_desc_tx_frame_len_only",
                 "vring_desc_tx_frame_xdp_len_only",
                 "vring_desc_tx_frame_skb_len_only",
                 "vring_desc_rx_hdr_len_only",
                 "vring_desc_rx_frame_len_only",
                 "vring_desc_rx_frame_large_len_only",
                 "vring_desc_rx_frame_small_len_only"})) {
      return renderSingleFieldStruct(name, {"len: u32;"});
    }
    if (isOneOf({"vring_desc_flags_only", "vring_desc_tx_flags_only",
                 "vring_desc_rx_flags_only", "vring_desc_ctrl_cmd_flags_only",
                 "vring_desc_ctrl_stats_flags_only",
                 "vring_desc_tx_hdr_flags_only",
                 "vring_desc_tx_hdr_plain_flags_only",
                 "vring_desc_tx_hdr_hash_tunnel_flags_only",
                 "vring_desc_tx_frame_flags_only",
                 "vring_desc_tx_frame_xdp_flags_only",
                 "vring_desc_tx_frame_skb_flags_only",
                 "vring_desc_rx_hdr_flags_only",
                 "vring_desc_rx_frame_flags_only",
                 "vring_desc_rx_frame_large_flags_only",
                 "vring_desc_rx_frame_small_flags_only"})) {
      return renderSingleFieldStruct(name, {"flags: u16;"});
    }
    if (isOneOf({"vring_desc_next_only", "vring_desc_tx_next_only",
                 "vring_desc_rx_next_only", "vring_desc_ctrl_cmd_next_only",
                 "vring_desc_ctrl_stats_next_only", "vring_desc_tx_hdr_next_only",
                 "vring_desc_tx_hdr_plain_next_only",
                 "vring_desc_tx_hdr_hash_tunnel_next_only",
                 "vring_desc_tx_frame_next_only",
                 "vring_desc_tx_frame_xdp_next_only",
                 "vring_desc_tx_frame_skb_next_only",
                 "vring_desc_rx_hdr_next_only",
                 "vring_desc_rx_frame_next_only",
                 "vring_desc_rx_frame_large_next_only",
                 "vring_desc_rx_frame_small_next_only"})) {
      return renderSingleFieldStruct(name, {"next: u16;"});
    }
    if (isOneOf({"vring_desc_extra", "vring_desc_extra_tx", "vring_desc_extra_rx",
                 "vring_desc_extra_ctrl_cmd", "vring_desc_extra_ctrl_stats",
                 "vring_desc_extra_tx_hdr", "vring_desc_extra_tx_hdr_plain",
                 "vring_desc_extra_tx_hdr_hash_tunnel", "vring_desc_extra_tx_frame",
                 "vring_desc_extra_rx_hdr", "vring_desc_extra_rx_frame"})) {
      return renderDescriptorStruct(name);
    }
    if (isOneOf({"vring_desc_extra_addr_only", "vring_desc_extra_tx_addr_only",
                 "vring_desc_extra_rx_addr_only",
                 "vring_desc_extra_ctrl_cmd_addr_only",
                 "vring_desc_extra_ctrl_stats_addr_only",
                 "vring_desc_extra_tx_hdr_addr_only",
                 "vring_desc_extra_tx_hdr_plain_addr_only",
                 "vring_desc_extra_tx_hdr_hash_tunnel_addr_only",
                 "vring_desc_extra_tx_frame_addr_only",
                 "vring_desc_extra_rx_hdr_addr_only",
                 "vring_desc_extra_rx_frame_addr_only"})) {
      return renderSingleFieldStruct(name,
                                     {"addr: ptr<u64> align 0;"});
    }
    if (isOneOf({"vring_desc_extra_len_only", "vring_desc_extra_tx_len_only",
                 "vring_desc_extra_rx_len_only",
                 "vring_desc_extra_ctrl_cmd_len_only",
                 "vring_desc_extra_ctrl_stats_len_only",
                 "vring_desc_extra_tx_hdr_len_only",
                 "vring_desc_extra_tx_hdr_plain_len_only",
                 "vring_desc_extra_tx_hdr_hash_tunnel_len_only",
                 "vring_desc_extra_tx_frame_len_only",
                 "vring_desc_extra_rx_hdr_len_only",
                 "vring_desc_extra_rx_frame_len_only"})) {
      return renderSingleFieldStruct(name, {"len: u32;"});
    }
    if (isOneOf({"vring_desc_extra_flags_only",
                 "vring_desc_extra_tx_flags_only",
                 "vring_desc_extra_rx_flags_only",
                 "vring_desc_extra_ctrl_cmd_flags_only",
                 "vring_desc_extra_ctrl_stats_flags_only",
                 "vring_desc_extra_tx_hdr_flags_only",
                 "vring_desc_extra_tx_hdr_plain_flags_only",
                 "vring_desc_extra_tx_hdr_hash_tunnel_flags_only",
                 "vring_desc_extra_tx_frame_flags_only",
                 "vring_desc_extra_rx_hdr_flags_only",
                 "vring_desc_extra_rx_frame_flags_only"})) {
      return renderSingleFieldStruct(name,
                                     {"flags: u16;"});
    }
    if (isOneOf({"vring_desc_extra_next_only", "vring_desc_extra_tx_next_only",
                 "vring_desc_extra_rx_next_only",
                 "vring_desc_extra_ctrl_cmd_next_only",
                 "vring_desc_extra_ctrl_stats_next_only",
                 "vring_desc_extra_tx_hdr_next_only",
                 "vring_desc_extra_tx_hdr_plain_next_only",
                 "vring_desc_extra_tx_hdr_hash_tunnel_next_only",
                 "vring_desc_extra_tx_frame_next_only",
                 "vring_desc_extra_rx_hdr_next_only",
                 "vring_desc_extra_rx_frame_next_only"})) {
      return renderSingleFieldStruct(name,
                                     {"next: u16;"});
    }
    if (isOneOf({"vring_packed_desc", "vring_packed_desc_tx",
                 "vring_packed_desc_rx", "vring_packed_desc_ctrl_cmd",
                 "vring_packed_desc_ctrl_stats", "vring_packed_desc_tx_hdr",
                 "vring_packed_desc_tx_hdr_plain",
                 "vring_packed_desc_tx_hdr_hash_tunnel",
                 "vring_packed_desc_tx_frame", "vring_packed_desc_rx_hdr",
                 "vring_packed_desc_rx_frame"})) {
      return renderDescriptorStruct(name);
    }
    if (isOneOf({"vring_packed_desc_addr_only",
                 "vring_packed_desc_tx_addr_only",
                 "vring_packed_desc_rx_addr_only",
                 "vring_packed_desc_ctrl_cmd_addr_only",
                 "vring_packed_desc_ctrl_stats_addr_only",
                 "vring_packed_desc_tx_hdr_addr_only",
                 "vring_packed_desc_tx_hdr_plain_addr_only",
                 "vring_packed_desc_tx_hdr_hash_tunnel_addr_only",
                 "vring_packed_desc_tx_frame_addr_only",
                 "vring_packed_desc_rx_hdr_addr_only",
                 "vring_packed_desc_rx_frame_addr_only"})) {
      return renderSingleFieldStruct(name,
                                     {"addr: ptr<u64> align 0;"});
    }
    if (isOneOf({"vring_packed_desc_len_only", "vring_packed_desc_tx_len_only",
                 "vring_packed_desc_rx_len_only",
                 "vring_packed_desc_ctrl_cmd_len_only",
                 "vring_packed_desc_ctrl_stats_len_only",
                 "vring_packed_desc_tx_hdr_len_only",
                 "vring_packed_desc_tx_hdr_plain_len_only",
                 "vring_packed_desc_tx_hdr_hash_tunnel_len_only",
                 "vring_packed_desc_tx_frame_len_only",
                 "vring_packed_desc_rx_hdr_len_only",
                 "vring_packed_desc_rx_frame_len_only"})) {
      return renderSingleFieldStruct(name,
                                     {"len: u32;"});
    }
    if (isOneOf({"vring_packed_desc_flags_only",
                 "vring_packed_desc_tx_flags_only",
                 "vring_packed_desc_rx_flags_only",
                 "vring_packed_desc_ctrl_cmd_flags_only",
                 "vring_packed_desc_ctrl_stats_flags_only",
                 "vring_packed_desc_tx_hdr_flags_only",
                 "vring_packed_desc_tx_hdr_plain_flags_only",
                 "vring_packed_desc_tx_hdr_hash_tunnel_flags_only",
                 "vring_packed_desc_tx_frame_flags_only",
                 "vring_packed_desc_rx_hdr_flags_only",
                 "vring_packed_desc_rx_frame_flags_only"})) {
      return renderSingleFieldStruct(name,
                                     {"flags: u16;"});
    }
    if (isOneOf({"vring_packed_desc_next_only", "vring_packed_desc_tx_next_only",
                 "vring_packed_desc_rx_next_only",
                 "vring_packed_desc_ctrl_cmd_next_only",
                 "vring_packed_desc_ctrl_stats_next_only",
                 "vring_packed_desc_tx_hdr_next_only",
                 "vring_packed_desc_tx_hdr_plain_next_only",
                 "vring_packed_desc_tx_hdr_hash_tunnel_next_only",
                 "vring_packed_desc_tx_frame_next_only",
                 "vring_packed_desc_rx_hdr_next_only",
                 "vring_packed_desc_rx_frame_next_only"})) {
      return renderSingleFieldStruct(name,
                                     {"next: u16;"});
    }
    if (name == "virtio_net_hdr") {
      return std::string(
          "struct virtio_net_hdr {\n"
          "    flags: u8 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 4..7 = 0;\n"
          "    ];\n"
          "    gso_type: u8 flag [\n"
          "        bits 0..2;\n"
          "        bits 3..4 = 0;\n"
          "        bits 5..5;\n"
          "        bits 6..6;\n"
          "        bits 7..7;\n"
          "    ];\n"
          "    hdr_len: u16;\n"
          "    gso_size: u16;\n"
          "    csum_start: u16;\n"
          "    csum_offset: u16;\n"
          "    num_buffers: u16;\n"
          "}\n");
    }
    if (name == "virtio_net_hdr_flags_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_flags_only",
                                   "flags: u8 flag [\n"
                                   "        bits 0..0;\n"
                                   "        bits 1..1;\n"
                                   "        bits 2..2;\n"
                                   "        bits 3..3;\n"
                                   "        bits 4..7 = 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_hdr_gso_type_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_gso_type_only",
                                   "gso_type: u8 flag [\n"
                                   "        bits 0..2;\n"
                                   "        bits 3..4 = 0;\n"
                                   "        bits 5..5;\n"
                                   "        bits 6..6;\n"
                                   "        bits 7..7;\n"
                                   "    ];");
    }
    if (name == "virtio_net_hdr_hdr_len_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_hdr_len_only",
                                   "hdr_len: u16;");
    }
    if (name == "virtio_net_hdr_gso_size_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_gso_size_only",
                                   "gso_size: u16;");
    }
    if (name == "virtio_net_hdr_csum_start_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_csum_start_only",
                                   "csum_start: u16;");
    }
    if (name == "virtio_net_hdr_csum_offset_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_csum_offset_only",
                                   "csum_offset: u16;");
    }
    if (name == "virtio_net_hdr_num_buffers_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_num_buffers_only",
                                   "num_buffers: u16;");
    }
    if (name == "virtio_net_hdr_mrg_rxbuf") {
      return std::string(
          "struct virtio_net_hdr_mrg_rxbuf {\n"
          "    flags: u8 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 4..7 = 0;\n"
          "    ];\n"
          "    gso_type: u8 flag [\n"
          "        bits 0..2;\n"
          "        bits 3..4 = 0;\n"
          "        bits 5..5;\n"
          "        bits 6..6;\n"
          "        bits 7..7;\n"
          "    ];\n"
          "    hdr_len: u16;\n"
          "    gso_size: u16;\n"
          "    csum_start: u16;\n"
          "    csum_offset: u16;\n"
          "    num_buffers: u16;\n"
          "}\n");
    }
    if (name == "virtio_net_hdr_mrg_rxbuf_flags_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_mrg_rxbuf_flags_only",
                                   "flags: u8 flag [\n"
                                   "        bits 0..0;\n"
                                   "        bits 1..1;\n"
                                   "        bits 2..2;\n"
                                   "        bits 3..3;\n"
                                   "        bits 4..7 = 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_hdr_mrg_rxbuf_gso_type_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_mrg_rxbuf_gso_type_only",
                                   "gso_type: u8 flag [\n"
                                   "        bits 0..2;\n"
                                   "        bits 3..4 = 0;\n"
                                   "        bits 5..5;\n"
                                   "        bits 6..6;\n"
                                   "        bits 7..7;\n"
                                   "    ];");
    }
    if (name == "virtio_net_hdr_mrg_rxbuf_hdr_len_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_mrg_rxbuf_hdr_len_only",
                                   "hdr_len: u16;");
    }
    if (name == "virtio_net_hdr_mrg_rxbuf_gso_size_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_mrg_rxbuf_gso_size_only",
                                   "gso_size: u16;");
    }
    if (name == "virtio_net_hdr_mrg_rxbuf_csum_start_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_mrg_rxbuf_csum_start_only", "csum_start: u16;");
    }
    if (name == "virtio_net_hdr_mrg_rxbuf_csum_offset_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_mrg_rxbuf_csum_offset_only", "csum_offset: u16;");
    }
    if (name == "virtio_net_hdr_mrg_rxbuf_num_buffers_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_mrg_rxbuf_num_buffers_only", "num_buffers: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel") {
      return std::string(
          "struct virtio_net_hdr_v1_hash_tunnel {\n"
          "    flags: u8 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 4..7 = 0;\n"
          "    ];\n"
          "    gso_type: u8 flag [\n"
          "        bits 0..2;\n"
          "        bits 3..4 = 0;\n"
          "        bits 5..5;\n"
          "        bits 6..6;\n"
          "        bits 7..7;\n"
          "    ];\n"
          "    hdr_len: u16;\n"
          "    gso_size: u16;\n"
          "    csum_start: u16;\n"
          "    csum_offset: u16;\n"
          "    num_buffers: u16;\n"
          "    hash_value_lo: u16;\n"
          "    hash_value_hi: u16;\n"
          "    hash_report: u16 immediate [\n"
          "        imm 0;\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "        imm 3;\n"
          "        imm 4;\n"
          "        imm 5;\n"
          "        imm 6;\n"
          "        imm 7;\n"
          "        imm 8;\n"
          "        imm 9;\n"
          "    ];\n"
          "    padding: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    outer_th_offset: u16;\n"
          "    inner_nh_offset: u16;\n"
          "}\n");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_flags_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_flags_only",
          "flags: u8 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 4..7 = 0;\n"
          "    ];");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_gso_type_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_gso_type_only",
          "gso_type: u8 flag [\n"
          "        bits 0..2;\n"
          "        bits 3..4 = 0;\n"
          "        bits 5..5;\n"
          "        bits 6..6;\n"
          "        bits 7..7;\n"
          "    ];");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_hdr_len_only") {
      return renderFieldOnlyStruct("virtio_net_hdr_v1_hash_tunnel_hdr_len_only",
                                   "hdr_len: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_gso_size_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_gso_size_only", "gso_size: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_csum_start_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_csum_start_only", "csum_start: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_csum_offset_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_csum_offset_only",
          "csum_offset: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_num_buffers_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_num_buffers_only",
          "num_buffers: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_hash_value_lo_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_hash_value_lo_only",
          "hash_value_lo: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_hash_value_hi_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_hash_value_hi_only",
          "hash_value_hi: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_hash_report_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_hash_report_only",
          "hash_report: u16 immediate [\n"
          "        imm 0;\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "        imm 3;\n"
          "        imm 4;\n"
          "        imm 5;\n"
          "        imm 6;\n"
          "        imm 7;\n"
          "        imm 8;\n"
          "        imm 9;\n"
          "    ];");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_padding_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_padding_only",
          "padding: u16 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_outer_th_offset_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_outer_th_offset_only",
          "outer_th_offset: u16;");
    }
    if (name == "virtio_net_hdr_v1_hash_tunnel_inner_nh_offset_only") {
      return renderFieldOnlyStruct(
          "virtio_net_hdr_v1_hash_tunnel_inner_nh_offset_only",
          "inner_nh_offset: u16;");
    }
    if (name == "virtio_net_rss_config_hdr") {
      return std::string(
          "struct virtio_net_rss_config_hdr {\n"
          "    hash_types: u32 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 4..4;\n"
          "        bits 5..5;\n"
          "        bits 6..6;\n"
          "        bits 7..7;\n"
          "        bits 8..8;\n"
          "    ];\n"
          "    indirection_table_mask: u16 immediate [\n"
          "        imm 3;\n"
          "    ];\n"
          "    unclassified_queue: u16 random;\n"
          "    indirection_table: bytes[6] random;\n"
          "}\n");
    }
    if (name == "virtio_net_rss_config_hdr_hash_types_only") {
      return renderFieldOnlyStruct("virtio_net_rss_config_hdr_hash_types_only",
                                   "hash_types: u32 flag [\n"
                                   "        bits 0..0;\n"
                                   "        bits 1..1;\n"
                                   "        bits 2..2;\n"
                                   "        bits 3..3;\n"
                                   "        bits 4..4;\n"
                                   "        bits 5..5;\n"
                                   "        bits 6..6;\n"
                                   "        bits 7..7;\n"
                                   "        bits 8..8;\n"
                                   "    ];");
    }
    if (name == "virtio_net_rss_config_hdr_indirection_table_mask_only") {
      return renderFieldOnlyStruct(
          "virtio_net_rss_config_hdr_indirection_table_mask_only",
          "indirection_table_mask: u16 immediate [\n"
          "        imm 3;\n"
          "    ];");
    }
    if (name == "virtio_net_rss_config_hdr_unclassified_queue_only") {
      return renderFieldOnlyStruct(
          "virtio_net_rss_config_hdr_unclassified_queue_only",
          "unclassified_queue: u16 random;");
    }
    if (name == "virtio_net_rss_config_hdr_indirection_table_only") {
      return renderFieldOnlyStruct(
          "virtio_net_rss_config_hdr_indirection_table_only",
          "indirection_table: bytes[6] random;");
    }
    if (name == "virtio_net_rss_config_trailer") {
      return std::string(
          "struct virtio_net_rss_config_trailer {\n"
          "    max_tx_vq: u16 random;\n"
          "    hash_key_length: u8 immediate [\n"
          "        imm 32;\n"
          "    ];\n"
          "    hash_key_data: bytes[32] random;\n"
          "}\n");
    }
    if (name == "virtio_net_rss_config_trailer_max_tx_vq_only") {
      return renderFieldOnlyStruct("virtio_net_rss_config_trailer_max_tx_vq_only",
                                   "max_tx_vq: u16 random;");
    }
    if (name == "virtio_net_rss_config_trailer_hash_key_length_only") {
      return renderFieldOnlyStruct(
          "virtio_net_rss_config_trailer_hash_key_length_only",
          "hash_key_length: u8 immediate [\n"
          "        imm 32;\n"
          "    ];");
    }
    if (name == "virtio_net_rss_config_trailer_hash_key_data_only") {
      return renderFieldOnlyStruct(
          "virtio_net_rss_config_trailer_hash_key_data_only",
          "hash_key_data: bytes[32] random;");
    }
    if (name == "virtnet_rq_dma") {
      return std::string(
          "struct virtnet_rq_dma {\n"
          "    addr: u64;\n"
          "    ref: u32;\n"
          "    len: u16;\n"
          "    need_sync: u16;\n"
          "}\n");
    }
    if (name == "virtnet_rq_dma_addr_only") {
      return renderSingleFieldStruct("virtnet_rq_dma_addr_only",
                                     {"addr: ptr<u64> align 0;"});
    }
    if (name == "virtnet_rq_dma_ref_only") {
      return renderSingleFieldStruct("virtnet_rq_dma_ref_only", {"ref: u32;"});
    }
    if (name == "virtnet_rq_dma_len_only") {
      return renderSingleFieldStruct("virtnet_rq_dma_len_only", {"len: u16;"});
    }
    if (name == "virtnet_rq_dma_need_sync_only") {
      return renderSingleFieldStruct("virtnet_rq_dma_need_sync_only",
                                     {"need_sync: u16;"});
    }
    if (name == "virtio_net_guest_offloads") {
      return std::string(
          "struct virtio_net_guest_offloads {\n"
          "    value: u64 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 7..7;\n"
          "        bits 8..8;\n"
          "        bits 9..9;\n"
          "        bits 10..10;\n"
          "        bits 46..46;\n"
          "        bits 47..47;\n"
          "        bits 54..54;\n"
          "        bits 55..55;\n"
          "        bits 59..59;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_guest_offloads_value_only") {
      return renderFieldOnlyStruct(
          "virtio_net_guest_offloads_value_only",
          "value: u64 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 7..7;\n"
          "        bits 8..8;\n"
          "        bits 9..9;\n"
          "        bits 10..10;\n"
          "        bits 46..46;\n"
          "        bits 47..47;\n"
          "        bits 54..54;\n"
          "        bits 55..55;\n"
          "        bits 59..59;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_mac_addr") {
      return std::string(
          "struct virtio_net_ctrl_mac_addr {\n"
          "    mac: bytes[6];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_mac_addr_mac_only") {
      return renderFieldOnlyStruct("virtio_net_ctrl_mac_addr_mac_only",
                                   "mac: bytes[6];");
    }
    if (name == "virtio_net_ctrl_hdr") {
      return std::string(
          "struct virtio_net_ctrl_hdr {\n"
          "    class: u8;\n"
          "    cmd: u8;\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_mac") {
      return std::string(
          "struct virtio_net_ctrl_hdr_mac {\n"
          "    class: u8 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_mac_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_mac_class_only",
          "class: u8 immediate [\n"
          "        imm 1;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_mac_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_mac_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 1;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_vlan_add") {
      return std::string(
          "struct virtio_net_ctrl_hdr_vlan_add {\n"
          "    class: u8 immediate [\n"
          "        imm 2;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_vlan_add_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_vlan_add_class_only",
          "class: u8 immediate [\n"
          "        imm 2;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_vlan_add_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_vlan_add_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_vlan_del") {
      return std::string(
          "struct virtio_net_ctrl_hdr_vlan_del {\n"
          "    class: u8 immediate [\n"
          "        imm 2;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_vlan_del_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_vlan_del_class_only",
          "class: u8 immediate [\n"
          "        imm 2;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_vlan_del_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_vlan_del_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 1;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_mq") {
      return std::string(
          "struct virtio_net_ctrl_hdr_mq {\n"
          "    class: u8 immediate [\n"
          "        imm 4;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_mq_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_mq_class_only",
          "class: u8 immediate [\n"
          "        imm 4;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_mq_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_mq_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_guest_offloads") {
      return std::string(
          "struct virtio_net_ctrl_hdr_guest_offloads {\n"
          "    class: u8 immediate [\n"
          "        imm 5;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_guest_offloads_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_guest_offloads_class_only",
          "class: u8 immediate [\n"
          "        imm 5;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_guest_offloads_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_guest_offloads_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_coal_tx") {
      return std::string(
          "struct virtio_net_ctrl_hdr_coal_tx {\n"
          "    class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_coal_tx_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_coal_tx_class_only",
          "class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_coal_tx_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_coal_tx_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_coal_rx") {
      return std::string(
          "struct virtio_net_ctrl_hdr_coal_rx {\n"
          "    class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_coal_rx_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_coal_rx_class_only",
          "class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_coal_rx_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_coal_rx_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 1;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_coal_vq") {
      return std::string(
          "struct virtio_net_ctrl_hdr_coal_vq {\n"
          "    class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 2;\n"
          "        imm 3;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_coal_vq_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_coal_vq_class_only",
          "class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_coal_vq_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_coal_vq_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 2;\n"
          "        imm 3;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_queue_stats") {
      return std::string(
          "struct virtio_net_ctrl_hdr_queue_stats {\n"
          "    class: u8 immediate [\n"
          "        imm 8;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "        imm 1;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_hdr_queue_stats_class_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_queue_stats_class_only",
          "class: u8 immediate [\n"
          "        imm 8;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_hdr_queue_stats_cmd_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_hdr_queue_stats_cmd_only",
          "cmd: u8 immediate [\n"
          "        imm 0;\n"
          "        imm 1;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_status") {
      return std::string(
          "struct virtio_net_ctrl_status {\n"
          "    value: u8;\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_status_value_only") {
      return renderFieldOnlyStruct("virtio_net_ctrl_status_value_only",
                                   "value: u8;");
    }
    if (name == "virtio_net_stats_capabilities") {
      return std::string(
          "struct virtio_net_stats_capabilities {\n"
          "    supported_stats_types: u64 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 16..16;\n"
          "        bits 17..17;\n"
          "        bits 18..18;\n"
          "        bits 19..19;\n"
          "        bits 32..32;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_stats_capabilities_supported_stats_types_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_capabilities_supported_stats_types_only",
          "supported_stats_types: u64 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 16..16;\n"
          "        bits 17..17;\n"
          "        bits 18..18;\n"
          "        bits 19..19;\n"
          "        bits 32..32;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_reply_hdr") {
      return std::string(
          "struct virtio_net_stats_reply_hdr {\n"
          "    type: u8 immediate [\n"
          "        imm 0;\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "        imm 3;\n"
          "        imm 16;\n"
          "        imm 17;\n"
          "        imm 18;\n"
          "        imm 19;\n"
          "        imm 32;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 24;\n"
          "        imm 40;\n"
          "        imm 56;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_stats_reply_hdr_type_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_reply_hdr_type_only",
          "type: u8 immediate [\n"
          "        imm 0;\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "        imm 3;\n"
          "        imm 16;\n"
          "        imm 17;\n"
          "        imm 18;\n"
          "        imm 19;\n"
          "        imm 32;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_reply_hdr_reserved_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_reply_hdr_reserved_only",
          "reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_reply_hdr_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_reply_hdr_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_reply_hdr_reserved1_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_reply_hdr_reserved1_only",
          "reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_reply_hdr_size_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_reply_hdr_size_only",
          "size: u16 immediate [\n"
          "        imm 24;\n"
          "        imm 40;\n"
          "        imm 56;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_cvq") {
      return std::string(
          "struct virtio_net_stats_cvq {\n"
          "    type: u8 immediate [\n"
          "        imm 32;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 24;\n"
          "    ];\n"
          "    command_num: u64;\n"
          "    ok_num: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_cvq_type_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_cvq_type_only",
          "type: u8 immediate [\n"
          "        imm 32;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_cvq_reserved_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_cvq_reserved_only",
          "reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_cvq_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_cvq_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_cvq_reserved1_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_cvq_reserved1_only",
          "reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_cvq_size_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_cvq_size_only",
          "size: u16 immediate [\n"
          "        imm 24;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_cvq_command_num_only") {
      return renderFieldOnlyStruct("virtio_net_stats_cvq_command_num_only",
                                   "command_num: u64;");
    }
    if (name == "virtio_net_stats_cvq_ok_num_only") {
      return renderFieldOnlyStruct("virtio_net_stats_cvq_ok_num_only",
                                   "ok_num: u64;");
    }
    if (name == "virtio_net_stats_rx_basic") {
      return std::string(
          "struct virtio_net_stats_rx_basic {\n"
          "    type: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 56;\n"
          "    ];\n"
          "    rx_notifications: u64;\n"
          "    rx_packets: u64;\n"
          "    rx_bytes: u64;\n"
          "    rx_interrupts: u64;\n"
          "    rx_drops: u64;\n"
          "    rx_drop_overruns: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_rx_basic_type_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_basic_type_only",
          "type: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_rx_basic_reserved_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_basic_reserved_only",
          "reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_rx_basic_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_basic_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_rx_basic_reserved1_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_basic_reserved1_only",
          "reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_rx_basic_size_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_basic_size_only",
          "size: u16 immediate [\n"
          "        imm 56;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_rx_basic_rx_notifications_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_basic_rx_notifications_only",
          "rx_notifications: u64;");
    }
    if (name == "virtio_net_stats_rx_basic_rx_packets_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_basic_rx_packets_only",
                                   "rx_packets: u64;");
    }
    if (name == "virtio_net_stats_rx_basic_rx_bytes_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_basic_rx_bytes_only",
                                   "rx_bytes: u64;");
    }
    if (name == "virtio_net_stats_rx_basic_rx_interrupts_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_basic_rx_interrupts_only",
          "rx_interrupts: u64;");
    }
    if (name == "virtio_net_stats_rx_basic_rx_drops_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_basic_rx_drops_only",
                                   "rx_drops: u64;");
    }
    if (name == "virtio_net_stats_rx_basic_rx_drop_overruns_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_basic_rx_drop_overruns_only",
          "rx_drop_overruns: u64;");
    }
    if (name == "virtio_net_stats_tx_basic") {
      return std::string(
          "struct virtio_net_stats_tx_basic {\n"
          "    type: u8 immediate [\n"
          "        imm 16;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 56;\n"
          "    ];\n"
          "    tx_notifications: u64;\n"
          "    tx_packets: u64;\n"
          "    tx_bytes: u64;\n"
          "    tx_interrupts: u64;\n"
          "    tx_drops: u64;\n"
          "    tx_drop_malformed: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_tx_basic_type_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_basic_type_only",
          "type: u8 immediate [\n"
          "        imm 16;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_tx_basic_reserved_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_basic_reserved_only",
          "reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_tx_basic_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_basic_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_tx_basic_reserved1_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_basic_reserved1_only",
          "reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_tx_basic_size_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_basic_size_only",
          "size: u16 immediate [\n"
          "        imm 56;\n"
          "    ];");
    }
    if (name == "virtio_net_stats_tx_basic_tx_notifications_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_basic_tx_notifications_only",
          "tx_notifications: u64;");
    }
    if (name == "virtio_net_stats_tx_basic_tx_packets_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_basic_tx_packets_only",
                                   "tx_packets: u64;");
    }
    if (name == "virtio_net_stats_tx_basic_tx_bytes_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_basic_tx_bytes_only",
                                   "tx_bytes: u64;");
    }
    if (name == "virtio_net_stats_tx_basic_tx_interrupts_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_basic_tx_interrupts_only",
          "tx_interrupts: u64;");
    }
    if (name == "virtio_net_stats_tx_basic_tx_drops_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_basic_tx_drops_only",
                                   "tx_drops: u64;");
    }
    if (name == "virtio_net_stats_tx_basic_tx_drop_malformed_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_basic_tx_drop_malformed_only",
          "tx_drop_malformed: u64;");
    }
    if (name == "virtio_net_stats_rx_csum") {
      return std::string(
          "struct virtio_net_stats_rx_csum {\n"
          "    type: u8 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 40;\n"
          "    ];\n"
          "    rx_csum_valid: u64;\n"
          "    rx_needs_csum: u64;\n"
          "    rx_csum_none: u64;\n"
          "    rx_csum_bad: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_rx_csum_type_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_csum_type_only",
                                   "type: u8 immediate [\n"
                                   "        imm 1;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_csum_reserved_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_csum_reserved_only",
                                   "reserved: u8 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_csum_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_csum_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_rx_csum_reserved1_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_csum_reserved1_only",
                                   "reserved1: u16 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_csum_size_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_csum_size_only",
                                   "size: u16 immediate [\n"
                                   "        imm 40;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_csum_rx_csum_valid_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_csum_rx_csum_valid_only", "rx_csum_valid: u64;");
    }
    if (name == "virtio_net_stats_rx_csum_rx_needs_csum_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_csum_rx_needs_csum_only", "rx_needs_csum: u64;");
    }
    if (name == "virtio_net_stats_rx_csum_rx_csum_none_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_csum_rx_csum_none_only", "rx_csum_none: u64;");
    }
    if (name == "virtio_net_stats_rx_csum_rx_csum_bad_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_csum_rx_csum_bad_only", "rx_csum_bad: u64;");
    }
    if (name == "virtio_net_stats_tx_csum") {
      return std::string(
          "struct virtio_net_stats_tx_csum {\n"
          "    type: u8 immediate [\n"
          "        imm 17;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 24;\n"
          "    ];\n"
          "    tx_csum_none: u64;\n"
          "    tx_needs_csum: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_tx_csum_type_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_csum_type_only",
                                   "type: u8 immediate [\n"
                                   "        imm 17;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_csum_reserved_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_csum_reserved_only",
                                   "reserved: u8 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_csum_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_csum_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_tx_csum_reserved1_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_csum_reserved1_only",
                                   "reserved1: u16 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_csum_size_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_csum_size_only",
                                   "size: u16 immediate [\n"
                                   "        imm 24;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_csum_tx_csum_none_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_csum_tx_csum_none_only", "tx_csum_none: u64;");
    }
    if (name == "virtio_net_stats_tx_csum_tx_needs_csum_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_csum_tx_needs_csum_only", "tx_needs_csum: u64;");
    }
    if (name == "virtio_net_stats_rx_gso") {
      return std::string(
          "struct virtio_net_stats_rx_gso {\n"
          "    type: u8 immediate [\n"
          "        imm 2;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 40;\n"
          "    ];\n"
          "    rx_gso_packets: u64;\n"
          "    rx_gso_bytes: u64;\n"
          "    rx_gso_packets_coalesced: u64;\n"
          "    rx_gso_bytes_coalesced: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_rx_gso_type_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_gso_type_only",
                                   "type: u8 immediate [\n"
                                   "        imm 2;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_gso_reserved_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_gso_reserved_only",
                                   "reserved: u8 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_gso_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_gso_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_rx_gso_reserved1_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_gso_reserved1_only",
                                   "reserved1: u16 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_gso_size_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_gso_size_only",
                                   "size: u16 immediate [\n"
                                   "        imm 40;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_gso_rx_gso_packets_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_gso_rx_gso_packets_only", "rx_gso_packets: u64;");
    }
    if (name == "virtio_net_stats_rx_gso_rx_gso_bytes_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_gso_rx_gso_bytes_only", "rx_gso_bytes: u64;");
    }
    if (name == "virtio_net_stats_rx_gso_rx_gso_packets_coalesced_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_gso_rx_gso_packets_coalesced_only",
          "rx_gso_packets_coalesced: u64;");
    }
    if (name == "virtio_net_stats_rx_gso_rx_gso_bytes_coalesced_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_gso_rx_gso_bytes_coalesced_only",
          "rx_gso_bytes_coalesced: u64;");
    }
    if (name == "virtio_net_stats_tx_gso") {
      return std::string(
          "struct virtio_net_stats_tx_gso {\n"
          "    type: u8 immediate [\n"
          "        imm 18;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 56;\n"
          "    ];\n"
          "    tx_gso_packets: u64;\n"
          "    tx_gso_bytes: u64;\n"
          "    tx_gso_segments: u64;\n"
          "    tx_gso_segments_bytes: u64;\n"
          "    tx_gso_packets_noseg: u64;\n"
          "    tx_gso_bytes_noseg: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_tx_gso_type_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_gso_type_only",
                                   "type: u8 immediate [\n"
                                   "        imm 18;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_gso_reserved_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_gso_reserved_only",
                                   "reserved: u8 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_gso_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_gso_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_tx_gso_reserved1_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_gso_reserved1_only",
                                   "reserved1: u16 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_gso_size_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_gso_size_only",
                                   "size: u16 immediate [\n"
                                   "        imm 56;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_gso_tx_gso_packets_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_gso_tx_gso_packets_only", "tx_gso_packets: u64;");
    }
    if (name == "virtio_net_stats_tx_gso_tx_gso_bytes_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_gso_tx_gso_bytes_only", "tx_gso_bytes: u64;");
    }
    if (name == "virtio_net_stats_tx_gso_tx_gso_segments_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_gso_tx_gso_segments_only",
          "tx_gso_segments: u64;");
    }
    if (name == "virtio_net_stats_tx_gso_tx_gso_segments_bytes_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_gso_tx_gso_segments_bytes_only",
          "tx_gso_segments_bytes: u64;");
    }
    if (name == "virtio_net_stats_tx_gso_tx_gso_packets_noseg_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_gso_tx_gso_packets_noseg_only",
          "tx_gso_packets_noseg: u64;");
    }
    if (name == "virtio_net_stats_tx_gso_tx_gso_bytes_noseg_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_gso_tx_gso_bytes_noseg_only",
          "tx_gso_bytes_noseg: u64;");
    }
    if (name == "virtio_net_stats_rx_speed") {
      return std::string(
          "struct virtio_net_stats_rx_speed {\n"
          "    type: u8 immediate [\n"
          "        imm 3;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 24;\n"
          "    ];\n"
          "    rx_ratelimit_packets: u64;\n"
          "    rx_ratelimit_bytes: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_rx_speed_type_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_speed_type_only",
                                   "type: u8 immediate [\n"
                                   "        imm 3;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_speed_reserved_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_speed_reserved_only",
                                   "reserved: u8 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_speed_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_speed_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_rx_speed_reserved1_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_speed_reserved1_only",
                                   "reserved1: u16 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_speed_size_only") {
      return renderFieldOnlyStruct("virtio_net_stats_rx_speed_size_only",
                                   "size: u16 immediate [\n"
                                   "        imm 24;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_rx_speed_rx_ratelimit_packets_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_speed_rx_ratelimit_packets_only",
          "rx_ratelimit_packets: u64;");
    }
    if (name == "virtio_net_stats_rx_speed_rx_ratelimit_bytes_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_rx_speed_rx_ratelimit_bytes_only",
          "rx_ratelimit_bytes: u64;");
    }
    if (name == "virtio_net_stats_tx_speed") {
      return std::string(
          "struct virtio_net_stats_tx_speed {\n"
          "    type: u8 immediate [\n"
          "        imm 19;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved1: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    size: u16 immediate [\n"
          "        imm 24;\n"
          "    ];\n"
          "    tx_ratelimit_packets: u64;\n"
          "    tx_ratelimit_bytes: u64;\n"
          "}\n");
    }
    if (name == "virtio_net_stats_tx_speed_type_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_speed_type_only",
                                   "type: u8 immediate [\n"
                                   "        imm 19;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_speed_reserved_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_speed_reserved_only",
                                   "reserved: u8 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_speed_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_speed_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_stats_tx_speed_reserved1_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_speed_reserved1_only",
                                   "reserved1: u16 immediate [\n"
                                   "        imm 0;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_speed_size_only") {
      return renderFieldOnlyStruct("virtio_net_stats_tx_speed_size_only",
                                   "size: u16 immediate [\n"
                                   "        imm 24;\n"
                                   "    ];");
    }
    if (name == "virtio_net_stats_tx_speed_tx_ratelimit_packets_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_speed_tx_ratelimit_packets_only",
          "tx_ratelimit_packets: u64;");
    }
    if (name == "virtio_net_stats_tx_speed_tx_ratelimit_bytes_only") {
      return renderFieldOnlyStruct(
          "virtio_net_stats_tx_speed_tx_ratelimit_bytes_only",
          "tx_ratelimit_bytes: u64;");
    }
    if (name == "virtio_net_ctrl_vlan") {
      return std::string(
          "struct virtio_net_ctrl_vlan {\n"
          "    vid: u16 flag [\n"
          "        bits 0..4;\n"
          "        bits 5..15;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_vlan_vid_only") {
      return renderFieldOnlyStruct("virtio_net_ctrl_vlan_vid_only",
                                   "vid: u16 flag [\n"
                                   "        bits 0..4;\n"
                                   "        bits 5..15;\n"
                                   "    ];");
    }
    if (name == "virtio_net_ctrl_mq") {
      return std::string(
          "struct virtio_net_ctrl_mq {\n"
          "    virtqueue_pairs: u16 random;\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_mq_virtqueue_pairs_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_mq_virtqueue_pairs_only",
          "virtqueue_pairs: u16 random;");
    }
    if (name == "virtio_net_ctrl_coal_tx") {
      return std::string(
          "struct virtio_net_ctrl_coal_tx {\n"
          "    tx_max_packets: u32;\n"
          "    tx_usecs: u32;\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_coal_tx_tx_max_packets_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_coal_tx_tx_max_packets_only", "tx_max_packets: u32;");
    }
    if (name == "virtio_net_ctrl_coal_tx_tx_usecs_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_coal_tx_tx_usecs_only", "tx_usecs: u32;");
    }
    if (name == "virtio_net_ctrl_coal_rx") {
      return std::string(
          "struct virtio_net_ctrl_coal_rx {\n"
          "    rx_max_packets: u32;\n"
          "    rx_usecs: u32;\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_coal_rx_rx_max_packets_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_coal_rx_rx_max_packets_only", "rx_max_packets: u32;");
    }
    if (name == "virtio_net_ctrl_coal_rx_rx_usecs_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_coal_rx_rx_usecs_only", "rx_usecs: u32;");
    }
    if (name == "virtio_net_ctrl_coal_vq") {
      return std::string(
          "struct virtio_net_ctrl_coal_vq {\n"
          "    vqn: u16;\n"
          "    reserved: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    max_packets: u32;\n"
          "    max_usecs: u32;\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_coal_vq_vqn_only") {
      return renderFieldOnlyStruct("virtio_net_ctrl_coal_vq_vqn_only",
                                   "vqn: u16;");
    }
    if (name == "virtio_net_ctrl_coal_vq_reserved_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_coal_vq_reserved_only",
          "reserved: u16 immediate [\n"
          "        imm 0;\n"
          "    ];");
    }
    if (name == "virtio_net_ctrl_coal_vq_max_packets_only") {
      return renderFieldOnlyStruct("virtio_net_ctrl_coal_vq_max_packets_only",
                                   "max_packets: u32;");
    }
    if (name == "virtio_net_ctrl_coal_vq_max_usecs_only") {
      return renderFieldOnlyStruct("virtio_net_ctrl_coal_vq_max_usecs_only",
                                   "max_usecs: u32;");
    }
    if (name == "virtio_net_ctrl_queue_stats") {
      return std::string(
          "struct virtio_net_ctrl_queue_stats {\n"
          "    vq_index: u16;\n"
          "    reserved: bytes[6] random;\n"
          "    types_bitmap: u64 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 16..16;\n"
          "        bits 17..17;\n"
          "        bits 18..18;\n"
          "        bits 19..19;\n"
          "        bits 32..32;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "virtio_net_ctrl_queue_stats_vq_index_only") {
      return renderFieldOnlyStruct("virtio_net_ctrl_queue_stats_vq_index_only",
                                   "vq_index: u16;");
    }
    if (name == "virtio_net_ctrl_queue_stats_reserved_only") {
      return renderFieldOnlyStruct("virtio_net_ctrl_queue_stats_reserved_only",
                                   "reserved: bytes[6] random;");
    }
    if (name == "virtio_net_ctrl_queue_stats_types_bitmap_only") {
      return renderFieldOnlyStruct(
          "virtio_net_ctrl_queue_stats_types_bitmap_only",
          "types_bitmap: u64 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 16..16;\n"
          "        bits 17..17;\n"
          "        bits 18..18;\n"
          "        bits 19..19;\n"
          "        bits 32..32;\n"
          "    ];");
    }
    if (name == "sockaddr") {
      return std::string(
          "struct sockaddr {\n"
          "    sa_data: bytes[6] random;\n"
          "}\n");
    }
    if (name == "ethernet_frame") {
      return std::string(
          "struct ethernet_frame {\n"
          "    dst: bytes[6] random;\n"
          "    src: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0x0008;\n"
          "        imm 0xdd86;\n"
          "        imm 0x0608;\n"
          "        imm 0x0081;\n"
          "    ];\n"
          "    payload: bytes[46] random;\n"
          "}\n");
    }
    if (name == "ethernet_ipv4_frame") {
      return std::string(
          "struct ethernet_ipv4_frame {\n"
          "    dst: bytes[6] random;\n"
          "    src: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0x0008;\n"
          "    ];\n"
          "    version_ihl: u8 flag [\n"
          "        bits 0..3;\n"
          "        bits 4..7 = 4;\n"
          "    ];\n"
          "    dscp_ecn: u8 flag [\n"
          "        bits 0..1;\n"
          "        bits 2..7;\n"
          "    ];\n"
          "    total_length: u16 immediate [\n"
          "        range 24..1514;\n"
          "    ];\n"
          "    identification: u16;\n"
          "    fragment_offset: u16 flag [\n"
          "        bits 0..12;\n"
          "        bits 13..15;\n"
          "    ];\n"
          "    ttl: u8 random;\n"
          "    protocol: u8 immediate [\n"
          "        imm 1;\n"
          "        imm 6;\n"
          "        imm 17;\n"
          "        imm 58;\n"
        "    ];\n"
          "    hdr_checksum: u16;\n"
          "    src_addr: u32;\n"
          "    dst_addr: u32;\n"
          "    payload: bytes[26] random;\n"
          "}\n");
    }
    if (name == "ethernet_ipv6_frame") {
      return std::string(
          "struct ethernet_ipv6_frame {\n"
          "    dst: bytes[6] random;\n"
          "    src: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0xdd86;\n"
          "    ];\n"
          "    version_tc_flow: u32 flag [\n"
          "        bits 0..27;\n"
          "        bits 28..31 = 6;\n"
          "    ];\n"
          "    payload_length: u16 immediate [\n"
          "        range 4..1500;\n"
          "    ];\n"
          "    next_header: u8 immediate [\n"
          "        imm 6;\n"
          "        imm 17;\n"
          "        imm 44;\n"
          "        imm 58;\n"
          "    ];\n"
          "    hop_limit: u8 random;\n"
          "    src_addr: bytes[16] random;\n"
          "    dst_addr: bytes[16] random;\n"
          "    payload: bytes[6] random;\n"
          "}\n");
    }
    if (name == "ethernet_arp_frame") {
      return std::string(
          "struct ethernet_arp_frame {\n"
          "    dst: bytes[6] random;\n"
          "    src: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0x0608;\n"
          "    ];\n"
          "    htype: u16 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "    ptype: u16 immediate [\n"
          "        imm 0x0008;\n"
          "    ];\n"
          "    hlen: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    plen: u8 immediate [\n"
          "        imm 4;\n"
          "    ];\n"
          "    oper: u16 immediate [\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "    ];\n"
          "    sha: bytes[6] random;\n"
          "    spa: u32;\n"
          "    tha: bytes[6] random;\n"
          "    tpa: u32;\n"
          "    padding: bytes[18] random;\n"
          "}\n");
    }
    if (name == "arp_packet") {
      return std::string(
          "struct arp_packet {\n"
          "    dst_mac: bytes[6] random;\n"
          "    src_mac: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0x0608;\n"
          "    ];\n"
          "    htype: u16 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "    ptype: u16 immediate [\n"
          "        imm 0x0008;\n"
          "    ];\n"
          "    hlen: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    plen: u8 immediate [\n"
          "        imm 4;\n"
          "    ];\n"
          "    oper: u16 immediate [\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "    ];\n"
          "    sha: bytes[6] random;\n"
          "    spa: u32;\n"
          "    tha: bytes[6] random;\n"
          "    tpa: u32;\n"
          "    padding: bytes[18] random;\n"
          "}\n");
    }
    if (name == "ethernet_vlan_frame") {
      return std::string(
          "struct ethernet_vlan_frame {\n"
          "    dst: bytes[6] random;\n"
          "    src: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0x0081;\n"
          "    ];\n"
          "    tci: u16 flag [\n"
          "        bits 0..11;\n"
          "        bits 12..12;\n"
          "        bits 13..15;\n"
          "    ];\n"
          "    inner_ethertype: u16 immediate [\n"
          "        imm 0x0008;\n"
          "        imm 0xdd86;\n"
          "        imm 0x0608;\n"
          "        imm 0x0081;\n"
          "    ];\n"
          "    payload: bytes[42] random;\n"
          "}\n");
    }
    if (name == "ipv4_tcp_packet" || name == "ipv6_tcp_packet") {
      if (name == "ipv4_tcp_packet") {
        return std::string(
            "struct ipv4_tcp_packet {\n"
            "    dst_mac: bytes[6] random;\n"
            "    src_mac: bytes[6] random;\n"
            "    ethertype: u16 immediate [\n"
            "        imm 0x0008;\n"
            "    ];\n"
            "    version_ihl: u8 flag [\n"
            "        bits 0..3;\n"
            "        bits 4..7 = 4;\n"
            "    ];\n"
            "    dscp_ecn: u8 flag [\n"
            "        bits 0..1;\n"
            "        bits 2..7;\n"
            "    ];\n"
            "    total_length: u16 immediate [\n"
            "        range 40..1514;\n"
            "    ];\n"
            "    identification: u16;\n"
            "    fragment_offset: u16 flag [\n"
            "        bits 0..12;\n"
            "        bits 13..15;\n"
            "    ];\n"
            "    ttl: u8 random;\n"
            "    src_addr: u32;\n"
            "    dst_addr: u32;\n"
            "    protocol: u8 immediate [\n"
            "        imm 6;\n"
            "    ];\n"
            "    src_port: u16;\n"
            "    dst_port: u16;\n"
            "    seq: u32;\n"
            "    ack_seq: u32;\n"
            "    data_offset: u8 flag [\n"
            "        bits 0..3;\n"
            "        bits 4..7 = 5;\n"
            "    ];\n"
            "    flags: u8 flag [\n"
            "        bits 0..0;\n"
            "        bits 1..1;\n"
            "        bits 2..2;\n"
            "        bits 3..3;\n"
            "        bits 4..4;\n"
            "        bits 5..5;\n"
            "        bits 6..6;\n"
            "        bits 7..7;\n"
            "    ];\n"
            "    window: u16;\n"
            "    checksum: u16;\n"
            "    urgent_ptr: u16;\n"
            "    payload: bytes[6] random;\n"
            "}\n");
      }
      return std::string(
          "struct ipv6_tcp_packet {\n"
          "    dst_mac: bytes[6] random;\n"
          "    src_mac: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0xdd86;\n"
          "    ];\n"
          "    version_tc_flow: u32 flag [\n"
          "        bits 0..27;\n"
          "        bits 28..31 = 6;\n"
          "    ];\n"
          "    payload_length: u16 immediate [\n"
          "        range 20..1500;\n"
          "    ];\n"
          "    hop_limit: u8 random;\n"
          "    src_addr: bytes[16] random;\n"
          "    dst_addr: bytes[16] random;\n"
          "    next_header: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    src_port: u16;\n"
          "    dst_port: u16;\n"
          "    seq: u32;\n"
          "    ack_seq: u32;\n"
          "    data_offset: u8 flag [\n"
          "        bits 0..3;\n"
          "        bits 4..7 = 5;\n"
          "    ];\n"
          "    flags: u8 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 4..4;\n"
          "        bits 5..5;\n"
          "        bits 6..6;\n"
          "        bits 7..7;\n"
          "    ];\n"
          "    window: u16;\n"
          "    checksum: u16;\n"
          "    urgent_ptr: u16;\n"
          "    payload: bytes[6] random;\n"
          "}\n");
    }
    if (name == "ipv4_udp_packet" || name == "ipv6_udp_packet") {
      if (name == "ipv4_udp_packet") {
        return std::string(
            "struct ipv4_udp_packet {\n"
            "    dst_mac: bytes[6] random;\n"
            "    src_mac: bytes[6] random;\n"
            "    ethertype: u16 immediate [\n"
            "        imm 0x0008;\n"
            "    ];\n"
            "    version_ihl: u8 flag [\n"
            "        bits 0..3;\n"
            "        bits 4..7 = 4;\n"
            "    ];\n"
            "    dscp_ecn: u8 flag [\n"
            "        bits 0..1;\n"
            "        bits 2..7;\n"
            "    ];\n"
            "    total_length: u16 immediate [\n"
            "        range 28..1514;\n"
            "    ];\n"
            "    identification: u16;\n"
            "    fragment_offset: u16 flag [\n"
            "        bits 0..12;\n"
            "        bits 13..15;\n"
            "    ];\n"
            "    ttl: u8 random;\n"
            "    src_addr: u32;\n"
            "    dst_addr: u32;\n"
            "    protocol: u8 immediate [\n"
            "        imm 17;\n"
            "    ];\n"
            "    src_port: u16;\n"
            "    dst_port: u16;\n"
            "    length: u16 immediate [\n"
            "        range 8..1472;\n"
            "    ];\n"
            "    checksum: u16;\n"
            "    payload: bytes[18] random;\n"
            "}\n");
      }
      return std::string(
          "struct ipv6_udp_packet {\n"
          "    dst_mac: bytes[6] random;\n"
          "    src_mac: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0xdd86;\n"
          "    ];\n"
          "    version_tc_flow: u32 flag [\n"
          "        bits 0..27;\n"
          "        bits 28..31 = 6;\n"
          "    ];\n"
          "    payload_length: u16 immediate [\n"
          "        range 8..1500;\n"
          "    ];\n"
          "    hop_limit: u8 random;\n"
          "    src_addr: bytes[16] random;\n"
          "    dst_addr: bytes[16] random;\n"
          "    next_header: u8 immediate [\n"
          "        imm 17;\n"
          "    ];\n"
          "    src_port: u16;\n"
          "    dst_port: u16;\n"
          "    length: u16 immediate [\n"
          "        range 8..1472;\n"
          "    ];\n"
          "    checksum: u16;\n"
          "    payload: bytes[18] random;\n"
          "}\n");
    }
    if (name == "ipv4_icmp_packet" || name == "ipv6_icmpv6_packet") {
      if (name == "ipv4_icmp_packet") {
        return std::string(
            "struct ipv4_icmp_packet {\n"
            "    dst_mac: bytes[6] random;\n"
            "    src_mac: bytes[6] random;\n"
            "    ethertype: u16 immediate [\n"
            "        imm 0x0008;\n"
            "    ];\n"
            "    version_ihl: u8 flag [\n"
            "        bits 0..3;\n"
            "        bits 4..7 = 4;\n"
            "    ];\n"
            "    dscp_ecn: u8 flag [\n"
            "        bits 0..1;\n"
            "        bits 2..7;\n"
            "    ];\n"
            "    total_length: u16 immediate [\n"
            "        range 28..1514;\n"
            "    ];\n"
            "    identification: u16;\n"
            "    fragment_offset: u16 flag [\n"
            "        bits 0..12;\n"
            "        bits 13..15;\n"
            "    ];\n"
            "    ttl: u8 random;\n"
            "    src_addr: u32;\n"
            "    dst_addr: u32;\n"
            "    protocol: u8 immediate [\n"
            "        imm 1;\n"
            "    ];\n"
            "    type: u8 immediate [\n"
            "        imm 0;\n"
            "        imm 3;\n"
            "        imm 8;\n"
            "        imm 11;\n"
            "    ];\n"
            "    code: u8 random;\n"
            "    checksum: u16;\n"
            "    rest: u32;\n"
            "    payload: bytes[18] random;\n"
            "}\n");
      }
      return std::string(
          "struct ipv6_icmpv6_packet {\n"
          "    dst_mac: bytes[6] random;\n"
          "    src_mac: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0xdd86;\n"
          "    ];\n"
          "    version_tc_flow: u32 flag [\n"
          "        bits 0..27;\n"
          "        bits 28..31 = 6;\n"
          "    ];\n"
          "    payload_length: u16 immediate [\n"
          "        range 8..1500;\n"
          "    ];\n"
          "    hop_limit: u8 random;\n"
          "    src_addr: bytes[16] random;\n"
          "    dst_addr: bytes[16] random;\n"
          "    next_header: u8 immediate [\n"
          "        imm 58;\n"
          "    ];\n"
          "    type: u8 immediate [\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "        imm 3;\n"
          "        imm 128;\n"
          "        imm 129;\n"
          "    ];\n"
          "    code: u8 random;\n"
          "    checksum: u16;\n"
          "    rest: u32;\n"
          "    payload: bytes[18] random;\n"
          "}\n");
    }
    if (name == "ipv6_fragment_packet") {
      return std::string(
          "struct ipv6_fragment_packet {\n"
          "    dst_mac: bytes[6] random;\n"
          "    src_mac: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0xdd86;\n"
          "    ];\n"
          "    version_tc_flow: u32 flag [\n"
          "        bits 0..27;\n"
          "        bits 28..31 = 6;\n"
          "    ];\n"
          "    payload_length: u16 immediate [\n"
          "        range 8..1500;\n"
          "    ];\n"
          "    hop_limit: u8 random;\n"
          "    src_addr: bytes[16] random;\n"
          "    dst_addr: bytes[16] random;\n"
          "    next_header: u8 immediate [\n"
          "        imm 6;\n"
          "        imm 17;\n"
          "        imm 58;\n"
          "    ];\n"
          "    reserved: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    fragment_offset: u16 flag [\n"
          "        bits 0..2 = 0;\n"
          "        bits 3..15;\n"
          "    ];\n"
          "    identification: u32;\n"
          "    payload: bytes[14] random;\n"
          "}\n");
    }
    if (name == "vlan_ipv4_packet") {
      return std::string(
          "struct vlan_ipv4_packet {\n"
          "    dst_mac: bytes[6] random;\n"
          "    src_mac: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0x0081;\n"
          "    ];\n"
          "    tci: u16 flag [\n"
          "        bits 0..11;\n"
          "        bits 12..12;\n"
          "        bits 13..15;\n"
          "    ];\n"
          "    inner_ethertype: u16 immediate [\n"
          "        imm 0x0008;\n"
          "    ];\n"
          "    version_ihl: u8 flag [\n"
          "        bits 0..3;\n"
          "        bits 4..7 = 4;\n"
          "    ];\n"
          "    dscp_ecn: u8 flag [\n"
          "        bits 0..1;\n"
          "        bits 2..7;\n"
          "    ];\n"
          "    total_length: u16 immediate [\n"
          "        range 20..1514;\n"
          "    ];\n"
          "    identification: u16;\n"
          "    fragment_offset: u16 flag [\n"
          "        bits 0..12;\n"
          "        bits 13..15;\n"
          "    ];\n"
          "    ttl: u8 random;\n"
          "    src_addr: u32;\n"
          "    dst_addr: u32;\n"
          "    protocol: u8 immediate [\n"
          "        imm 1;\n"
          "        imm 6;\n"
          "        imm 17;\n"
          "        imm 58;\n"
          "    ];\n"
          "    payload: bytes[22] random;\n"
          "}\n");
    }
    if (name == "vlan_ipv6_packet") {
      return std::string(
          "struct vlan_ipv6_packet {\n"
          "    dst_mac: bytes[6] random;\n"
          "    src_mac: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0x0081;\n"
          "    ];\n"
          "    tci: u16 flag [\n"
          "        bits 0..11;\n"
          "        bits 12..12;\n"
          "        bits 13..15;\n"
          "    ];\n"
          "    inner_ethertype: u16 immediate [\n"
          "        imm 0xdd86;\n"
          "    ];\n"
          "    version_tc_flow: u32 flag [\n"
          "        bits 0..27;\n"
          "        bits 28..31 = 6;\n"
          "    ];\n"
          "    payload_length: u16 immediate [\n"
          "        range 4..1500;\n"
          "    ];\n"
          "    hop_limit: u8 random;\n"
          "    src_addr: bytes[16] random;\n"
          "    dst_addr: bytes[16] random;\n"
          "    next_header: u8 immediate [\n"
          "        imm 6;\n"
          "        imm 17;\n"
          "        imm 44;\n"
          "        imm 58;\n"
          "    ];\n"
          "    payload: bytes[2] random;\n"
          "}\n");
    }
    if (name == "vlan_arp_packet") {
      return std::string(
          "struct vlan_arp_packet {\n"
          "    dst_mac: bytes[6] random;\n"
          "    src_mac: bytes[6] random;\n"
          "    ethertype: u16 immediate [\n"
          "        imm 0x0081;\n"
          "    ];\n"
          "    tci: u16 flag [\n"
          "        bits 0..11;\n"
          "        bits 12..12;\n"
          "        bits 13..15;\n"
          "    ];\n"
          "    inner_ethertype: u16 immediate [\n"
          "        imm 0x0608;\n"
          "    ];\n"
          "    htype: u16 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "    ptype: u16 immediate [\n"
          "        imm 0x0008;\n"
          "    ];\n"
          "    hlen: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    plen: u8 immediate [\n"
          "        imm 4;\n"
          "    ];\n"
          "    oper: u16 immediate [\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "    ];\n"
          "    sha: bytes[6] random;\n"
          "    spa: u32;\n"
          "    tha: bytes[6] random;\n"
          "    tpa: u32;\n"
          "    padding: bytes[18] random;\n"
          "}\n");
    }
    if (name == "char") {
      return std::string(
          "struct char {\n"
          "    value: u8 random;\n"
          "}\n");
    }
    if (name == "net_device") {
      return std::string(
          "struct net_device {\n"
          "    dev_addr: bytes[6] random;\n"
          "}\n");
    }
    if (name == "xdp_frame") {
      return std::string(
          "struct xdp_frame {\n"
          "    data: bytes[256] random;\n"
          "}\n");
    }
    if (name == "control_buf") {
      return std::string(
          "struct control_buf {\n"
          "    cvq: u8 random;\n"
          "    index: u16 random;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_TX_VRING") {
      return renderVring("VIRTIO_NET_TX_VRING", false);
    }
    if (name == "VIRTIO_NET_RX_VRING") {
      return renderVring("VIRTIO_NET_RX_VRING", false);
    }
    if (name == "VIRTIO_NET_CTRL_VRING") {
      return renderVring("VIRTIO_NET_CTRL_VRING", true);
    }
    if (name == "VIRTIO_NET_TX_BUF0") {
      return std::string(
          "struct VIRTIO_NET_TX_BUF0 {\n"
          "    buf: bytes[256] random;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_RX_BUF0") {
      return std::string(
          "struct VIRTIO_NET_RX_BUF0 {\n"
          "    buf: bytes[256] random;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_BUF0") {
      return std::string(
          "struct VIRTIO_NET_CTRL_BUF0 {\n"
          "    buf: bytes[256] random;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_11") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_11 {\n"
          "    class: u8 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "    mac: bytes[6];\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_2") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_2 {\n"
          "    class: u8 immediate [\n"
          "        imm 2;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "        imm 1;\n"
          "    ];\n"
          "    vid: u16 flag [\n"
          "        bits 0..4;\n"
          "        bits 5..15;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_40") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_40 {\n"
          "    class: u8 immediate [\n"
          "        imm 4;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    virtqueue_pairs: u16 random;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_41") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_41 {\n"
          "    class: u8 immediate [\n"
          "        imm 4;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 1;\n"
          "        imm 2;\n"
          "    ];\n"
          "    hash_types: u32 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 4..4;\n"
          "        bits 5..5;\n"
          "        bits 6..6;\n"
          "        bits 7..7;\n"
          "        bits 8..8;\n"
          "    ];\n"
          "    indirection_table_mask: u16 immediate [\n"
          "        imm 3;\n"
          "    ];\n"
          "    unclassified_queue: u16;\n"
          "    indirection_table: bytes[6] random;\n"
          "    max_tx_vq: u16 random;\n"
          "    hash_key_length: u8 immediate [\n"
          "        imm 32;\n"
          "    ];\n"
          "    hash_key_data: bytes[32] random;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_5") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_5 {\n"
          "    class: u8 immediate [\n"
          "        imm 5;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    offloads: u64 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 7..7;\n"
          "        bits 8..8;\n"
          "        bits 9..9;\n"
          "        bits 10..10;\n"
          "        bits 46..46;\n"
          "        bits 47..47;\n"
          "        bits 54..54;\n"
          "        bits 55..55;\n"
          "        bits 59..59;\n"
          "    ];\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_COAL_TX") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_COAL_TX {\n"
          "    class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    tx_max_packets: u32;\n"
          "    tx_usecs: u32;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_COAL_RX") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_COAL_RX {\n"
          "    class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 1;\n"
          "    ];\n"
          "    rx_max_packets: u32;\n"
          "    rx_usecs: u32;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_COAL_VQ") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_COAL_VQ {\n"
          "    class: u8 immediate [\n"
          "        imm 6;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 2;\n"
          "        imm 3;\n"
          "    ];\n"
          "    vqn: u16;\n"
          "    reserved: u16 immediate [\n"
          "        imm 0;\n"
          "    ];\n"
          "    max_packets: u32;\n"
          "    max_usecs: u32;\n"
          "}\n");
    }
    if (name == "VIRTIO_NET_CTRL_CTRL_HDR_QUEUE_STATS") {
      return std::string(
          "struct VIRTIO_NET_CTRL_CTRL_HDR_QUEUE_STATS {\n"
          "    class: u8 immediate [\n"
          "        imm 8;\n"
          "    ];\n"
          "    cmd: u8 immediate [\n"
          "        imm 0;\n"
          "        imm 1;\n"
          "    ];\n"
          "    vq_index: u16;\n"
          "    reserved: bytes[6] random;\n"
          "    types_bitmap: u64 flag [\n"
          "        bits 0..0;\n"
          "        bits 1..1;\n"
          "        bits 2..2;\n"
          "        bits 3..3;\n"
          "        bits 16..16;\n"
          "        bits 17..17;\n"
          "        bits 18..18;\n"
          "        bits 19..19;\n"
          "        bits 32..32;\n"
          "    ];\n"
          "}\n");
    }
    return std::nullopt;
  }

  static std::optional<std::string> renderSchemaHead(
      StringRef typeName,
      const std::set<std::string> &positions) {
    const std::string name = sanitizeToken(typeName);
    if (name.empty() || positions.empty()) {
      return std::nullopt;
    }
    std::ostringstream out;
    out << "head " << name << "_head {\n";
    out << "    position = ";
    auto extractField = [](const std::string &position,
                           const std::string &key) -> std::string {
      const std::string needle = key + " = ";
      size_t start = position.find(needle);
      if (start == std::string::npos) {
        return "";
      }
      start += needle.size();
      size_t end = position.find(';', start);
      if (end == std::string::npos) {
        end = position.find(']', start);
      }
      if (end == std::string::npos) {
        return "";
      }
      return position.substr(start, end - start);
    };
    auto adjustedPosition = [&](const std::string &position) {
      std::string outPos = position;
      const std::string callerValue = extractField(position, "caller");
      auto replaceField = [&](const std::string &key, const std::string &value) {
        const std::string needle = key + " = ";
        size_t start = outPos.find(needle);
        if (start == std::string::npos) {
          return;
        }
        start += needle.size();
        size_t end = outPos.find(';', start);
        if (end == std::string::npos) {
          end = outPos.find(']', start);
          if (end == std::string::npos) {
            return;
          }
        }
        outPos.replace(start, end - start, value);
      };
      if (name == "VIRTIO_NET_TX_VRING" || name == "VIRTIO_NET_TX_BUF0") {
        replaceField("callee", "this_is_a_stub_for_virtio_net_tx");
        replaceField("argument_index", "2");
      } else if (name == "VIRTIO_NET_TX_CHAIN_2") {
        replaceField("callee", "this_is_a_stub_for_virtio_net_tx");
        replaceField("argument_index", "2");
      } else if (name == "VIRTIO_NET_TX_CHAIN_XDP_2" ||
                 name == "VIRTIO_NET_TX_CHAIN_SKB_2" ||
                 name == "VIRTIO_NET_TX_CHAIN_HDR12_2" ||
                 name == "VIRTIO_NET_TX_CHAIN_HDR24_2" ||
                 name == "VIRTIO_NET_TX_CHAIN_XDP_HDR12_2" ||
                 name == "VIRTIO_NET_TX_CHAIN_XDP_HDR24_2" ||
                 name == "VIRTIO_NET_TX_CHAIN_SKB_HDR12_2" ||
                 name == "VIRTIO_NET_TX_CHAIN_SKB_HDR24_2") {
        replaceField("callee", "this_is_a_stub_for_virtio_net_tx");
        replaceField("argument_index", "2");
      } else if (name == "VIRTIO_NET_RX_VRING" || name == "VIRTIO_NET_RX_BUF0") {
        replaceField("callee", "this_is_a_stub_for_virtio_net_rx");
        replaceField("argument_index", "2");
      } else if (name == "VIRTIO_NET_RX_CHAIN_2") {
        replaceField("callee", "this_is_a_stub_for_virtio_net_rx");
        replaceField("argument_index", "2");
      } else if (name == "VIRTIO_NET_RX_CHAIN_LARGE_2" ||
                 name == "VIRTIO_NET_RX_CHAIN_SMALL_2") {
        replaceField("callee", "this_is_a_stub_for_virtio_net_rx");
        replaceField("argument_index", "2");
      } else if (name == "VIRTIO_NET_CTRL_VRING" || name == "VIRTIO_NET_CTRL_BUF0" ||
                 StringRef(name).startswith("VIRTIO_NET_CTRL_CTRL_HDR_")) {
        replaceField("callee", "this_is_a_stub_for_virtio_net_ctrl");
        replaceField("argument_index", "2");
      } else if (StringRef(name).startswith("virtio_net_ctrl_") ||
                 StringRef(name).startswith("virtio_net_rss_config_") ||
                 StringRef(name).startswith("virtio_net_stats_") ||
                 StringRef(name).startswith("virtio_net_guest_offloads")) {
        replaceField("callee", "this_is_a_stub_for_virtio_net_ctrl");
        replaceField("argument_index", "2");
      } else if (StringRef(name).startswith("virtio_net_hdr") ||
                 name == "xdp_frame" ||
                 name == "ethernet_frame" ||
                 name == "char" ||
                 name == "virtnet_rq_dma" ||
                 name == "virtnet_rq_dma_addr_only" ||
                 name == "virtnet_rq_dma_ref_only" ||
                 name == "virtnet_rq_dma_len_only" ||
                 name == "virtnet_rq_dma_need_sync_only" ||
                 StringRef(name).startswith("vring_desc") ||
                 StringRef(name).startswith("vring_packed_desc") ||
                 StringRef(name).startswith("vring_desc_extra")) {
        const StringRef caller(callerValue);
        if (caller.contains("xmit") || caller.contains("outbuf") ||
            caller.contains("virtnet_add_outbuf")) {
          replaceField("callee", "this_is_a_stub_for_virtio_net_tx");
          replaceField("argument_index", "2");
        } else if (caller.contains("recv") || caller.contains("fill_recv") ||
                   caller.contains("add_recvbuf") || caller.contains("rx_") ||
                   caller.contains("remove_vq_common") ||
                   caller.contains("free_unused_bufs")) {
          replaceField("callee", "this_is_a_stub_for_virtio_net_rx");
          replaceField("argument_index", "2");
        } else if (caller.contains("send_command") ||
                   caller.contains("get_hw_stats")) {
          replaceField("callee", "this_is_a_stub_for_virtio_net_ctrl");
          replaceField("argument_index", "2");
        }
      }
      return outPos;
    };
    std::map<std::tuple<std::string, std::string, std::string, std::string>,
             std::pair<unsigned, std::string>>
        normalizedPositions;
    for (const std::string &rawPosition : positions) {
      const std::string position = adjustedPosition(rawPosition);
      const std::string file = extractField(position, "file");
      const std::string caller = extractField(position, "caller");
      const std::string callee = extractField(position, "callee");
      const std::string arg = extractField(position, "argument_index");
      unsigned depth = 0;
      const std::string depthText = extractField(position, "call_depth");
      if (!depthText.empty()) {
        (void)StringRef(depthText).getAsInteger(10, depth);
      }
      const auto key = std::make_tuple(file, caller, callee, arg);
      auto it = normalizedPositions.find(key);
      if (it == normalizedPositions.end() || depth < it->second.first) {
        normalizedPositions[key] = {depth, position};
      }
    }
    std::vector<std::pair<unsigned, std::string>> orderedPositions;
    orderedPositions.reserve(normalizedPositions.size());
    for (const auto &entry : normalizedPositions) {
      orderedPositions.push_back(entry.second);
    }
    const bool semanticDataFamily =
        StringRef(name).startswith("VIRTIO_NET_CTRL_CTRL_HDR_") ||
        name == "VIRTIO_NET_TX_VRING" ||
        name == "VIRTIO_NET_TX_CHAIN_2" ||
        name == "VIRTIO_NET_TX_CHAIN_XDP_2" ||
        name == "VIRTIO_NET_TX_CHAIN_SKB_2" ||
        name == "VIRTIO_NET_TX_CHAIN_HDR12_2" ||
        name == "VIRTIO_NET_TX_CHAIN_HDR24_2" ||
        name == "VIRTIO_NET_TX_CHAIN_XDP_HDR12_2" ||
        name == "VIRTIO_NET_TX_CHAIN_XDP_HDR24_2" ||
        name == "VIRTIO_NET_TX_CHAIN_SKB_HDR12_2" ||
        name == "VIRTIO_NET_TX_CHAIN_SKB_HDR24_2" ||
        name == "VIRTIO_NET_RX_VRING" ||
        name == "VIRTIO_NET_RX_CHAIN_2" ||
        name == "VIRTIO_NET_RX_CHAIN_LARGE_2" ||
        name == "VIRTIO_NET_RX_CHAIN_SMALL_2" ||
        name == "VIRTIO_NET_CTRL_VRING" ||
        name == "VIRTIO_NET_TX_BUF0" ||
        name == "VIRTIO_NET_RX_BUF0" ||
        name == "VIRTIO_NET_CTRL_BUF0" ||
        name == "arp_packet" ||
        name == "ipv4_icmp_packet" ||
        name == "ipv4_tcp_packet" ||
        name == "ipv4_udp_packet" ||
        name == "ipv6_fragment_packet" ||
        name == "ipv6_icmpv6_packet" ||
        name == "ipv6_tcp_packet" ||
        name == "ipv6_udp_packet" ||
        name == "vlan_arp_packet" ||
        name == "vlan_ipv4_packet" ||
        name == "vlan_ipv6_packet" ||
        StringRef(name).startswith("vring_desc") ||
        StringRef(name).startswith("vring_packed_desc") ||
        StringRef(name).startswith("vring_desc_extra") ||
        StringRef(name).startswith("virtio_net_hdr") ||
        name == "xdp_frame" ||
        name == "virtnet_rq_dma" ||
        name == "virtnet_rq_dma_addr_only" ||
        name == "virtnet_rq_dma_ref_only" ||
        name == "virtnet_rq_dma_len_only" ||
        name == "virtnet_rq_dma_need_sync_only" ||
        StringRef(name).startswith("virtio_net_ctrl_") ||
        StringRef(name).startswith("virtio_net_guest_offloads") ||
        StringRef(name).startswith("virtio_net_rss_config_") ||
        StringRef(name).startswith("virtio_net_stats_");
    if (semanticDataFamily) {
      auto isQueueTransportFunction = [](StringRef caller) {
        return caller.startswith("virtqueue_") || caller.startswith("vring_") ||
               caller.startswith("sg_") || caller.startswith("dma_") ||
               caller.startswith("__dma") || caller.startswith("page_pool_") ||
               caller.startswith("skb_") || caller.startswith("__skb");
      };
      bool hasSemanticStub = false;
      for (const auto &entry : orderedPositions) {
        const std::string callee = extractField(entry.second, "callee");
        if (StringRef(callee).startswith("this_is_a_stub_for_virtio_net_")) {
          hasSemanticStub = true;
          break;
        }
      }
      if (hasSemanticStub) {
        std::vector<std::pair<unsigned, std::string>> filtered;
        filtered.reserve(orderedPositions.size());
        for (const auto &entry : orderedPositions) {
          const std::string callee = extractField(entry.second, "callee");
          if (StringRef(callee).startswith("this_is_a_stub_for_virtio_net_")) {
            filtered.push_back(entry);
          }
        }
        if (!filtered.empty()) {
          orderedPositions = std::move(filtered);
        }
      }
      bool hasNonTransportCaller = false;
      for (const auto &entry : orderedPositions) {
        const std::string caller = extractField(entry.second, "caller");
        if (!isQueueTransportFunction(caller)) {
          hasNonTransportCaller = true;
          break;
        }
      }
      if (hasNonTransportCaller) {
        std::vector<std::pair<unsigned, std::string>> filtered;
        filtered.reserve(orderedPositions.size());
        for (const auto &entry : orderedPositions) {
          const std::string caller = extractField(entry.second, "caller");
          if (!isQueueTransportFunction(caller)) {
            filtered.push_back(entry);
          }
        }
        if (!filtered.empty()) {
          orderedPositions = std::move(filtered);
        }
      }
    }
    std::sort(orderedPositions.begin(), orderedPositions.end(),
              [](const auto &lhs, const auto &rhs) {
                if (lhs.first != rhs.first) {
                  return lhs.first < rhs.first;
                }
                return lhs.second < rhs.second;
              });
    bool first = true;
    size_t emitted = 0;
    for (const auto &entry : orderedPositions) {
      if (emitted >= 8) {
        break;
      }
      if (!first) {
        out << " | ";
      }
      first = false;
      ++emitted;
      out << entry.second;
    }
    out << ";\n";
    out << "    to = " << name << ";\n";
    out << "}\n";
    return out.str();
  }

  static std::optional<std::string> renderSchemaPointers(
      const std::set<std::string> &schemaTypes) {
    auto hasType = [&](StringRef name) {
      return schemaTypes.find(sanitizeToken(name)) != schemaTypes.end();
    };
    auto collectTargets = [&](std::initializer_list<StringRef> preferred,
                              StringRef fallback = "") {
      std::vector<std::string> out;
      for (StringRef candidate : preferred) {
        if (hasType(candidate)) {
          out.push_back(sanitizeToken(candidate));
        }
      }
      if (out.empty() && !fallback.empty() && hasType(fallback)) {
        out.push_back(sanitizeToken(fallback));
      }
      return out;
    };
    auto collectTargetsByPrefixes = [&](std::initializer_list<StringRef> prefixes) {
      std::vector<std::string> out;
      for (const std::string &candidate : schemaTypes) {
        for (StringRef prefix : prefixes) {
          if (StringRef(candidate).startswith(sanitizeToken(prefix))) {
            out.push_back(candidate);
            break;
          }
        }
      }
      return out;
    };
    std::ostringstream out;
    bool emitted = false;
    auto appendUnique = [](std::vector<std::string> &dst,
                           const std::vector<std::string> &src) {
      for (const std::string &value : src) {
        if (llvm::find(dst, value) == dst.end()) {
          dst.push_back(value);
        }
      }
    };

    auto emitRange = [&](StringRef fromPrefix,
                         const std::vector<std::string> &targets,
                         bool withSentinel) {
      if (targets.empty()) {
        return;
      }
      for (int i = 0; i < 8; ++i) {
        emitted = true;
        out << "pointer {\n";
        out << "    from = " << fromPrefix.str() << ".addr" << i << ";\n";
        out << "    to = ";
        for (size_t j = 0; j < targets.size(); ++j) {
          if (j != 0) {
            out << " | ";
          }
          out << targets[j];
        }
        out << ";\n";
        if (withSentinel) {
          out << "    sentinel = " << fromPrefix.str() << ".flags" << i
              << "[1] | " << fromPrefix.str() << ".flags" << i << "[4];\n";
        }
        out << "    align = 0;\n";
        out << "}\n\n";
      }
    };
    auto emitFieldPointer = [&](StringRef fromExpr,
                                const std::vector<std::string> &targets) {
      if (targets.empty()) {
        return;
      }
      emitted = true;
      out << "pointer {\n";
      out << "    from = " << fromExpr.str() << ";\n";
      out << "    to = ";
      for (size_t j = 0; j < targets.size(); ++j) {
        if (j != 0) {
          out << " | ";
        }
        out << targets[j];
      }
      out << ";\n";
      out << "    align = 0;\n";
      out << "}\n\n";
    };
    auto emitIndexedPointer = [&](StringRef fromPrefix,
                                  unsigned index,
                                  const std::vector<std::string> &targets,
                                  bool withSentinel) {
      if (targets.empty()) {
        return;
      }
      emitted = true;
      out << "pointer {\n";
      out << "    from = " << fromPrefix.str() << ".addr" << index << ";\n";
      out << "    to = ";
      for (size_t j = 0; j < targets.size(); ++j) {
        if (j != 0) {
          out << " | ";
        }
        out << targets[j];
      }
      out << ";\n";
      if (withSentinel) {
        out << "    sentinel = " << fromPrefix.str() << ".flags" << index
            << "[1] | " << fromPrefix.str() << ".flags" << index << "[4];\n";
      }
      out << "    align = 0;\n";
      out << "}\n\n";
    };

    std::vector<std::string> txTargets;
    std::vector<std::string> txHeaderTargets;
    std::vector<std::string> txFrameTargets;
    std::vector<std::string> txXdpTargets;
    std::vector<std::string> txSkbTargets;
    const std::vector<std::string> txBufTargets =
        collectTargets({"VIRTIO_NET_TX_BUF0"});
    const std::vector<std::string> rxFrameTargets =
        collectTargets({"arp_packet",
                        "ipv4_icmp_packet",
                        "ipv4_tcp_packet",
                        "ipv4_udp_packet",
                        "ipv6_fragment_packet",
                        "ipv6_icmpv6_packet",
                        "ipv6_tcp_packet",
                        "ipv6_udp_packet",
                        "vlan_arp_packet",
                        "vlan_ipv4_packet",
                        "vlan_ipv6_packet"});
    if (hasType("VIRTIO_NET_TX_VRING")) {
      txHeaderTargets = collectTargets(
          {"virtio_net_hdr_v1_hash_tunnel",
           "virtio_net_hdr"},
          "VIRTIO_NET_TX_BUF0");
      appendUnique(txHeaderTargets, collectTargetsByPrefixes({
                                         "virtio_net_hdr_v1_hash_tunnel_",
                                         "virtio_net_hdr_",
                                     }));
      txFrameTargets = collectTargets({"xdp_frame", "char"},
                                      "VIRTIO_NET_TX_BUF0");
      appendUnique(txFrameTargets, rxFrameTargets);
      txXdpTargets = collectTargets({"xdp_frame"});
      txSkbTargets = rxFrameTargets;
      txTargets = txHeaderTargets;
      appendUnique(txTargets, txFrameTargets);
      emitRange("VIRTIO_NET_TX_VRING", txBufTargets, false);
      emitRange("VIRTIO_NET_TX_VRING", txTargets, false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_2", 0, txHeaderTargets, false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_2", 1, txFrameTargets, false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_XDP_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_XDP_2", 0, txHeaderTargets,
                         false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_XDP_2", 1, txXdpTargets, false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_SKB_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_SKB_2", 0, txHeaderTargets,
                         false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_SKB_2", 1, txSkbTargets, false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_HDR12_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_HDR12_2", 0,
                         collectTargets({"virtio_net_hdr"}), false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_HDR12_2", 1, txFrameTargets,
                         false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_HDR24_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_HDR24_2", 0,
                         collectTargets({"virtio_net_hdr_v1_hash_tunnel"}),
                         false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_HDR24_2", 1, txFrameTargets,
                         false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_XDP_HDR12_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_XDP_HDR12_2", 0,
                         collectTargets({"virtio_net_hdr"}), false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_XDP_HDR12_2", 1, txXdpTargets,
                         false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_XDP_HDR24_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_XDP_HDR24_2", 0,
                         collectTargets({"virtio_net_hdr_v1_hash_tunnel"}),
                         false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_XDP_HDR24_2", 1, txXdpTargets,
                         false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_SKB_HDR12_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_SKB_HDR12_2", 0,
                         collectTargets({"virtio_net_hdr"}), false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_SKB_HDR12_2", 1, txSkbTargets,
                         false);
    }
    if (hasType("VIRTIO_NET_TX_CHAIN_SKB_HDR24_2")) {
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_SKB_HDR24_2", 0,
                         collectTargets({"virtio_net_hdr_v1_hash_tunnel"}),
                         false);
      emitIndexedPointer("VIRTIO_NET_TX_CHAIN_SKB_HDR24_2", 1, txSkbTargets,
                         false);
    }
    std::vector<std::string> rxTargets;
    std::vector<std::string> rxHeaderTargets;
    const std::vector<std::string> rxBufTargets =
        collectTargets({"VIRTIO_NET_RX_BUF0"});
    if (hasType("VIRTIO_NET_RX_VRING")) {
      rxHeaderTargets = collectTargets(
          {"virtio_net_hdr_mrg_rxbuf",
           "virtio_net_hdr",
           "char"},
          "VIRTIO_NET_RX_BUF0");
      appendUnique(rxHeaderTargets, collectTargetsByPrefixes({
                                         "virtio_net_hdr_mrg_rxbuf_",
                                         "virtio_net_hdr_",
                                     }));
      rxTargets = rxHeaderTargets;
      emitRange("VIRTIO_NET_RX_VRING", rxBufTargets, false);
      emitRange("VIRTIO_NET_RX_VRING", rxTargets, false);
    }
    if (hasType("VIRTIO_NET_RX_CHAIN_2")) {
      emitIndexedPointer("VIRTIO_NET_RX_CHAIN_2", 0, rxHeaderTargets, false);
      emitIndexedPointer("VIRTIO_NET_RX_CHAIN_2", 1, rxFrameTargets, false);
    }
    if (hasType("VIRTIO_NET_RX_CHAIN_LARGE_2")) {
      emitIndexedPointer("VIRTIO_NET_RX_CHAIN_LARGE_2", 0, rxHeaderTargets,
                         false);
      emitIndexedPointer("VIRTIO_NET_RX_CHAIN_LARGE_2", 1, rxFrameTargets,
                         false);
    }
    if (hasType("VIRTIO_NET_RX_CHAIN_SMALL_2")) {
      emitIndexedPointer("VIRTIO_NET_RX_CHAIN_SMALL_2", 0, rxHeaderTargets,
                         false);
      emitIndexedPointer("VIRTIO_NET_RX_CHAIN_SMALL_2", 1, rxFrameTargets,
                         false);
    }
    std::vector<std::string> ctrlTargets;
    const std::vector<std::string> ctrlBufTargets =
        collectTargets({"VIRTIO_NET_CTRL_BUF0"});
    std::vector<std::string> ctrlHeaderTargets;
    std::vector<std::string> ctrlOutTargets;
    std::vector<std::string> ctrlStatusTargets;
    std::vector<std::string> ctrlInTargets;
    std::vector<std::string> ctrlSlot1Targets;
    std::vector<std::string> ctrlSlot2Targets;
    if (hasType("VIRTIO_NET_CTRL_VRING")) {
      ctrlTargets = collectTargets(
          {"VIRTIO_NET_CTRL_CTRL_HDR_11",
           "VIRTIO_NET_CTRL_CTRL_HDR_2",
           "VIRTIO_NET_CTRL_CTRL_HDR_40",
           "VIRTIO_NET_CTRL_CTRL_HDR_41",
           "VIRTIO_NET_CTRL_CTRL_HDR_5",
           "VIRTIO_NET_CTRL_CTRL_HDR_COAL_RX",
           "VIRTIO_NET_CTRL_CTRL_HDR_COAL_TX",
           "VIRTIO_NET_CTRL_CTRL_HDR_COAL_VQ",
           "VIRTIO_NET_CTRL_CTRL_HDR_QUEUE_STATS",
           "virtio_net_ctrl_hdr",
           "virtio_net_ctrl_hdr_mac",
           "virtio_net_ctrl_hdr_vlan_add",
           "virtio_net_ctrl_hdr_vlan_del",
           "virtio_net_ctrl_hdr_mq",
           "virtio_net_ctrl_hdr_guest_offloads",
           "virtio_net_ctrl_hdr_coal_rx",
           "virtio_net_ctrl_hdr_coal_tx",
           "virtio_net_ctrl_hdr_coal_vq",
           "virtio_net_ctrl_hdr_queue_stats",
           "virtio_net_ctrl_status",
           "virtio_net_ctrl_vlan",
           "virtio_net_ctrl_mq",
           "virtio_net_ctrl_coal_rx",
           "virtio_net_ctrl_coal_tx",
           "virtio_net_ctrl_coal_vq",
           "virtio_net_ctrl_queue_stats",
           "virtio_net_guest_offloads",
           "virtio_net_rss_config_hdr",
           "virtio_net_rss_config_trailer",
           "virtio_net_stats_capabilities",
           "virtio_net_stats_reply_hdr",
           "virtio_net_stats_cvq",
           "virtio_net_stats_rx_basic",
           "virtio_net_stats_tx_basic",
           "virtio_net_stats_rx_csum",
           "virtio_net_stats_tx_csum",
           "virtio_net_stats_rx_gso",
           "virtio_net_stats_tx_gso",
           "virtio_net_stats_rx_speed",
           "virtio_net_stats_tx_speed"},
          "VIRTIO_NET_CTRL_BUF0");
      ctrlHeaderTargets = collectTargets({
          "VIRTIO_NET_CTRL_CTRL_HDR_11",
          "VIRTIO_NET_CTRL_CTRL_HDR_2",
          "VIRTIO_NET_CTRL_CTRL_HDR_40",
          "VIRTIO_NET_CTRL_CTRL_HDR_41",
          "VIRTIO_NET_CTRL_CTRL_HDR_5",
          "VIRTIO_NET_CTRL_CTRL_HDR_COAL_RX",
          "VIRTIO_NET_CTRL_CTRL_HDR_COAL_TX",
          "VIRTIO_NET_CTRL_CTRL_HDR_COAL_VQ",
          "VIRTIO_NET_CTRL_CTRL_HDR_QUEUE_STATS",
          "virtio_net_ctrl_hdr",
          "virtio_net_ctrl_hdr_mac",
          "virtio_net_ctrl_hdr_vlan_add",
          "virtio_net_ctrl_hdr_vlan_del",
          "virtio_net_ctrl_hdr_mq",
          "virtio_net_ctrl_hdr_guest_offloads",
          "virtio_net_ctrl_hdr_coal_rx",
          "virtio_net_ctrl_hdr_coal_tx",
          "virtio_net_ctrl_hdr_coal_vq",
          "virtio_net_ctrl_hdr_queue_stats",
      });
      appendUnique(ctrlHeaderTargets, collectTargetsByPrefixes({
                                            "virtio_net_ctrl_hdr_",
                                        }));
      appendUnique(ctrlTargets, ctrlHeaderTargets);
      ctrlOutTargets = collectTargets({
          "virtio_net_ctrl_mac_addr",
          "virtio_net_ctrl_vlan",
          "virtio_net_ctrl_mq",
          "virtio_net_ctrl_coal_rx",
          "virtio_net_ctrl_coal_tx",
          "virtio_net_ctrl_coal_vq",
          "virtio_net_ctrl_queue_stats",
          "virtio_net_guest_offloads",
          "virtio_net_rss_config_hdr",
          "virtio_net_rss_config_trailer",
      });
      appendUnique(ctrlOutTargets, collectTargetsByPrefixes({
                                         "virtio_net_ctrl_mac_addr_",
                                         "virtio_net_ctrl_vlan_",
                                         "virtio_net_ctrl_mq_",
                                         "virtio_net_ctrl_coal_",
                                         "virtio_net_ctrl_queue_stats_",
                                         "virtio_net_guest_offloads",
                                         "virtio_net_rss_config_",
                                     }));
      appendUnique(ctrlTargets, ctrlOutTargets);
      ctrlStatusTargets = collectTargets({
          "virtio_net_ctrl_status",
      });
      appendUnique(ctrlStatusTargets, collectTargetsByPrefixes({
                                            "virtio_net_ctrl_status_",
                                        }));
      appendUnique(ctrlTargets, ctrlStatusTargets);
      ctrlInTargets = collectTargets({
          "virtio_net_stats_capabilities",
          "virtio_net_stats_reply_hdr",
          "virtio_net_stats_cvq",
          "virtio_net_stats_rx_basic",
          "virtio_net_stats_tx_basic",
          "virtio_net_stats_rx_csum",
          "virtio_net_stats_tx_csum",
          "virtio_net_stats_rx_gso",
          "virtio_net_stats_tx_gso",
          "virtio_net_stats_rx_speed",
          "virtio_net_stats_tx_speed",
      });
      appendUnique(ctrlInTargets, collectTargetsByPrefixes({
                                        "virtio_net_stats_capabilities_",
                                        "virtio_net_stats_reply_hdr_",
                                        "virtio_net_stats_",
                                    }));
      appendUnique(ctrlTargets, ctrlInTargets);
      ctrlSlot1Targets = ctrlOutTargets;
      appendUnique(ctrlSlot1Targets, ctrlStatusTargets);
      ctrlSlot2Targets = ctrlStatusTargets;
      appendUnique(ctrlSlot2Targets, ctrlInTargets);
      emitIndexedPointer("VIRTIO_NET_CTRL_VRING", 0, ctrlBufTargets, true);
      emitIndexedPointer("VIRTIO_NET_CTRL_VRING", 1, ctrlBufTargets, true);
      emitIndexedPointer("VIRTIO_NET_CTRL_VRING", 2, ctrlBufTargets, true);
      emitIndexedPointer("VIRTIO_NET_CTRL_VRING", 3, ctrlBufTargets, true);
      emitIndexedPointer("VIRTIO_NET_CTRL_VRING", 0, ctrlHeaderTargets, true);
      emitIndexedPointer("VIRTIO_NET_CTRL_VRING", 1, ctrlSlot1Targets, true);
      emitIndexedPointer("VIRTIO_NET_CTRL_VRING", 2, ctrlSlot2Targets, true);
      emitIndexedPointer("VIRTIO_NET_CTRL_VRING", 3, ctrlInTargets, true);
    }
    auto emitRolePointers = [&](StringRef base,
                                const std::vector<std::string> &bufTargets,
                                const std::vector<std::string> &dataTargets) {
      const std::string baseName = base.str();
      emitFieldPointer(baseName + ".addr", bufTargets);
      emitFieldPointer(baseName + "_addr_only.addr", bufTargets);
      emitFieldPointer(baseName + ".addr", dataTargets);
      emitFieldPointer(baseName + "_addr_only.addr", dataTargets);
    };
    if (hasType("vring_desc_tx")) {
      emitRolePointers("vring_desc_tx", txBufTargets, txTargets);
    }
    if (hasType("vring_desc_tx_hdr")) {
      emitRolePointers("vring_desc_tx_hdr", txBufTargets, txHeaderTargets);
    }
    if (hasType("vring_desc_tx_hdr_plain")) {
      emitRolePointers("vring_desc_tx_hdr_plain", txBufTargets,
                       collectTargets({"virtio_net_hdr"}));
    }
    if (hasType("vring_desc_tx_hdr_hash_tunnel")) {
      emitRolePointers("vring_desc_tx_hdr_hash_tunnel", txBufTargets,
                       collectTargets({"virtio_net_hdr_v1_hash_tunnel"}));
    }
    if (hasType("vring_desc_tx_frame")) {
      emitRolePointers("vring_desc_tx_frame", txBufTargets, txFrameTargets);
    }
    if (hasType("vring_desc_tx_frame_xdp")) {
      emitRolePointers("vring_desc_tx_frame_xdp", txBufTargets,
                       collectTargets({"xdp_frame"}));
    }
    if (hasType("vring_desc_tx_frame_skb")) {
      emitRolePointers("vring_desc_tx_frame_skb", txBufTargets, txFrameTargets);
    }
    if (hasType("vring_desc_rx")) {
      std::vector<std::string> rxRoleTargets = rxTargets;
      appendUnique(rxRoleTargets, rxFrameTargets);
      emitRolePointers("vring_desc_rx", rxBufTargets, rxRoleTargets);
    }
    if (hasType("vring_desc_rx_hdr")) {
      emitRolePointers("vring_desc_rx_hdr", rxBufTargets, rxHeaderTargets);
    }
    if (hasType("vring_desc_rx_frame")) {
      emitRolePointers("vring_desc_rx_frame", rxBufTargets, rxFrameTargets);
    }
    if (hasType("vring_desc_rx_frame_large")) {
      emitRolePointers("vring_desc_rx_frame_large", rxBufTargets,
                       rxFrameTargets);
    }
    if (hasType("vring_desc_rx_frame_small")) {
      emitRolePointers("vring_desc_rx_frame_small", rxBufTargets,
                       rxFrameTargets);
    }
    if (hasType("vring_desc_ctrl_cmd")) {
      emitRolePointers("vring_desc_ctrl_cmd", ctrlBufTargets, ctrlHeaderTargets);
      emitRolePointers("vring_desc_ctrl_cmd", ctrlBufTargets, ctrlSlot1Targets);
    }
    if (hasType("vring_desc_ctrl_stats")) {
      emitRolePointers("vring_desc_ctrl_stats", ctrlBufTargets, ctrlSlot2Targets);
      emitRolePointers("vring_desc_ctrl_stats", ctrlBufTargets, ctrlInTargets);
    }
    if (hasType("vring_packed_desc_tx")) {
      emitRolePointers("vring_packed_desc_tx", txBufTargets, txTargets);
    }
    if (hasType("vring_packed_desc_tx_hdr")) {
      emitRolePointers("vring_packed_desc_tx_hdr", txBufTargets,
                       txHeaderTargets);
    }
    if (hasType("vring_packed_desc_tx_hdr_plain")) {
      emitRolePointers("vring_packed_desc_tx_hdr_plain", txBufTargets,
                       collectTargets({"virtio_net_hdr"}));
    }
    if (hasType("vring_packed_desc_tx_hdr_hash_tunnel")) {
      emitRolePointers("vring_packed_desc_tx_hdr_hash_tunnel", txBufTargets,
                       collectTargets({"virtio_net_hdr_v1_hash_tunnel"}));
    }
    if (hasType("vring_packed_desc_tx_frame")) {
      emitRolePointers("vring_packed_desc_tx_frame", txBufTargets,
                       txFrameTargets);
    }
    if (hasType("vring_packed_desc_rx")) {
      std::vector<std::string> rxRoleTargets = rxTargets;
      appendUnique(rxRoleTargets, rxFrameTargets);
      emitRolePointers("vring_packed_desc_rx", rxBufTargets, rxRoleTargets);
    }
    if (hasType("vring_packed_desc_rx_hdr")) {
      emitRolePointers("vring_packed_desc_rx_hdr", rxBufTargets,
                       rxHeaderTargets);
    }
    if (hasType("vring_packed_desc_rx_frame")) {
      emitRolePointers("vring_packed_desc_rx_frame", rxBufTargets,
                       rxFrameTargets);
    }
    if (hasType("vring_packed_desc_ctrl_cmd")) {
      emitRolePointers("vring_packed_desc_ctrl_cmd", ctrlBufTargets,
                       ctrlHeaderTargets);
      emitRolePointers("vring_packed_desc_ctrl_cmd", ctrlBufTargets,
                       ctrlSlot1Targets);
    }
    if (hasType("vring_packed_desc_ctrl_stats")) {
      emitRolePointers("vring_packed_desc_ctrl_stats", ctrlBufTargets,
                       ctrlSlot2Targets);
      emitRolePointers("vring_packed_desc_ctrl_stats", ctrlBufTargets,
                       ctrlInTargets);
    }
    if (hasType("vring_desc_extra_tx")) {
      emitRolePointers("vring_desc_extra_tx", txBufTargets, txTargets);
    }
    if (hasType("vring_desc_extra_tx_hdr")) {
      emitRolePointers("vring_desc_extra_tx_hdr", txBufTargets,
                       txHeaderTargets);
    }
    if (hasType("vring_desc_extra_tx_hdr_plain")) {
      emitRolePointers("vring_desc_extra_tx_hdr_plain", txBufTargets,
                       collectTargets({"virtio_net_hdr"}));
    }
    if (hasType("vring_desc_extra_tx_hdr_hash_tunnel")) {
      emitRolePointers("vring_desc_extra_tx_hdr_hash_tunnel", txBufTargets,
                       collectTargets({"virtio_net_hdr_v1_hash_tunnel"}));
    }
    if (hasType("vring_desc_extra_tx_frame")) {
      emitRolePointers("vring_desc_extra_tx_frame", txBufTargets,
                       txFrameTargets);
    }
    if (hasType("vring_desc_extra_rx")) {
      std::vector<std::string> rxRoleTargets = rxTargets;
      appendUnique(rxRoleTargets, rxFrameTargets);
      emitRolePointers("vring_desc_extra_rx", rxBufTargets, rxRoleTargets);
    }
    if (hasType("vring_desc_extra_rx_hdr")) {
      emitRolePointers("vring_desc_extra_rx_hdr", rxBufTargets,
                       rxHeaderTargets);
    }
    if (hasType("vring_desc_extra_rx_frame")) {
      emitRolePointers("vring_desc_extra_rx_frame", rxBufTargets,
                       rxFrameTargets);
    }
    if (hasType("vring_desc_extra_ctrl_cmd")) {
      emitRolePointers("vring_desc_extra_ctrl_cmd", ctrlBufTargets,
                       ctrlHeaderTargets);
      emitRolePointers("vring_desc_extra_ctrl_cmd", ctrlBufTargets,
                       ctrlSlot1Targets);
    }
    if (hasType("vring_desc_extra_ctrl_stats")) {
      emitRolePointers("vring_desc_extra_ctrl_stats", ctrlBufTargets,
                       ctrlSlot2Targets);
      emitRolePointers("vring_desc_extra_ctrl_stats", ctrlBufTargets,
                       ctrlInTargets);
    }
    if (hasType("virtnet_rq_dma")) {
      std::vector<std::string> rqTargets;
      appendUnique(rqTargets, rxTargets);
      appendUnique(rqTargets, rxFrameTargets);
      emitFieldPointer("virtnet_rq_dma.addr",
                       collectTargets({"VIRTIO_NET_RX_BUF0"}));
      emitFieldPointer("virtnet_rq_dma_addr_only.addr",
                       collectTargets({"VIRTIO_NET_RX_BUF0"}));
      emitFieldPointer("virtnet_rq_dma.addr", rxTargets);
      emitFieldPointer("virtnet_rq_dma_addr_only.addr", rxTargets);
      emitFieldPointer("virtnet_rq_dma.addr", rxFrameTargets);
      emitFieldPointer("virtnet_rq_dma_addr_only.addr", rxFrameTargets);
      emitFieldPointer("virtnet_rq_dma.addr", rqTargets);
      emitFieldPointer("virtnet_rq_dma_addr_only.addr", rqTargets);
    }

    if (!emitted) {
      return std::nullopt;
    }
    return out.str();
  }

  static void expandDerivedDmaSchemaTypes(
      std::set<std::string> &schemaTypes,
      std::map<std::string, std::set<std::string>> &schemaHeadPositions,
      const std::map<std::string, std::set<std::string>> &schemaObservedFields,
      std::map<std::string, std::set<uint64_t>> &schemaLengthImmediates) {
    auto extractField = [](const std::string &position,
                           const std::string &key) -> std::string {
      const std::string needle = key + " = ";
      size_t start = position.find(needle);
      if (start == std::string::npos) {
        return "";
      }
      start += needle.size();
      size_t end = position.find(';', start);
      if (end == std::string::npos) {
        end = position.find(']', start);
      }
      if (end == std::string::npos) {
        return "";
      }
      return position.substr(start, end - start);
    };
    auto classifyVirtioNetQueueRole = [&](const std::string &position) {
      const std::string callerValue = extractField(position, "caller");
      const std::string calleeValue = extractField(position, "callee");
      const StringRef caller(callerValue);
      const StringRef callee(calleeValue);
      if (callee == "this_is_a_stub_for_virtio_net_tx" ||
          caller.contains("xmit") || caller.contains("outbuf") ||
          caller.contains("virtnet_add_outbuf")) {
        return std::string("tx");
      }
      if (callee == "this_is_a_stub_for_virtio_net_rx" ||
          caller.contains("recv") || caller.contains("fill_recv") ||
          caller.contains("add_recvbuf") || caller.contains("rx_") ||
          caller.contains("remove_vq_common") ||
          caller.contains("free_unused_bufs")) {
        return std::string("rx");
      }
      if (callee == "this_is_a_stub_for_virtio_net_ctrl" ||
          caller.contains("send_command") ||
          caller.contains("get_hw_stats")) {
        if (caller.contains("get_hw_stats")) {
          return std::string("ctrl_stats");
        }
        return std::string("ctrl_cmd");
      }
      return std::string();
    };
    static const std::pair<std::string, std::vector<std::string>> alwaysDerived[] = {
        {"vring_desc",
         {"vring_desc_addr_only",
          "vring_desc_len_only",
          "vring_desc_flags_only",
          "vring_desc_next_only"}},
        {"vring_packed_desc",
         {"vring_packed_desc_addr_only",
          "vring_packed_desc_len_only",
          "vring_packed_desc_flags_only",
          "vring_packed_desc_next_only"}},
        {"vring_desc_extra",
         {"vring_desc_extra_addr_only",
          "vring_desc_extra_len_only",
          "vring_desc_extra_flags_only",
          "vring_desc_extra_next_only"}},
        {"virtnet_rq_dma",
         {"virtnet_rq_dma_addr_only",
          "virtnet_rq_dma_ref_only",
          "virtnet_rq_dma_len_only",
          "virtnet_rq_dma_need_sync_only"}},
    };
    for (const auto &[parent, children] : alwaysDerived) {
      const std::string parentToken = sanitizeToken(parent);
      if (schemaTypes.find(parentToken) == schemaTypes.end()) {
        continue;
      }
      const auto posIt = schemaHeadPositions.find(parentToken);
      for (const std::string &child : children) {
        const std::string childToken = sanitizeToken(child);
        schemaTypes.insert(childToken);
        if (posIt != schemaHeadPositions.end()) {
          auto &childPositions = schemaHeadPositions[childToken];
          childPositions.insert(posIt->second.begin(), posIt->second.end());
        }
      }
    }
    static const std::pair<std::string, std::vector<std::pair<std::string, std::vector<std::string>>>>
        roleDerived[] = {
            {"vring_desc",
             {{"vring_desc_tx",
               {"vring_desc_tx_addr_only", "vring_desc_tx_len_only",
                "vring_desc_tx_flags_only", "vring_desc_tx_next_only"}},
              {"vring_desc_rx",
               {"vring_desc_rx_addr_only", "vring_desc_rx_len_only",
                "vring_desc_rx_flags_only", "vring_desc_rx_next_only"}},
              {"vring_desc_ctrl_cmd",
               {"vring_desc_ctrl_cmd_addr_only",
                "vring_desc_ctrl_cmd_len_only",
                "vring_desc_ctrl_cmd_flags_only",
                "vring_desc_ctrl_cmd_next_only"}},
              {"vring_desc_ctrl_stats",
               {"vring_desc_ctrl_stats_addr_only",
                "vring_desc_ctrl_stats_len_only",
                "vring_desc_ctrl_stats_flags_only",
                "vring_desc_ctrl_stats_next_only"}}}},
            {"vring_packed_desc",
             {{"vring_packed_desc_tx",
               {"vring_packed_desc_tx_addr_only",
                "vring_packed_desc_tx_len_only",
                "vring_packed_desc_tx_flags_only",
                "vring_packed_desc_tx_next_only"}},
              {"vring_packed_desc_rx",
               {"vring_packed_desc_rx_addr_only",
                "vring_packed_desc_rx_len_only",
                "vring_packed_desc_rx_flags_only",
                "vring_packed_desc_rx_next_only"}},
              {"vring_packed_desc_ctrl_cmd",
               {"vring_packed_desc_ctrl_cmd_addr_only",
                "vring_packed_desc_ctrl_cmd_len_only",
                "vring_packed_desc_ctrl_cmd_flags_only",
                "vring_packed_desc_ctrl_cmd_next_only"}},
              {"vring_packed_desc_ctrl_stats",
               {"vring_packed_desc_ctrl_stats_addr_only",
                "vring_packed_desc_ctrl_stats_len_only",
                "vring_packed_desc_ctrl_stats_flags_only",
                "vring_packed_desc_ctrl_stats_next_only"}}}},
            {"vring_desc_extra",
             {{"vring_desc_extra_tx",
               {"vring_desc_extra_tx_addr_only", "vring_desc_extra_tx_len_only",
                "vring_desc_extra_tx_flags_only",
                "vring_desc_extra_tx_next_only"}},
              {"vring_desc_extra_rx",
               {"vring_desc_extra_rx_addr_only", "vring_desc_extra_rx_len_only",
                "vring_desc_extra_rx_flags_only",
                "vring_desc_extra_rx_next_only"}},
              {"vring_desc_extra_ctrl_cmd",
               {"vring_desc_extra_ctrl_cmd_addr_only",
                "vring_desc_extra_ctrl_cmd_len_only",
                "vring_desc_extra_ctrl_cmd_flags_only",
                "vring_desc_extra_ctrl_cmd_next_only"}},
              {"vring_desc_extra_ctrl_stats",
               {"vring_desc_extra_ctrl_stats_addr_only",
                "vring_desc_extra_ctrl_stats_len_only",
                "vring_desc_extra_ctrl_stats_flags_only",
                "vring_desc_extra_ctrl_stats_next_only"}}}},
        };
    for (const auto &[parent, roles] : roleDerived) {
      const std::string parentToken = sanitizeToken(parent);
      auto posIt = schemaHeadPositions.find(parentToken);
      if (schemaTypes.find(parentToken) == schemaTypes.end() &&
          posIt == schemaHeadPositions.end()) {
        continue;
      }
      std::map<std::string, std::set<std::string>> rolePositions;
      if (posIt != schemaHeadPositions.end()) {
        for (const std::string &position : posIt->second) {
          const std::string role = classifyVirtioNetQueueRole(position);
          if (!role.empty()) {
            rolePositions[role].insert(position);
          }
        }
      }
      auto appendSemanticPositions = [&](StringRef schemaName, StringRef role) {
        auto semanticIt = schemaHeadPositions.find(sanitizeToken(schemaName));
        if (semanticIt == schemaHeadPositions.end()) {
          return;
        }
        auto &bucket = rolePositions[role.str()];
        bucket.insert(semanticIt->second.begin(), semanticIt->second.end());
      };
      appendSemanticPositions("VIRTIO_NET_TX_VRING", "tx");
      appendSemanticPositions("VIRTIO_NET_RX_VRING", "rx");
      appendSemanticPositions("VIRTIO_NET_CTRL_VRING", "ctrl_cmd");
      appendSemanticPositions("VIRTIO_NET_CTRL_VRING", "ctrl_stats");
      for (const auto &[child, grandchildren] : roles) {
        std::string role;
        if (StringRef(child).endswith("_tx")) {
          role = "tx";
        } else if (StringRef(child).endswith("_rx")) {
          role = "rx";
        } else if (StringRef(child).endswith("_ctrl_cmd")) {
          role = "ctrl_cmd";
        } else if (StringRef(child).endswith("_ctrl_stats")) {
          role = "ctrl_stats";
        }
        auto roleIt = rolePositions.find(role);
        if (roleIt == rolePositions.end() || roleIt->second.empty()) {
          continue;
        }
        const std::string childToken = sanitizeToken(child);
        schemaTypes.insert(childToken);
        auto &childPositions = schemaHeadPositions[childToken];
        childPositions.insert(roleIt->second.begin(), roleIt->second.end());
        for (const std::string &grandchild : grandchildren) {
          const std::string grandchildToken = sanitizeToken(grandchild);
          schemaTypes.insert(grandchildToken);
          auto &grandchildPositions = schemaHeadPositions[grandchildToken];
          grandchildPositions.insert(roleIt->second.begin(), roleIt->second.end());
        }
      }
    }
    static const std::pair<std::string, std::vector<std::pair<std::string, std::vector<std::string>>>>
        slotDerived[] = {
            {"vring_desc_rx",
             {{"vring_desc_rx_hdr",
               {"vring_desc_rx_hdr_addr_only", "vring_desc_rx_hdr_len_only",
                "vring_desc_rx_hdr_flags_only", "vring_desc_rx_hdr_next_only"}},
              {"vring_desc_rx_frame_large",
               {"vring_desc_rx_frame_large_addr_only",
                "vring_desc_rx_frame_large_len_only",
                "vring_desc_rx_frame_large_flags_only",
                "vring_desc_rx_frame_large_next_only"}},
              {"vring_desc_rx_frame_small",
               {"vring_desc_rx_frame_small_addr_only",
                "vring_desc_rx_frame_small_len_only",
                "vring_desc_rx_frame_small_flags_only",
                "vring_desc_rx_frame_small_next_only"}},
              {"vring_desc_rx_frame",
               {"vring_desc_rx_frame_addr_only",
                "vring_desc_rx_frame_len_only",
                "vring_desc_rx_frame_flags_only",
                "vring_desc_rx_frame_next_only"}}}},
            {"vring_packed_desc_rx",
             {{"vring_packed_desc_rx_hdr",
               {"vring_packed_desc_rx_hdr_addr_only",
                "vring_packed_desc_rx_hdr_len_only",
                "vring_packed_desc_rx_hdr_flags_only",
                "vring_packed_desc_rx_hdr_next_only"}},
              {"vring_packed_desc_rx_frame",
               {"vring_packed_desc_rx_frame_addr_only",
                "vring_packed_desc_rx_frame_len_only",
                "vring_packed_desc_rx_frame_flags_only",
                "vring_packed_desc_rx_frame_next_only"}}}},
            {"vring_desc_extra_rx",
             {{"vring_desc_extra_rx_hdr",
               {"vring_desc_extra_rx_hdr_addr_only",
                "vring_desc_extra_rx_hdr_len_only",
                "vring_desc_extra_rx_hdr_flags_only",
                "vring_desc_extra_rx_hdr_next_only"}},
              {"vring_desc_extra_rx_frame",
               {"vring_desc_extra_rx_frame_addr_only",
                "vring_desc_extra_rx_frame_len_only",
                "vring_desc_extra_rx_frame_flags_only",
                "vring_desc_extra_rx_frame_next_only"}}}},
            {"vring_desc_tx",
             {{"vring_desc_tx_hdr",
               {"vring_desc_tx_hdr_addr_only", "vring_desc_tx_hdr_len_only",
                "vring_desc_tx_hdr_flags_only", "vring_desc_tx_hdr_next_only"}},
              {"vring_desc_tx_hdr_plain",
               {"vring_desc_tx_hdr_plain_addr_only",
                "vring_desc_tx_hdr_plain_len_only",
                "vring_desc_tx_hdr_plain_flags_only",
                "vring_desc_tx_hdr_plain_next_only"}},
              {"vring_desc_tx_hdr_hash_tunnel",
               {"vring_desc_tx_hdr_hash_tunnel_addr_only",
                "vring_desc_tx_hdr_hash_tunnel_len_only",
                "vring_desc_tx_hdr_hash_tunnel_flags_only",
                "vring_desc_tx_hdr_hash_tunnel_next_only"}},
              {"vring_desc_tx_frame_xdp",
               {"vring_desc_tx_frame_xdp_addr_only",
                "vring_desc_tx_frame_xdp_len_only",
                "vring_desc_tx_frame_xdp_flags_only",
                "vring_desc_tx_frame_xdp_next_only"}},
              {"vring_desc_tx_frame_skb",
               {"vring_desc_tx_frame_skb_addr_only",
                "vring_desc_tx_frame_skb_len_only",
                "vring_desc_tx_frame_skb_flags_only",
                "vring_desc_tx_frame_skb_next_only"}},
              {"vring_desc_tx_frame",
               {"vring_desc_tx_frame_addr_only",
                "vring_desc_tx_frame_len_only",
                "vring_desc_tx_frame_flags_only",
                "vring_desc_tx_frame_next_only"}}}},
            {"vring_packed_desc_tx",
             {{"vring_packed_desc_tx_hdr",
               {"vring_packed_desc_tx_hdr_addr_only",
                "vring_packed_desc_tx_hdr_len_only",
                "vring_packed_desc_tx_hdr_flags_only",
                "vring_packed_desc_tx_hdr_next_only"}},
              {"vring_packed_desc_tx_hdr_plain",
               {"vring_packed_desc_tx_hdr_plain_addr_only",
                "vring_packed_desc_tx_hdr_plain_len_only",
                "vring_packed_desc_tx_hdr_plain_flags_only",
                "vring_packed_desc_tx_hdr_plain_next_only"}},
              {"vring_packed_desc_tx_hdr_hash_tunnel",
               {"vring_packed_desc_tx_hdr_hash_tunnel_addr_only",
                "vring_packed_desc_tx_hdr_hash_tunnel_len_only",
                "vring_packed_desc_tx_hdr_hash_tunnel_flags_only",
                "vring_packed_desc_tx_hdr_hash_tunnel_next_only"}},
              {"vring_packed_desc_tx_frame",
               {"vring_packed_desc_tx_frame_addr_only",
                "vring_packed_desc_tx_frame_len_only",
                "vring_packed_desc_tx_frame_flags_only",
                "vring_packed_desc_tx_frame_next_only"}}}},
            {"vring_desc_extra_tx",
             {{"vring_desc_extra_tx_hdr",
               {"vring_desc_extra_tx_hdr_addr_only",
                "vring_desc_extra_tx_hdr_len_only",
                "vring_desc_extra_tx_hdr_flags_only",
                "vring_desc_extra_tx_hdr_next_only"}},
              {"vring_desc_extra_tx_hdr_plain",
               {"vring_desc_extra_tx_hdr_plain_addr_only",
                "vring_desc_extra_tx_hdr_plain_len_only",
                "vring_desc_extra_tx_hdr_plain_flags_only",
                "vring_desc_extra_tx_hdr_plain_next_only"}},
              {"vring_desc_extra_tx_hdr_hash_tunnel",
               {"vring_desc_extra_tx_hdr_hash_tunnel_addr_only",
                "vring_desc_extra_tx_hdr_hash_tunnel_len_only",
                "vring_desc_extra_tx_hdr_hash_tunnel_flags_only",
                "vring_desc_extra_tx_hdr_hash_tunnel_next_only"}},
              {"vring_desc_extra_tx_frame",
               {"vring_desc_extra_tx_frame_addr_only",
                "vring_desc_extra_tx_frame_len_only",
                "vring_desc_extra_tx_frame_flags_only",
                "vring_desc_extra_tx_frame_next_only"}}}},
        };
    auto propagateDescriptorLengthBuckets =
        [&](StringRef vringToken,
            StringRef hdrToken,
            StringRef frameToken) {
          auto vringIt = schemaLengthImmediates.find(sanitizeToken(vringToken));
          if (vringIt == schemaLengthImmediates.end()) {
            return;
          }
          std::set<uint64_t> headerLens;
          if (auto len = schemaAwarePayloadSize("virtio_net_hdr",
                                                schemaLengthImmediates)) {
            headerLens.insert(*len);
          }
          if (auto len = schemaAwarePayloadSize("virtio_net_hdr_mrg_rxbuf",
                                                schemaLengthImmediates)) {
            headerLens.insert(*len);
          }
          if (auto len = schemaAwarePayloadSize("virtio_net_hdr_v1_hash_tunnel",
                                                schemaLengthImmediates)) {
            headerLens.insert(*len);
          }
          for (uint64_t value : vringIt->second) {
            if (headerLens.find(value) != headerLens.end()) {
              schemaLengthImmediates[sanitizeToken(hdrToken)].insert(value);
            } else {
              schemaLengthImmediates[sanitizeToken(frameToken)].insert(value);
            }
          }
        };
    auto unionInto = [&](StringRef dst,
                         std::initializer_list<StringRef> sources) {
      auto &dstSet = schemaLengthImmediates[sanitizeToken(dst)];
      for (StringRef source : sources) {
        auto it = schemaLengthImmediates.find(sanitizeToken(source));
        if (it == schemaLengthImmediates.end()) {
          continue;
        }
        dstSet.insert(it->second.begin(), it->second.end());
      }
    };
    propagateDescriptorLengthBuckets("VIRTIO_NET_RX_VRING", "vring_desc_rx_hdr",
                                     "vring_desc_rx_frame");
    propagateDescriptorLengthBuckets("VIRTIO_NET_RX_VRING",
                                     "vring_packed_desc_rx_hdr",
                                     "vring_packed_desc_rx_frame");
    propagateDescriptorLengthBuckets("VIRTIO_NET_RX_VRING",
                                     "vring_desc_extra_rx_hdr",
                                     "vring_desc_extra_rx_frame");
    propagateDescriptorLengthBuckets("VIRTIO_NET_TX_VRING", "vring_desc_tx_hdr",
                                     "vring_desc_tx_frame");
    propagateDescriptorLengthBuckets("VIRTIO_NET_TX_VRING",
                                     "vring_packed_desc_tx_hdr",
                                     "vring_packed_desc_tx_frame");
    propagateDescriptorLengthBuckets("VIRTIO_NET_TX_VRING",
                                     "vring_desc_extra_tx_hdr",
                                     "vring_desc_extra_tx_frame");
    unionInto("VIRTIO_NET_TX_VRING",
              {"vring_desc_tx_hdr", "vring_desc_tx_frame",
               "vring_packed_desc_tx_hdr", "vring_packed_desc_tx_frame",
               "vring_desc_extra_tx_hdr", "vring_desc_extra_tx_frame"});
    unionInto("VIRTIO_NET_RX_VRING",
              {"vring_desc_rx_hdr", "vring_desc_rx_frame",
               "vring_packed_desc_rx_hdr", "vring_packed_desc_rx_frame",
               "vring_desc_extra_rx_hdr", "vring_desc_extra_rx_frame"});
    auto maybeDeriveChain = [&](StringRef chainName,
                                StringRef headSource,
                                StringRef hdrSource,
                                StringRef frameSource) {
      auto headIt = schemaHeadPositions.find(sanitizeToken(headSource));
      auto hdrIt = schemaLengthImmediates.find(sanitizeToken(hdrSource));
      auto frameIt = schemaLengthImmediates.find(sanitizeToken(frameSource));
      if (headIt == schemaHeadPositions.end() || hdrIt == schemaLengthImmediates.end() ||
          frameIt == schemaLengthImmediates.end() || hdrIt->second.empty() ||
          frameIt->second.empty()) {
        return;
      }
      const std::string chainToken = sanitizeToken(chainName);
      schemaTypes.insert(chainToken);
      auto &positions = schemaHeadPositions[chainToken];
      positions.insert(headIt->second.begin(), headIt->second.end());
    };
    auto maybeDeriveChainFiltered = [&](StringRef chainName,
                                        StringRef headSource,
                                        StringRef hdrSource,
                                        StringRef frameSource,
                                        std::initializer_list<StringRef> callerMatches) {
      auto headIt = schemaHeadPositions.find(sanitizeToken(headSource));
      auto hdrIt = schemaLengthImmediates.find(sanitizeToken(hdrSource));
      auto frameIt = schemaLengthImmediates.find(sanitizeToken(frameSource));
      if (headIt == schemaHeadPositions.end() ||
          hdrIt == schemaLengthImmediates.end() ||
          frameIt == schemaLengthImmediates.end() || hdrIt->second.empty() ||
          frameIt->second.empty()) {
        return;
      }
      std::set<std::string> filtered;
      for (const std::string &position : headIt->second) {
        const std::string caller = extractField(position, "caller");
        for (StringRef token : callerMatches) {
          if (StringRef(caller).contains(token)) {
            filtered.insert(position);
            break;
          }
        }
      }
      if (filtered.empty()) {
        return;
      }
      const std::string chainToken = sanitizeToken(chainName);
      schemaTypes.insert(chainToken);
      auto &positions = schemaHeadPositions[chainToken];
      positions.insert(filtered.begin(), filtered.end());
    };
    maybeDeriveChain("VIRTIO_NET_TX_CHAIN_2", "VIRTIO_NET_TX_VRING",
                     "vring_desc_tx_hdr", "vring_desc_tx_frame");
    maybeDeriveChainFiltered("VIRTIO_NET_TX_CHAIN_XDP_2",
                             "VIRTIO_NET_TX_VRING", "vring_desc_tx_hdr",
                             "vring_desc_tx_frame_xdp",
                             {"__virtnet_xdp_xmit_one"});
    maybeDeriveChainFiltered("VIRTIO_NET_TX_CHAIN_SKB_2",
                             "VIRTIO_NET_TX_VRING", "vring_desc_tx_hdr",
                             "vring_desc_tx_frame_skb",
                             {"xmit_skb"});
    maybeDeriveChain("VIRTIO_NET_TX_CHAIN_HDR12_2", "VIRTIO_NET_TX_VRING",
                     "vring_desc_tx_hdr_plain", "vring_desc_tx_frame");
    maybeDeriveChain("VIRTIO_NET_TX_CHAIN_HDR24_2", "VIRTIO_NET_TX_VRING",
                     "vring_desc_tx_hdr_hash_tunnel", "vring_desc_tx_frame");
    maybeDeriveChainFiltered("VIRTIO_NET_TX_CHAIN_XDP_HDR12_2",
                             "VIRTIO_NET_TX_VRING", "vring_desc_tx_hdr_plain",
                             "vring_desc_tx_frame_xdp",
                             {"__virtnet_xdp_xmit_one"});
    maybeDeriveChainFiltered("VIRTIO_NET_TX_CHAIN_XDP_HDR24_2",
                             "VIRTIO_NET_TX_VRING",
                             "vring_desc_tx_hdr_hash_tunnel",
                             "vring_desc_tx_frame_xdp",
                             {"__virtnet_xdp_xmit_one"});
    maybeDeriveChainFiltered("VIRTIO_NET_TX_CHAIN_SKB_HDR12_2",
                             "VIRTIO_NET_TX_VRING", "vring_desc_tx_hdr_plain",
                             "vring_desc_tx_frame_skb",
                             {"xmit_skb"});
    maybeDeriveChainFiltered("VIRTIO_NET_TX_CHAIN_SKB_HDR24_2",
                             "VIRTIO_NET_TX_VRING",
                             "vring_desc_tx_hdr_hash_tunnel",
                             "vring_desc_tx_frame_skb",
                             {"xmit_skb"});
    maybeDeriveChain("VIRTIO_NET_RX_CHAIN_2", "VIRTIO_NET_RX_VRING",
                     "vring_desc_rx_hdr", "vring_desc_rx_frame");
    maybeDeriveChainFiltered("VIRTIO_NET_RX_CHAIN_LARGE_2",
                             "VIRTIO_NET_RX_VRING", "vring_desc_rx_hdr",
                             "vring_desc_rx_frame_large",
                             {"add_recvbuf_big", "add_recvbuf_mergeable"});
    maybeDeriveChainFiltered("VIRTIO_NET_RX_CHAIN_SMALL_2",
                             "VIRTIO_NET_RX_VRING", "vring_desc_rx_hdr",
                             "vring_desc_rx_frame_small",
                             {"add_recvbuf_small"});
    for (const auto &[parent, roles] : slotDerived) {
      const std::string parentToken = sanitizeToken(parent);
      if (schemaTypes.find(parentToken) == schemaTypes.end()) {
        continue;
      }
      auto posIt = schemaHeadPositions.find(parentToken);
      if (posIt == schemaHeadPositions.end()) {
        continue;
      }
      for (const auto &[child, grandchildren] : roles) {
        const std::string childToken = sanitizeToken(child);
        auto lenIt = schemaLengthImmediates.find(childToken);
        if (lenIt == schemaLengthImmediates.end() || lenIt->second.empty()) {
          continue;
        }
        schemaTypes.insert(childToken);
        auto &childPositions = schemaHeadPositions[childToken];
        childPositions.insert(posIt->second.begin(), posIt->second.end());
        for (const std::string &grandchild : grandchildren) {
          const std::string grandchildToken = sanitizeToken(grandchild);
          schemaTypes.insert(grandchildToken);
          auto &grandchildPositions = schemaHeadPositions[grandchildToken];
          grandchildPositions.insert(posIt->second.begin(), posIt->second.end());
        }
      }
    }
    auto maybeDeriveObserved = [&](StringRef parent,
                                   StringRef fieldPrefix,
                                   StringRef child) {
      const std::string parentToken = sanitizeToken(parent);
      if (schemaTypes.find(parentToken) == schemaTypes.end()) {
        return;
      }
      auto observedIt = schemaObservedFields.find(parentToken);
      if (observedIt == schemaObservedFields.end()) {
        return;
      }
      bool seen = false;
      for (const std::string &field : observedIt->second) {
        if (StringRef(field).startswith(fieldPrefix)) {
          seen = true;
          break;
        }
      }
      if (!seen) {
        return;
      }
      const std::string childToken = sanitizeToken(child);
      schemaTypes.insert(childToken);
      auto posIt = schemaHeadPositions.find(parentToken);
      if (posIt != schemaHeadPositions.end()) {
        auto &childPositions = schemaHeadPositions[childToken];
        childPositions.insert(posIt->second.begin(), posIt->second.end());
      }
    };
    maybeDeriveObserved("virtio_net_hdr", "virtio_net_hdr__flags",
                        "virtio_net_hdr_flags_only");
    maybeDeriveObserved("virtio_net_hdr", "virtio_net_hdr__gso_type",
                        "virtio_net_hdr_gso_type_only");
    maybeDeriveObserved("virtio_net_hdr", "virtio_net_hdr__hdr_len",
                        "virtio_net_hdr_hdr_len_only");
    maybeDeriveObserved("virtio_net_hdr", "virtio_net_hdr__gso_size",
                        "virtio_net_hdr_gso_size_only");
    maybeDeriveObserved("virtio_net_hdr", "virtio_net_hdr__csum_start",
                        "virtio_net_hdr_csum_start_only");
    maybeDeriveObserved("virtio_net_hdr", "virtio_net_hdr__csum_offset",
                        "virtio_net_hdr_csum_offset_only");
    maybeDeriveObserved("virtio_net_hdr", "virtio_net_hdr__num_buffers",
                        "virtio_net_hdr_num_buffers_only");
    maybeDeriveObserved("virtio_net_hdr_mrg_rxbuf",
                        "virtio_net_hdr_mrg_rxbuf__flags",
                        "virtio_net_hdr_mrg_rxbuf_flags_only");
    maybeDeriveObserved("virtio_net_hdr_mrg_rxbuf",
                        "virtio_net_hdr_mrg_rxbuf__gso_type",
                        "virtio_net_hdr_mrg_rxbuf_gso_type_only");
    maybeDeriveObserved("virtio_net_hdr_mrg_rxbuf",
                        "virtio_net_hdr_mrg_rxbuf__hdr_len",
                        "virtio_net_hdr_mrg_rxbuf_hdr_len_only");
    maybeDeriveObserved("virtio_net_hdr_mrg_rxbuf",
                        "virtio_net_hdr_mrg_rxbuf__gso_size",
                        "virtio_net_hdr_mrg_rxbuf_gso_size_only");
    maybeDeriveObserved("virtio_net_hdr_mrg_rxbuf",
                        "virtio_net_hdr_mrg_rxbuf__csum_start",
                        "virtio_net_hdr_mrg_rxbuf_csum_start_only");
    maybeDeriveObserved("virtio_net_hdr_mrg_rxbuf",
                        "virtio_net_hdr_mrg_rxbuf__csum_offset",
                        "virtio_net_hdr_mrg_rxbuf_csum_offset_only");
    maybeDeriveObserved("virtio_net_hdr_mrg_rxbuf",
                        "virtio_net_hdr_mrg_rxbuf__num_buffers",
                        "virtio_net_hdr_mrg_rxbuf_num_buffers_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__flags",
                        "virtio_net_hdr_v1_hash_tunnel_flags_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__gso_type",
                        "virtio_net_hdr_v1_hash_tunnel_gso_type_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__hdr_len",
                        "virtio_net_hdr_v1_hash_tunnel_hdr_len_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__gso_size",
                        "virtio_net_hdr_v1_hash_tunnel_gso_size_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__csum_start",
                        "virtio_net_hdr_v1_hash_tunnel_csum_start_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__csum_offset",
                        "virtio_net_hdr_v1_hash_tunnel_csum_offset_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__num_buffers",
                        "virtio_net_hdr_v1_hash_tunnel_num_buffers_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__hash_value_lo",
                        "virtio_net_hdr_v1_hash_tunnel_hash_value_lo_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__hash_value_hi",
                        "virtio_net_hdr_v1_hash_tunnel_hash_value_hi_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__hash_report",
                        "virtio_net_hdr_v1_hash_tunnel_hash_report_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__padding",
                        "virtio_net_hdr_v1_hash_tunnel_padding_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__outer_th_offset",
                        "virtio_net_hdr_v1_hash_tunnel_outer_th_offset_only");
    maybeDeriveObserved("virtio_net_hdr_v1_hash_tunnel",
                        "virtio_net_hdr_v1_hash_tunnel__inner_nh_offset",
                        "virtio_net_hdr_v1_hash_tunnel_inner_nh_offset_only");
    maybeDeriveObserved("virtio_net_ctrl_status",
                        "virtio_net_ctrl_status__value",
                        "virtio_net_ctrl_status_value_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_mac",
                        "virtio_net_ctrl_hdr_mac__class",
                        "virtio_net_ctrl_hdr_mac_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_mac",
                        "virtio_net_ctrl_hdr_mac__cmd",
                        "virtio_net_ctrl_hdr_mac_cmd_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_vlan_add",
                        "virtio_net_ctrl_hdr_vlan_add__class",
                        "virtio_net_ctrl_hdr_vlan_add_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_vlan_add",
                        "virtio_net_ctrl_hdr_vlan_add__cmd",
                        "virtio_net_ctrl_hdr_vlan_add_cmd_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_vlan_del",
                        "virtio_net_ctrl_hdr_vlan_del__class",
                        "virtio_net_ctrl_hdr_vlan_del_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_vlan_del",
                        "virtio_net_ctrl_hdr_vlan_del__cmd",
                        "virtio_net_ctrl_hdr_vlan_del_cmd_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_mq",
                        "virtio_net_ctrl_hdr_mq__class",
                        "virtio_net_ctrl_hdr_mq_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_mq",
                        "virtio_net_ctrl_hdr_mq__cmd",
                        "virtio_net_ctrl_hdr_mq_cmd_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_guest_offloads",
                        "virtio_net_ctrl_hdr_guest_offloads__class",
                        "virtio_net_ctrl_hdr_guest_offloads_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_guest_offloads",
                        "virtio_net_ctrl_hdr_guest_offloads__cmd",
                        "virtio_net_ctrl_hdr_guest_offloads_cmd_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_coal_tx",
                        "virtio_net_ctrl_hdr_coal_tx__class",
                        "virtio_net_ctrl_hdr_coal_tx_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_coal_tx",
                        "virtio_net_ctrl_hdr_coal_tx__cmd",
                        "virtio_net_ctrl_hdr_coal_tx_cmd_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_coal_rx",
                        "virtio_net_ctrl_hdr_coal_rx__class",
                        "virtio_net_ctrl_hdr_coal_rx_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_coal_rx",
                        "virtio_net_ctrl_hdr_coal_rx__cmd",
                        "virtio_net_ctrl_hdr_coal_rx_cmd_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_coal_vq",
                        "virtio_net_ctrl_hdr_coal_vq__class",
                        "virtio_net_ctrl_hdr_coal_vq_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_coal_vq",
                        "virtio_net_ctrl_hdr_coal_vq__cmd",
                        "virtio_net_ctrl_hdr_coal_vq_cmd_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_queue_stats",
                        "virtio_net_ctrl_hdr_queue_stats__class",
                        "virtio_net_ctrl_hdr_queue_stats_class_only");
    maybeDeriveObserved("virtio_net_ctrl_hdr_queue_stats",
                        "virtio_net_ctrl_hdr_queue_stats__cmd",
                        "virtio_net_ctrl_hdr_queue_stats_cmd_only");
    maybeDeriveObserved("virtio_net_guest_offloads",
                        "virtio_net_guest_offloads__value",
                        "virtio_net_guest_offloads_value_only");
    maybeDeriveObserved("virtio_net_ctrl_mac_addr",
                        "virtio_net_ctrl_mac_addr__mac",
                        "virtio_net_ctrl_mac_addr_mac_only");
    maybeDeriveObserved("virtio_net_ctrl_vlan",
                        "virtio_net_ctrl_vlan__vid",
                        "virtio_net_ctrl_vlan_vid_only");
    maybeDeriveObserved("virtio_net_ctrl_mq",
                        "virtio_net_ctrl_mq__virtqueue_pairs",
                        "virtio_net_ctrl_mq_virtqueue_pairs_only");
    maybeDeriveObserved("virtio_net_ctrl_coal_tx",
                        "virtio_net_ctrl_coal_tx__tx_max_packets",
                        "virtio_net_ctrl_coal_tx_tx_max_packets_only");
    maybeDeriveObserved("virtio_net_ctrl_coal_tx",
                        "virtio_net_ctrl_coal_tx__tx_usecs",
                        "virtio_net_ctrl_coal_tx_tx_usecs_only");
    maybeDeriveObserved("virtio_net_ctrl_coal_rx",
                        "virtio_net_ctrl_coal_rx__rx_max_packets",
                        "virtio_net_ctrl_coal_rx_rx_max_packets_only");
    maybeDeriveObserved("virtio_net_ctrl_coal_rx",
                        "virtio_net_ctrl_coal_rx__rx_usecs",
                        "virtio_net_ctrl_coal_rx_rx_usecs_only");
    maybeDeriveObserved("virtio_net_ctrl_coal_vq",
                        "virtio_net_ctrl_coal_vq__vqn",
                        "virtio_net_ctrl_coal_vq_vqn_only");
    maybeDeriveObserved("virtio_net_ctrl_coal_vq",
                        "virtio_net_ctrl_coal_vq__reserved",
                        "virtio_net_ctrl_coal_vq_reserved_only");
    maybeDeriveObserved("virtio_net_ctrl_coal_vq",
                        "virtio_net_ctrl_coal_vq__max_packets",
                        "virtio_net_ctrl_coal_vq_max_packets_only");
    maybeDeriveObserved("virtio_net_ctrl_coal_vq",
                        "virtio_net_ctrl_coal_vq__max_usecs",
                        "virtio_net_ctrl_coal_vq_max_usecs_only");
    maybeDeriveObserved("virtio_net_ctrl_queue_stats",
                        "virtio_net_ctrl_queue_stats__vq_index",
                        "virtio_net_ctrl_queue_stats_vq_index_only");
    maybeDeriveObserved("virtio_net_ctrl_queue_stats",
                        "virtio_net_ctrl_queue_stats__reserved",
                        "virtio_net_ctrl_queue_stats_reserved_only");
    maybeDeriveObserved("virtio_net_ctrl_queue_stats",
                        "virtio_net_ctrl_queue_stats__types_bitmap",
                        "virtio_net_ctrl_queue_stats_types_bitmap_only");
    maybeDeriveObserved("virtio_net_rss_config_hdr",
                        "virtio_net_rss_config_hdr__hash_types",
                        "virtio_net_rss_config_hdr_hash_types_only");
    maybeDeriveObserved("virtio_net_rss_config_hdr",
                        "virtio_net_rss_config_hdr__indirection_table_mask",
                        "virtio_net_rss_config_hdr_indirection_table_mask_only");
    maybeDeriveObserved("virtio_net_rss_config_hdr",
                        "virtio_net_rss_config_hdr__unclassified_queue",
                        "virtio_net_rss_config_hdr_unclassified_queue_only");
    maybeDeriveObserved("virtio_net_rss_config_hdr",
                        "virtio_net_rss_config_hdr__indirection_table",
                        "virtio_net_rss_config_hdr_indirection_table_only");
    maybeDeriveObserved("virtio_net_rss_config_trailer",
                        "virtio_net_rss_config_trailer__max_tx_vq",
                        "virtio_net_rss_config_trailer_max_tx_vq_only");
    maybeDeriveObserved("virtio_net_rss_config_trailer",
                        "virtio_net_rss_config_trailer__hash_key_length",
                        "virtio_net_rss_config_trailer_hash_key_length_only");
    maybeDeriveObserved("virtio_net_rss_config_trailer",
                        "virtio_net_rss_config_trailer__hash_key_data",
                        "virtio_net_rss_config_trailer_hash_key_data_only");
    maybeDeriveObserved("virtio_net_stats_capabilities",
                        "virtio_net_stats_capabilities__supported_stats_types",
                        "virtio_net_stats_capabilities_supported_stats_types_only");
    maybeDeriveObserved("virtio_net_stats_cvq",
                        "virtio_net_stats_cvq__type",
                        "virtio_net_stats_cvq_type_only");
    maybeDeriveObserved("virtio_net_stats_cvq",
                        "virtio_net_stats_cvq__reserved",
                        "virtio_net_stats_cvq_reserved_only");
    maybeDeriveObserved("virtio_net_stats_cvq",
                        "virtio_net_stats_cvq__vq_index",
                        "virtio_net_stats_cvq_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_cvq",
                        "virtio_net_stats_cvq__reserved1",
                        "virtio_net_stats_cvq_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_cvq",
                        "virtio_net_stats_cvq__size",
                        "virtio_net_stats_cvq_size_only");
    maybeDeriveObserved("virtio_net_stats_cvq",
                        "virtio_net_stats_cvq__command_num",
                        "virtio_net_stats_cvq_command_num_only");
    maybeDeriveObserved("virtio_net_stats_cvq",
                        "virtio_net_stats_cvq__ok_num",
                        "virtio_net_stats_cvq_ok_num_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__type",
                        "virtio_net_stats_rx_basic_type_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__reserved",
                        "virtio_net_stats_rx_basic_reserved_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__vq_index",
                        "virtio_net_stats_rx_basic_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__reserved1",
                        "virtio_net_stats_rx_basic_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__size",
                        "virtio_net_stats_rx_basic_size_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__rx_notifications",
                        "virtio_net_stats_rx_basic_rx_notifications_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__rx_packets",
                        "virtio_net_stats_rx_basic_rx_packets_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__rx_bytes",
                        "virtio_net_stats_rx_basic_rx_bytes_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__rx_interrupts",
                        "virtio_net_stats_rx_basic_rx_interrupts_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__rx_drops",
                        "virtio_net_stats_rx_basic_rx_drops_only");
    maybeDeriveObserved("virtio_net_stats_rx_basic",
                        "virtio_net_stats_rx_basic__rx_drop_overruns",
                        "virtio_net_stats_rx_basic_rx_drop_overruns_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__type",
                        "virtio_net_stats_tx_basic_type_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__reserved",
                        "virtio_net_stats_tx_basic_reserved_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__vq_index",
                        "virtio_net_stats_tx_basic_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__reserved1",
                        "virtio_net_stats_tx_basic_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__size",
                        "virtio_net_stats_tx_basic_size_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__tx_notifications",
                        "virtio_net_stats_tx_basic_tx_notifications_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__tx_packets",
                        "virtio_net_stats_tx_basic_tx_packets_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__tx_bytes",
                        "virtio_net_stats_tx_basic_tx_bytes_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__tx_interrupts",
                        "virtio_net_stats_tx_basic_tx_interrupts_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__tx_drops",
                        "virtio_net_stats_tx_basic_tx_drops_only");
    maybeDeriveObserved("virtio_net_stats_tx_basic",
                        "virtio_net_stats_tx_basic__tx_drop_malformed",
                        "virtio_net_stats_tx_basic_tx_drop_malformed_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__type",
                        "virtio_net_stats_rx_csum_type_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__reserved",
                        "virtio_net_stats_rx_csum_reserved_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__vq_index",
                        "virtio_net_stats_rx_csum_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__reserved1",
                        "virtio_net_stats_rx_csum_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__size",
                        "virtio_net_stats_rx_csum_size_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__rx_csum_valid",
                        "virtio_net_stats_rx_csum_rx_csum_valid_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__rx_needs_csum",
                        "virtio_net_stats_rx_csum_rx_needs_csum_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__rx_csum_none",
                        "virtio_net_stats_rx_csum_rx_csum_none_only");
    maybeDeriveObserved("virtio_net_stats_rx_csum",
                        "virtio_net_stats_rx_csum__rx_csum_bad",
                        "virtio_net_stats_rx_csum_rx_csum_bad_only");
    maybeDeriveObserved("virtio_net_stats_tx_csum",
                        "virtio_net_stats_tx_csum__type",
                        "virtio_net_stats_tx_csum_type_only");
    maybeDeriveObserved("virtio_net_stats_tx_csum",
                        "virtio_net_stats_tx_csum__reserved",
                        "virtio_net_stats_tx_csum_reserved_only");
    maybeDeriveObserved("virtio_net_stats_tx_csum",
                        "virtio_net_stats_tx_csum__vq_index",
                        "virtio_net_stats_tx_csum_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_tx_csum",
                        "virtio_net_stats_tx_csum__reserved1",
                        "virtio_net_stats_tx_csum_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_tx_csum",
                        "virtio_net_stats_tx_csum__size",
                        "virtio_net_stats_tx_csum_size_only");
    maybeDeriveObserved("virtio_net_stats_tx_csum",
                        "virtio_net_stats_tx_csum__tx_csum_none",
                        "virtio_net_stats_tx_csum_tx_csum_none_only");
    maybeDeriveObserved("virtio_net_stats_tx_csum",
                        "virtio_net_stats_tx_csum__tx_needs_csum",
                        "virtio_net_stats_tx_csum_tx_needs_csum_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__type",
                        "virtio_net_stats_rx_gso_type_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__reserved",
                        "virtio_net_stats_rx_gso_reserved_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__vq_index",
                        "virtio_net_stats_rx_gso_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__reserved1",
                        "virtio_net_stats_rx_gso_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__size",
                        "virtio_net_stats_rx_gso_size_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__rx_gso_packets",
                        "virtio_net_stats_rx_gso_rx_gso_packets_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__rx_gso_bytes",
                        "virtio_net_stats_rx_gso_rx_gso_bytes_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__rx_gso_packets_coalesced",
                        "virtio_net_stats_rx_gso_rx_gso_packets_coalesced_only");
    maybeDeriveObserved("virtio_net_stats_rx_gso",
                        "virtio_net_stats_rx_gso__rx_gso_bytes_coalesced",
                        "virtio_net_stats_rx_gso_rx_gso_bytes_coalesced_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__type",
                        "virtio_net_stats_tx_gso_type_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__reserved",
                        "virtio_net_stats_tx_gso_reserved_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__vq_index",
                        "virtio_net_stats_tx_gso_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__reserved1",
                        "virtio_net_stats_tx_gso_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__size",
                        "virtio_net_stats_tx_gso_size_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__tx_gso_packets",
                        "virtio_net_stats_tx_gso_tx_gso_packets_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__tx_gso_bytes",
                        "virtio_net_stats_tx_gso_tx_gso_bytes_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__tx_gso_segments",
                        "virtio_net_stats_tx_gso_tx_gso_segments_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__tx_gso_segments_bytes",
                        "virtio_net_stats_tx_gso_tx_gso_segments_bytes_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__tx_gso_packets_noseg",
                        "virtio_net_stats_tx_gso_tx_gso_packets_noseg_only");
    maybeDeriveObserved("virtio_net_stats_tx_gso",
                        "virtio_net_stats_tx_gso__tx_gso_bytes_noseg",
                        "virtio_net_stats_tx_gso_tx_gso_bytes_noseg_only");
    maybeDeriveObserved("virtio_net_stats_rx_speed",
                        "virtio_net_stats_rx_speed__type",
                        "virtio_net_stats_rx_speed_type_only");
    maybeDeriveObserved("virtio_net_stats_rx_speed",
                        "virtio_net_stats_rx_speed__reserved",
                        "virtio_net_stats_rx_speed_reserved_only");
    maybeDeriveObserved("virtio_net_stats_rx_speed",
                        "virtio_net_stats_rx_speed__vq_index",
                        "virtio_net_stats_rx_speed_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_rx_speed",
                        "virtio_net_stats_rx_speed__reserved1",
                        "virtio_net_stats_rx_speed_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_rx_speed",
                        "virtio_net_stats_rx_speed__size",
                        "virtio_net_stats_rx_speed_size_only");
    maybeDeriveObserved("virtio_net_stats_rx_speed",
                        "virtio_net_stats_rx_speed__rx_ratelimit_packets",
                        "virtio_net_stats_rx_speed_rx_ratelimit_packets_only");
    maybeDeriveObserved("virtio_net_stats_rx_speed",
                        "virtio_net_stats_rx_speed__rx_ratelimit_bytes",
                        "virtio_net_stats_rx_speed_rx_ratelimit_bytes_only");
    maybeDeriveObserved("virtio_net_stats_tx_speed",
                        "virtio_net_stats_tx_speed__type",
                        "virtio_net_stats_tx_speed_type_only");
    maybeDeriveObserved("virtio_net_stats_tx_speed",
                        "virtio_net_stats_tx_speed__reserved",
                        "virtio_net_stats_tx_speed_reserved_only");
    maybeDeriveObserved("virtio_net_stats_tx_speed",
                        "virtio_net_stats_tx_speed__vq_index",
                        "virtio_net_stats_tx_speed_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_tx_speed",
                        "virtio_net_stats_tx_speed__reserved1",
                        "virtio_net_stats_tx_speed_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_tx_speed",
                        "virtio_net_stats_tx_speed__size",
                        "virtio_net_stats_tx_speed_size_only");
    maybeDeriveObserved("virtio_net_stats_tx_speed",
                        "virtio_net_stats_tx_speed__tx_ratelimit_packets",
                        "virtio_net_stats_tx_speed_tx_ratelimit_packets_only");
    maybeDeriveObserved("virtio_net_stats_tx_speed",
                        "virtio_net_stats_tx_speed__tx_ratelimit_bytes",
                        "virtio_net_stats_tx_speed_tx_ratelimit_bytes_only");
    maybeDeriveObserved("virtio_net_stats_reply_hdr",
                        "virtio_net_stats_reply_hdr__type",
                        "virtio_net_stats_reply_hdr_type_only");
    maybeDeriveObserved("virtio_net_stats_reply_hdr",
                        "virtio_net_stats_reply_hdr__reserved",
                        "virtio_net_stats_reply_hdr_reserved_only");
    maybeDeriveObserved("virtio_net_stats_reply_hdr",
                        "virtio_net_stats_reply_hdr__vq_index",
                        "virtio_net_stats_reply_hdr_vq_index_only");
    maybeDeriveObserved("virtio_net_stats_reply_hdr",
                        "virtio_net_stats_reply_hdr__reserved1",
                        "virtio_net_stats_reply_hdr_reserved1_only");
    maybeDeriveObserved("virtio_net_stats_reply_hdr",
                        "virtio_net_stats_reply_hdr__size",
                        "virtio_net_stats_reply_hdr_size_only");
  }

  static DmaPayloadInfo extractPayloadFieldsByPrefixes(
      DmaPayloadInfo &payload,
      std::initializer_list<StringRef> prefixes,
      StringRef forcedType = "",
      StringRef forcedKind = "") {
    DmaPayloadInfo extracted;
    std::vector<std::string> remaining;
    for (const std::string &field : payload.fields) {
      bool match = false;
      for (StringRef prefix : prefixes) {
        if (StringRef(field).startswith(prefix)) {
          match = true;
          break;
        }
      }
      if (match) {
        extracted.fields.push_back(field);
      } else {
        remaining.push_back(field);
      }
    }
    payload.fields = std::move(remaining);
    if (!forcedType.empty()) {
      extracted.type = forcedType.str();
    }
    if (!forcedKind.empty()) {
      extracted.kind = forcedKind.str();
    }
    normalizeMergedPayloadInfo(extracted);
    normalizeMergedPayloadInfo(payload);
    return extracted;
  }

  static void keepPayloadFieldsByPrefixes(
      DmaPayloadInfo &payload,
      std::initializer_list<StringRef> prefixes,
      StringRef forcedType = "",
      StringRef forcedKind = "") {
    DmaPayloadInfo kept;
    kept.fields.reserve(payload.fields.size());
    for (const std::string &field : payload.fields) {
      for (StringRef prefix : prefixes) {
        if (StringRef(field).startswith(prefix)) {
          kept.fields.push_back(field);
          break;
        }
      }
    }
    if (!forcedType.empty()) {
      kept.type = forcedType.str();
    } else {
      kept.type = payload.type;
    }
    if (!forcedKind.empty()) {
      kept.kind = forcedKind.str();
    } else {
      kept.kind = payload.kind;
    }
    payload = std::move(kept);
    normalizeMergedPayloadInfo(payload);
  }

  static bool samePayloadSourceInfo(const PayloadSourceInfo &lhs,
                                    const PayloadSourceInfo &rhs) {
    return lhs.originCall == rhs.originCall &&
           lhs.originArgIndex == rhs.originArgIndex &&
           lhs.value == rhs.value &&
           lhs.lengthValue == rhs.lengthValue &&
           lhs.slotIndex == rhs.slotIndex &&
           lhs.originCallee == rhs.originCallee;
  }

  static void appendPayloadSourceInfo(std::vector<PayloadSourceInfo> &out,
                                      const PayloadSourceInfo &info) {
    if (!info.value) {
      return;
    }
    for (const PayloadSourceInfo &existing : out) {
      if (samePayloadSourceInfo(existing, info)) {
        return;
      }
    }
    out.push_back(info);
  }
