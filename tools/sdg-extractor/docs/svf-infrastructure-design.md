# SVF-Based SDG Extractor Infrastructure Design

## Goal

Replace the hand-rolled value-flow engine in `SDGExtractPass.cpp` with a
systematic, SVF-backed infrastructure. The new stack must:

- recover guest-controlled values from LLVM IR,
- track them interprocedurally through data and control dependencies,
- attach semantic roles (`size`, `address`, `index`, `value`, `control`,
  `feature_bit`),
- emit SDG rules comparable to the LLM rule set.

This document defines the layering, the public API, the core algorithms, and the
evaluation plan.

## Layering

```
+------------------------------------------+
|  SDGExtractPass (LLVM pass entry point)  |
+------------------------------------------+
|  Algorithm layer (SdgSvfCore)            |
|  - SourceCatalog                         |
|  - SinkCatalog                           |
|  - RoleTaintAnalysis                     |
|  - ControlDependencyAnalysis             |
|  - RuleAssembler                         |
+------------------------------------------+
|  Infrastructure layer (SdgSvfCore)       |
|  - SemanticSource / SemanticSink         |
|  - SemanticValueFlowGraph                |
|  - SourceCatalog / SinkCatalog schemas   |
+------------------------------------------+
|  SVF 3.3 (vendored + patched)            |
|  - SVFG (sparse value-flow graph)        |
|  - Pointer analysis (Andersen/FS/...)    |
|  - Interprocedural CFG (ICFG)            |
|  - Memory SSA / indirect value-flow      |
+------------------------------------------+
|  LLVM 15 IR                              |
+------------------------------------------+
```

## Directory layout

SVF is kept separate from the SDG core so that patches and rebuilds are
self-contained:

```
.morpheus/tools/sdg-extractor/
├── third_party/SVF/          # SVF 3.3 source + local build/install
│   ├── build-svf.sh
│   ├── patches/
│   │   └── extapi-llvm15-typed-pointers.patch
│   ├── build/
│   └── install/
├── src/
│   ├── svf-core/             # SdgSvfCore library (headers + lib + tools)
│   └── llvm-pass/            # SDGExtractPass.cpp plugin
└── docs/
    ├── svf-infrastructure-design.md
    └── algorithm-code-mapping.md
```

No legacy hand-rolled value-flow code remains in `src/llvm-pass`.

## SVF Role

SVF provides the bottom layer:

- **SVFG**: direct/indirect value-flow edges, call arg/formal, return/call-result,
  load/store memory flow.
- **Pointer analysis**: resolves `skb->data`, `sg->page_link`, `desc->addr`,
  DMA buffers.
- **ICFG**: cross-function control flow for control-dependency rule assembly.

Our code never builds def-use edges by hand. It queries SVF and then adds
semantic meaning.

## Public API

All API types live in namespace `sdg::core`.

### Semantic roles

```cpp
enum class Role {
  Unknown,
  Value,       // raw scalar value (e.g. writel data)
  Size,        // allocation / copy / map size
  Address,     // buffer pointer
  Index,       // queue/descriptor/used index
  Control,     // branch condition
  FeatureBit,  // virtio feature bit index
};
```

### Source / Sink catalog entries

```cpp
struct SourceTemplate {
  std::string id;                 // e.g. "MmioTransport.queue_notify"
  std::string clazz;              // "Mmio", "Dma", "InternalState"
  std::string accessKind;         // "transport", "config", "feature", ...
  llvm::Optional<uint64_t> offset;
  llvm::Optional<unsigned> featureBit;
  llvm::Optional<unsigned> widthBytes;
};

struct SinkTemplate {
  std::string function;           // base name, before _noprof / .NNN
  unsigned argIndex;
  Role role;
};

class SourceCatalog {
public:
  // Register transport-specific schemas.
  void registerVirtioMmioSchema();
  void registerVirtioNetConfigSchema();

  // Try to match a call/load/store to a source template.
  llvm::Optional<SemanticSource> match(llvm::CallBase *CB) const;
  llvm::Optional<SemanticSource> match(llvm::LoadInst *LI) const;
};

class SinkCatalog {
public:
  void registerDefaultKernelSinks();
  llvm::Optional<SemanticSink> match(llvm::CallBase *CB) const;
};
```

### Semantic instances

```cpp
struct SemanticSource {
  std::string id;
  SourceTemplate tpl;
  const llvm::Value *rootValue;   // SSA value or memory object
  const llvm::Instruction *site;  // call/load instruction
  std::string function;
  DebugLoc loc;
};

struct SemanticSink {
  std::string function;
  Role role;
  unsigned argIndex;
  const llvm::CallBase *call;
};
```

### Semantic Value-Flow Graph wrapper

```cpp
class SemanticValueFlowGraph {
public:
  explicit SemanticValueFlowGraph(SVF::SVFG *svfg);

  // All SVFG nodes that correspond to a given LLVM value.
  std::vector<const SVF::VFGNode*> nodesForValue(const llvm::Value *V) const;

  // Direct forward/backward value-flow neighbours at SVFG level.
  void forwardNeighbours(const SVF::VFGNode *n,
                         llvm::SmallVectorImpl<const SVF::VFGNode*> &out) const;
  void backwardNeighbours(const SVF::VFGNode *n,
                          llvm::SmallVectorImpl<const SVF::VFGNode*> &out) const;

  // Map SVFG node back to LLVM instruction/value if possible.
  const llvm::Value *llvmValue(const SVF::VFGNode *n) const;
  const llvm::Instruction *llvmInstruction(const SVF::VFGNode *n) const;
};
```

### Taint propagation

```cpp
struct TaintLabel {
  SemanticSource source;
  Role role;
  float confidence;
};

class RoleTaintAnalysis {
public:
  RoleTaintAnalysis(const SemanticValueFlowGraph &graph,
                    const SourceCatalog &srcCat,
                    const SinkCatalog &sinkCat);

  // Run from all discovered sources. Populates sinkReach map.
  void run();

  // Source -> list of (sink, propagated label, path predicate list).
  using Result = std::map<std::string,
      std::vector<std::tuple<SemanticSink, TaintLabel, std::vector<Predicate>>>>;
  const Result &result() const;

private:
  Role transformRole(Role r, const SVF::VFGNode *from,
                     const SVF::VFGNode *to) const;
};
```

### Control dependency

```cpp
class ControlDependencyAnalysis {
public:
  explicit ControlDependencyAnalysis(SVF::ICFG *icfg);

  // For a branch condition `cond`, return sink calls that are directly
  // contained in one successor but not the other.
  std::vector<std::pair<const llvm::CallBase*, bool>>
  directSinkSuccessors(const llvm::Value *cond,
                       const SinkCatalog &sinks) const;
};
```

### Rule assembly

```cpp
class RuleAssembler {
public:
  // Combine data-flow and control-dependency results into SDG Rule objects.
  std::vector<Rule> assemble(const RoleTaintAnalysis::Result &dataflowResult,
                             const ControlResult &controlResult) const;

  // Merge duplicate rules, preferring the one with most sinks/highest
  // confidence.
  std::vector<Rule> deduplicate(std::vector<Rule> rules) const;
};
```

## Core Algorithms

### 1. Source discovery

For every function in the module:

1. Iterate instructions.
2. For `CallBase`:
   - MMIO read: match callee name (`readl`, `readb`, `ioread32`, ...) and
     resolve pointer offset against `virtio_mmio` register schema.
   - Config read: match `virtio_cread*`, `virtio_cread_bytes`, resolve offset
     against `struct virtio_net_config` schema.
   - Feature test: match `virtio_has_feature`, use constant second argument as
     feature bit.
3. For `LoadInst` from known semantic struct fields (e.g.
   `virtio_net_hdr::flags`), create `InternalState` source.
4. For DMA buffer attachments (`sg_set_buf`, `skb_to_sgvec`, ...), use SVF
   pointer analysis to recover the buffer value and create `Dma` source.

### 2. Sink discovery

Scan every `CallBase` in the module:

1. Normalize function name (strip `_noprof`, `.NNN`).
2. Look up in `SinkCatalog`.
3. Record `SemanticSink` with role and argument index.

Sink catalog includes allocation, DMA mapping, memory copy, network helpers,
control helpers, virtio helpers.

### 3. Role-preserving taint propagation

Run from every `SemanticSource.rootValue`:

1. Obtain SVFG nodes for the root value.
2. BFS/DFS over SVFG edges.
3. Maintain a taint label `(source, role, confidence)` per SVFG node.
4. When crossing a value-flow edge, transform the role:
   - `Size` through `align`, `PAGE_ALIGN`, `vring_size` stays `Size`.
   - `Address` through `gep`, `bitcast`, `inttoptr` stays `Address`.
   - `Value` through mask/extract stays `Value`.
   - `FeatureBit` through `virtio_has_feature` boolean result becomes
     `Control` or stays `FeatureBit` depending on use.
5. When a tainted SVFG node corresponds to a sink argument, emit a data-flow
   result.

### 4. Control-dependency rule assembly

For every tainted value that is used as a branch condition:

1. Use ICFG to find direct successor basic blocks.
2. For each successor, check if it directly contains a sink call.
3. If exactly one side contains a sink, emit a control rule with predicate
   inferred from the branch condition.
4. Predicate mapping:
   - `icmp eq/ne 0` -> `Ne`/`Eq`
   - `icmp sgt/ugt 0` -> `Gt`
   - feature bit test -> `BitSet`

### 5. Rule construction

For each source:

1. Collect all reached sinks (data-flow + control).
2. Build a trigger predicate from the first guard that constrains the source.
3. Infer mutation from the predicate:
   - `Ne 0` / `Gt 0` -> `SampleRange` or `SetBoundary`
   - `BitSet n` -> `FlipBit n`
4. Add preconditions: other guards on the same source that are not the trigger.
5. Generate `Rule` with id `function-sourceId`.

## Integration with Existing Pass

The existing `SDGExtractPass.cpp` keeps its JSON output format and its
comparison pipeline. Internally it will:

1. Build `SVFG` and `ICFG` via SVF.
2. Use `SdgSvfCore` to produce a `std::vector<Rule>`.
3. Serialize rules as before.

Legacy heuristics remain as fallback only when SVF analysis fails or times out.

## Build Integration

SVF 3.3 is vendored under `third_party/SVF` and built with a local patch that
forces typed pointers for `extapi.bc` (the default Ubuntu `clang` produces IR
that LLVM 15 cannot parse).

```bash
# One-time build of SVF with the patch.
.morpheus/tools/sdg-extractor/third_party/SVF/build-svf.sh
```

This produces:

```
third_party/SVF/install/lib/cmake/SVF/SVFConfig.cmake
third_party/SVF/install/lib/libSvfCore.a
third_party/SVF/install/lib/libSvfLLVM.a
```

The `sdg-extractor` CMake then:

1. Finds SVF via `find_package(SVF PATHS ${SVF_DIR})`.
2. Builds `SdgSvfCore`.
3. Links `SDGExtractPass.so` against `SdgSvfCore`.

Configure example:

```bash
cmake -S .morpheus/tools/sdg-extractor \
  -B .morpheus/tools/sdg-extractor/builds/svf-test \
  -DLLVM_DIR=/usr/lib/llvm-15/cmake \
  -DSVF_DIR=.morpheus/tools/sdg-extractor/third_party/SVF/install/lib/cmake/SVF
make -C .morpheus/tools/sdg-extractor/builds/svf-test -j$(nproc)
```

## Evaluation Plan

1. **Build/integration smoke test** (`svf_smoke_test`):
   - Loads the merged virtio bitcode.
   - Builds full SVFG and Andersen's pointer analysis.
   - Counts discovered sinks via `SinkCatalog`.
   - Current result: **30,205 SVFG nodes**, **164 sinks**.
2. **Correctness regression**: run unit tests `test_extract.py`.
3. **Coverage**: run on `runs/sdg-extractor-virtio/.../merged.bc` and compare
   against `.morpheus/tools/sdg-extractor/tests/llm_rules/kernel_virtio_llm.json`.
4. **Metrics**:
   - Matched / LLM-only / LLVM-only counts.
   - Newly recovered categories: config copy, feature-controlled allocation,
     DMA SG length, mapping error, coherent queue size.
5. **Performance**: measure analysis wall time vs the old pass.
6. **Precision sampling**: inspect 10 random LLVM-only rules for false
   positives.

## Milestones

1. CMake finds SVF, builds `SdgSvfCore` and links pass.
2. `SemanticValueFlowGraph` wrapper works on merged bitcode.
3. Source/Sink catalogs reproduce existing matched rules.
4. Role taint recovers at least 3 of the remaining LLM-only categories.
5. Document and evaluate final match rate.
