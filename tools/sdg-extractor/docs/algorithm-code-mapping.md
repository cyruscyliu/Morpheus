# SDG Extractor: Algorithm-to-Code Mapping

This document maps the SDG extractor's analysis pipeline to concrete source
locations. All low-level value-flow, alias, and ICFG capabilities come from
**SVF 3.3**; the semantic layer lives in **SdgSvfCore**; JSON output and the
LLVM pass entry point are in **SDGExtractPass.cpp**.

Goal: every analysis decision can be traced to a class or function for audit
and iteration.

---

## 1. Architecture Overview

```text
SDGExtractPass.cpp              # LLVM pass orchestration + JSON output
        |
        v
SdgSvfCore (static lib)
  ├── SemanticValueFlowGraph    # Wraps SVFG; LLVM value <-> SVFG node mapping
  ├── SourceCatalog             # Binds MMIO/config/feature/struct fields to sources
  ├── SinkCatalog               # Binds kernel API calls to sinks + roles
  ├── RoleTaintAnalysis         # Role-preserving taint propagation over SVFG
  ├── ControlDependencyAnalysis # Source-gated sink discovery via SVFG + summaries
  └── RuleAssembler             # Builds SDG rules from dataflow/control results
        |
        v
SVF 3.3
  ├── SVFG / VFG                # Data-flow graph (direct + indirect + call/return)
  ├── PointerAnalysis           # Andersen / flow-sensitive alias
  ├── ICFG                      # Inter-procedural control-flow graph
  └── SVFIR                     # Program assignment graph / memory SSA
```

---

## 2. Capability-to-Code Mapping

### 2.1 Value-Flow Analysis

| Capability | File | Class/Function | Description | Status |
|------------|------|----------------|-------------|--------|
| Wrap SVFG | `src/svf-core/lib/SemanticValueFlowGraph.cpp` | `SemanticValueFlowGraph::SemanticValueFlowGraph(SVFG*)` | Wraps an already-built SVFG | Done |
| LLVM value -> SVFG node | `src/svf-core/lib/SemanticValueFlowGraph.cpp` | `SemanticValueFlowGraph::nodesForValue()` | Scans SVFG and maps back to LLVM | Done |
| Forward/backward neighbours | `src/svf-core/lib/SemanticValueFlowGraph.cpp` | `forwardNeighbours()` / `backwardNeighbours()` | Walks `VFGNode::OutEdgeBegin/End` | Done |
| SVFG node -> LLVM value | `src/svf-core/lib/SemanticValueFlowGraph.cpp` | `llvmValue()` / `llvmInstruction()` | Via `LLVMModuleSet::getLLVMValue()` | Done |
| Source root value | `src/svf-core/lib/RoleTaintAnalysis.cpp` | `RoleTaintAnalysis::run()` | BFS starts from each source's `rootValue` | Done |
| Role transform (SVFG) | `src/svf-core/lib/RoleTaintAnalysis.cpp` | `RoleTaintAnalysis::transformRole()` | Role conversion on edges; currently a stub | Stub |

### 2.2 Inter-Procedural Propagation

| Capability | File | Class/Function | Description | Status |
|------------|------|----------------|-------------|--------|
| actual -> formal | (provided by SVF) | `ActualParmSVFGNode -> FormalParmSVFGNode` | Built into SVFG | SVF |
| return -> call result | (provided by SVF) | `FormalRetSVFGNode -> ActualRetSVFGNode` | Built into SVFG | SVF |
| inter-procedural reachable | `src/svf-core/lib/RoleTaintAnalysis.cpp` | `run()` BFS | Walks SVFG edges uniformly | Done |
| indirect call resolution | (provided by SVF) | `PointerAnalysis` + `CallGraph` | Andersen/CHA splits indirect calls | SVF |

### 2.3 Taint Tracking

| Capability | File | Class/Function | Description | Status |
|------------|------|----------------|-------------|--------|
| Source discovery (calls) | `src/svf-core/lib/SourceCatalog.cpp` | `SourceCatalog::matchCall()` | `readl`, `virtio_has_feature`, `__virtio_test_bit`, `virtio_cread*`, etc. | Done |
| Source discovery (loads) | `src/svf-core/lib/SourceCatalog.cpp` | `SourceCatalog::matchLoad()` | Guest-controlled struct fields | Done |
| Source discovery (args) | `src/svf-core/lib/SourceCatalog.cpp` | `SourceCatalog::matchArgument()` | Known arg schemas + heuristic `len`/`size`/`num` names | Done |
| Extra sources from calls | `src/svf-core/lib/SourceCatalog.cpp` | `SourceCatalog::extraSourcesForCall()` | Feature-bit argument also treated as source | Done |
| Sink discovery | `src/svf-core/lib/SinkCatalog.cpp` | `SinkCatalog::match()` | Explicit + pattern fallback, returns all matching arg indices | Done |
| Role enum | `src/svf-core/include/sdg/core/Role.h` | `enum class Role` | `Value`, `Size`, `Address`, `Index`, `Control`, `FeatureBit` | Done |
| Initial role | `src/svf-core/lib/RoleTaintAnalysis.cpp` | `roleForSchema()` | Sets role from source schema | Done |
| Reach sink recording | `src/svf-core/lib/RoleTaintAnalysis.cpp` | `run()` | SVFG forward BFS, depth bound 1024 | Done |

### 2.4 Control Dependency

| Capability | File | Class/Function | Description | Status |
|------------|------|----------------|-------------|--------|
| SVFG-derived branch conditions | `src/svf-core/lib/ControlDependencyAnalysis.cpp` | `analyze()` | Seeds search with all SVFG-reachable values from source | Done |
| Feature-bit / source branches | `src/svf-core/lib/ControlDependencyAnalysis.cpp` | `extractPredicate()` | `virtio_has_feature`, `__virtio_test_bit`, inlined `(src & (1<<b))` | Done |
| Switch branches | `src/svf-core/lib/ControlDependencyAnalysis.cpp` | `analyze()` | Emits one rule per case/default | Done |
| Predicate inference | `src/svf-core/lib/ControlDependencyAnalysis.cpp` | `extractPredicate()` | `BitSet`, `BitClear`, `Ne`, `Eq`, `Default` | Done |
| Side-unique control sinks | `src/svf-core/lib/ControlDependencyAnalysis.cpp` | `analyze()` | Only emits sinks reachable from one branch/switch side but not the others | Done |
| Inter-procedural summaries | `src/svf-core/lib/ControlDependencyAnalysis.cpp` | `buildFunctionSinks()` | Stores all reachable sinks per function + transitive closure | Done |

### 2.5 Memory Flow

| Capability | File | Class/Function | Description | Status |
|------------|------|----------------|-------------|--------|
| store -> load indirect edges | (provided by SVF) | `LoadSVFGNode` / `StoreSVFGNode` | Built by pointer analysis | SVF |
| Alloca propagation | `src/svf-core/lib/RoleTaintAnalysis.cpp` / `ControlDependencyAnalysis.cpp` | SVFG BFS | Crosses store/load for the same alloca | Done |
| DMA buffer tracing | `src/svf-core/lib/SourceCatalog.cpp` | `matchCall()` / `matchLoad()` | Covered via `scatterlist`, `vring_desc`, etc. field sources | Done |
| Struct-field sources | `src/svf-core/lib/SourceCatalog.cpp` | `matchLoad()` | Identifies `vring_desc.len`, `sk_buff.len`, etc. | Done |

### 2.6 Source / Sink Semanticization

| Capability | File | Class/Function | Description | Status |
|------------|------|----------------|-------------|--------|
| Source schema registration | `src/svf-core/lib/SourceCatalog.cpp` | `SourceCatalog::registerDefaultSchemas()` | virtio-mmio + virtio-net config schemas | Done |
| Source binding | `src/svf-core/lib/SourceCatalog.cpp` | `matchCall()` / `matchLoad()` / `matchArgument()` | Maps instructions to schema IDs | Done |
| Unknown MMIO/config fallback | `src/svf-core/lib/SourceCatalog.cpp` | `matchCall()` / `matchConfigGetLoad()` | Generates `MmioTransport.0xXX` / `MmioConfig.0xXX` for unknown offsets | Done |
| Argument heuristic fallback | `src/svf-core/lib/SourceCatalog.cpp` | `matchArgument()` | Generates `InternalState.state.*` for `len`/`size`/`num`-like integer args | Done |
| Sink catalog registration | `src/svf-core/lib/SinkCatalog.cpp` | `SinkCatalog::registerDefaultSinks()` | kmalloc, dma_map, skb_put, memcpy, writel, etc. | Done |
| Sink pattern fallback | `src/svf-core/lib/SinkCatalog.cpp` | `SinkCatalog::match()` | Catches `alloc_*`, `memcpy*`, `dma_map_*`, `skb_put*`, `virtqueue_add*` families using only semantically-correct arg indices | Done |
| Name normalization | `src/svf-core/lib/SinkCatalog.cpp` | `SinkCatalog::normalizeName()` | Strips `_noprof`, `_node`, `.NNN`, `llvm.` prefixes | Done |
| Modeled external-API sinks | `src/svf-core/lib/SinkCatalog.cpp` | `SinkCatalog::modeledSinks()` | Maps virtio helpers to external APIs not in bitcode | Done |
| Source-level modeled sinks | `src/svf-core/lib/SourceCatalog.cpp` | `SourceCatalog::modeledSinkForSourceId()` | Protocol-level sink for transport/feature/internal-state sources | Done |

### 2.7 Rule Assembly and Output

| Capability | File | Class/Function | Description | Status |
|------------|------|----------------|-------------|--------|
| Head constants | `src/svf-core/include/sdg/core/Rule.h` | `sdg::core::heads::*` | Centralized `head_bound`, `head_guard`, `head_dataflow`, `head_offset`, `head_call` | Done |
| Data-flow rule | `src/svf-core/lib/RuleAssembler.cpp` | `RuleAssembler::assemble()` | Converts `TaintResult` to rule, trigger head `head_bound` | Done |
| Control-dependency rule | `src/svf-core/lib/RuleAssembler.cpp` | `RuleAssembler::assemble()` | Converts `ControlResult` to `-ctrl` rule, trigger head `head_bound` | Done |
| Mutation inference | `src/svf-core/lib/RuleAssembler.cpp` | `mutationForPredicate()` | `Ne0 -> SampleRange`, `BitSet -> FlipBit` | Done |
| Deduplication | `src/svf-core/lib/RuleAssembler.cpp` | `RuleAssembler::deduplicate()` | By `(id, function, sinks)` | Done |
| FP filter: empty generic control edges | `src/llvm-pass/SDGExtractPass.cpp` | pass orchestration | Drops empty-sink control rules unless predicate is `BitSet`/`BitClear` | Done |
| FP filter: internal arg names | `src/llvm-pass/SDGExtractPass.cpp` + `SourceCatalog` | `matchArgument()` | Excludes `orphan`, `truesize`, `netmem`, etc. | Done |
| FP filter: scope arg heuristic | `src/svf-core/lib/SourceCatalog.cpp` | `matchArgument()` | Only enables `len`/`size`/`num` heuristic in virtio-related functions | Done |
| FP filter: conversion-helper control rules | `src/llvm-pass/SDGExtractPass.cpp` | pass orchestration | Drops `-ctrl` rules whose only sinks are `cpu_to_virtio*` / `virtio*_to_cpu` | Done |
| FP filter: dedupe feature self-checks | `src/llvm-pass/SDGExtractPass.cpp` | pass orchestration | Keeps one `virtio_has_feature` self-check rule per source id | Done |
| FP filter: global pair dedup | `src/llvm-pass/SDGExtractPass.cpp` | pass orchestration | Keeps the first `(source id, sink fn, arg idx)` pair across the module | Done |
| FP filter: feature-bit control sink blocklist | `src/llvm-pass/SDGExtractPass.cpp` | pass orchestration | Drops `-ctrl` rules for feature bits whose sinks are internal helpers | Done |
| JSON serialization | `src/llvm-pass/SDGExtractPass.cpp` | `writeJSON()` | Writes `Rule` / `Node` / `Edge` JSON | Done |

---

## 3. Call Chain (Pass -> Core -> SVF)

```text
SDGExtractPass::run(Module &M)
  |
  |-- 1. Build SVF analysis graph
  |      SVFIRBuilder builder;
  |      SVFIR *pag = builder.build();
  |      Andersen *pta = AndersenWaveDiff::createAndersenWaveDiff(pag);
  |      SVFG *svfg = SVFGBuilder().buildFullSVFG(pta);
  |      ICFG *icfg = pag->getICFG();
  |
  |-- 2. Construct core objects
  |      SemanticValueFlowGraph svfGraph(svfg);
  |      SourceCatalog srcCatalog;
  |      SinkCatalog sinkCatalog;
  |
  |-- 3. Discover sources and sinks
  |      for each function / instruction:
  |        srcCatalog.matchCall(CB)          -> SemanticSource
  |        srcCatalog.extraSourcesForCall()  -> additional sources (e.g. feature-bit arg)
  |        srcCatalog.matchLoad(LI)          -> SemanticSource
  |        srcCatalog.matchArgument(A)       -> SemanticSource
  |        sinkCatalog.match(CB)             -> SemanticSink
  |
  |-- 4. Taint propagation
  |      RoleTaintAnalysis taint(svfGraph, sources, sinkCatalog);
  |      taint.run(/*maxDepth=*/1024);
  |
  |-- 5. Control dependency
  |      ControlDependencyAnalysis ctrl(icfg, &svfGraph, M, sinkCatalog);
  |      ctrl.analyze(source, sinkCatalog) for each source
  |
  |-- 6. Assemble rules + modeled sinks + self-checks
  |      RuleAssembler assembler;
  |      rules = assembler.assemble(taint.result(), ctrlResults);
  |      for each source:
  |        if srcCatalog.modeledSinkForSourceId(source.id) -> emit modeled rule
  |        if source is argument and sinkCatalog.isArgumentSink(...) -> emit self-check rule
  |      for each rule with external-API wrapper sink:
  |        sinkCatalog.modeledSinks(sink) -> emit external-API modeled rule
  |      Drop empty-sink generic control rules (keep BitSet/BitClear).
  |
  |-- 7. Write JSON
  |      writeJSON(SDGOutputPath, sources, rules);
```

---

## 4. Design Trade-Offs

### 4.1 Recall-First / Soundness

The pipeline is intentionally over-approximate to drive false negatives toward
zero:

- Unknown MMIO/config offsets still become generic sources.
- `len`/`size`/`num`-like integer arguments become sources even without an
  explicit schema.
- Sink pattern fallback treats multiple arguments of a dangerous family as
  sinks.
- Control dependency uses SVFG reachability rather than strict post-dominance.
- Function sink summaries are transitive.

### 4.2 Precision Cost

The over-approximation produces many rules. The current workflow emits about
8,000 rules for virtio-net. Precision is recovered through post-processing
filters in `SDGExtractPass.cpp` rather than by weakening the core analysis.

---

## 5. Metrics (virtio-net kernel workflow)

| Metric | Value |
|--------|-------|
| LLM strict-subset match | 24 / 24 |
| Unit tests | 4 / 4 PASS |
| Nodes | ~430 |
| Self edges | ~4,300 |
| Cross edges | 0 |
| Rules | ~3,800 |

---

## 6. TODO

### Done

1. SVFG-based forward BFS taint propagation with a very high depth bound.
2. Comprehensive source catalog with MMIO/config/feature/struct-field/argument
   coverage and generic fallbacks.
3. Comprehensive sink catalog with explicit + pattern-fallback matching.
4. Inter-procedural control dependency with SVFG seeding, `SwitchInst` support,
   both branch sides, and transitive function summaries.
5. Modeled sinks for external APIs and protocol-level source-to-sink
   relationships.
6. Centralized head-string constants.
7. First-pass FP filters in `SDGExtractPass.cpp`:
   - drop generic empty-sink control rules,
   - exclude clearly internal argument names.

### Next

1. ~~Post-dominator-based control dependency~~: implemented as side-unique sink
   filtering in `ControlDependencyAnalysis::analyze()`.
2. ~~Canonical argument indices for sink families~~: implemented in
   `SinkCatalog::match()` pattern fallback.
3. ~~Tighter argument-source heuristic~~: scoped to virtio-related function
   names in `SourceCatalog::matchArgument()`.
4. **Feature-bit validation**: drop or flag feature-bit constants outside the
   valid guest-visible range.
5. **Cross-edge preconditions**: emit `head_guard` cross-edges when one source
   guards another source's use.
