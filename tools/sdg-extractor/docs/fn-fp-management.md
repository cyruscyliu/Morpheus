# False-Negative and False-Positive Management

This document explains how `sdg-extractor` keeps false negatives close to zero
while still providing levers to reduce false positives. The current workflow is
**recall-first**: the analysis intentionally over-approximates, then
post-processes in `src/llvm-pass/SDGExtractPass.cpp`.

---

## 1. Goal: Near-Zero False Negatives

A false negative here means a real guest-controlled value reaches a
security-relevant operation but the extractor misses it. To drive FN toward
zero we over-approximate at every stage:

| Stage | Soundness Choice |
|-------|------------------|
| **Source discovery** | Any `readl`/`readw`/`readb`/`readq`/`ioread*` is a source, even with unknown offset. Any `virtio_cread*` is a source. Any known guest-controlled struct field is a source. Any integer argument named like `len`/`size`/`num` is a source. |
| **Sink discovery** | Explicit sink list plus pattern fallback for allocation, memcpy, DMA, network, MMIO-write, and virtqueue families. A single call may return multiple semantic sinks (one per argument). |
| **Value-flow propagation** | Forward BFS over SVFG, depth bound 1024, crossing call/return and store->load edges. |
| **Control dependency** | Branch/switch condition is considered source-dependent if any SVFG-reachable value from the source feeds it. Both sides of a branch are explored. Function sink summaries are transitive. |
| **Modeled sinks** | When a public kernel API is not in the merged bitcode, we emit a modeled rule at the virtio helper that calls it. |

### Evidence

| Check | Result |
|-------|--------|
| LLM rule strict-subset match (`tests/llm_rules/kernel_virtio_llm.json`) | 24 / 24 |
| Unit tests (`tests/test_extract.py`) | 4 / 4 PASS |

---

## 2. False-Positive Root Causes

Over-approximation naturally creates false positives. The table below lists the
main causes seen in the virtio-net kernel workflow, ordered by volume.

### 2.1 Feature-Bit Control Dependency Explosion

**Observation**: a single feature-bit source such as
`MmioFeature.VIRTIO_NET_F_CSUM` produced hundreds of rules before filtering.

**Root cause**: control dependency used to ask whether a sink is *reachable*
from a branch side, not whether the sink is *actually controlled* by that
branch. Many kmalloc/memcpy/memset calls appear after a feature check but are
not genuinely gated by it.

**Mitigation**: only emit a sink when it is reachable from one branch/switch
side but not the others (keyed by `function + argIndex`). Internal virtqueue/vring
helper sinks are additionally blocklisted in `SDGExtractPass.cpp`.

**Count impact**: was the largest contributor to the ~8,100 rule output;
reduced significantly through side-unique filtering and the blocklist.

**Where it lives**: `src/svf-core/lib/ControlDependencyAnalysis.cpp`,
`analyze()`; `src/llvm-pass/SDGExtractPass.cpp`.

### 2.2 Sink Pattern Fallback Treats Multiple Arguments as Sinks

**Observation**: `memcpy` (1,123 rules), `memset` (694 rules), `kmalloc`
(625 rules) dominated the sink list before tightening.

**Root cause**: the pattern fallback for `memcpy` registered arg0, arg1, and
arg2 as sinks, and similarly for allocation families. A source that reached a
pointer or flags argument was reported as a size/address rule.

**Mitigation**: pattern fallback now registers only semantically-correct
argument indices (e.g. `memcpy` size = arg2, `kmalloc` size = arg0/arg1 for
variants, `skb_put` size = arg1).

**Where it lives**: `src/svf-core/lib/SinkCatalog.cpp`, `match()` pattern
fallback block.

### 2.3 Heuristic Argument Sources

**Observation**: `InternalState.state.*` sources generated about 1,800 rules
before scoping.

**Root cause**: integer arguments whose names contain `len`, `size`, `num`,
etc. were treated as guest-controlled in *any* function. Many of these values
are kernel internal state (e.g. `netmem`, `truesize`, `orphan`) in generic
helper code.

**Mitigation**: the heuristic is now enabled only when the enclosing function
name contains `virtio`, `vring`, `virtqueue`, `virtnet`, `xdp`, or `napi`.

**Where it lives**: `src/svf-core/lib/SourceCatalog.cpp`, `matchArgument()`.

### 2.4 Internal Virtqueue Helpers Matched as Sinks

**Observation**: `virtqueue_add_indirect_packed` (346 rules),
`virtqueue_add_desc_split` (252 rules), etc.

**Root cause**: the `virtqueue_add*` pattern fallback matches internal helper
functions as well as public wrappers. Sources reaching their arguments are not
always security relevant.

**Where it lives**: `src/svf-core/lib/SinkCatalog.cpp`, `match()`.

### 2.5 `virtio_has_feature` Self-Check Rules

**Observation**: 850 rules have `virtio_has_feature` as their sink.

**Root cause**: the feature-bit argument is also registered as a source so
that self-check rules are emitted. This is semantically correct but numerous.

**Where it lives**: `src/svf-core/lib/SourceCatalog.cpp`,
`extraSourcesForCall()`.

### 2.6 Unknown/High Feature Bits

**Observation**: sources like `MmioFeature.BIT_63` appear.

**Root cause**: `__virtio_test_bit` is called with constant bit indices that
are not mapped to a known feature name. Some of these may be kernel-internal
checks rather than guest-visible features.

**Where it lives**: `src/svf-core/lib/SourceCatalog.cpp`, `matchCall()`.

---

## 3. Filters Already in `SDGExtractPass.cpp`

The pass is the preferred place for precision filters because it sees the
fully assembled rules and can apply cheap, auditable heuristics without
weakening the core analysis.

### 3.1 Drop Empty-Sink Generic Control Rules

Control dependency emits a rule even when no sink is reachable on a branch
side, so that feature-bit checks remain visible. These empty-sink rules are
mostly noise when the predicate is a generic `Ne`/`Eq`.

Filter:

```cpp
// Keep BitSet/BitClear empty-sink rules (meaningful feature checks).
// Drop all other empty-sink control rules.
```

**Effect**: removed ~1,600 rules; no impact on LLM match.

### 3.2 Exclude Obviously Internal Argument Names

The argument heuristic now skips names that are known Linux kernel internal
state rather than guest input:

- `orphan`
- `truesize`
- `netmem`
- `users`
- `refcnt`
- `nohdr`
- `pkt_type`
- `priority`
- `protocol`

**Effect**: removed ~300 rules; no impact on LLM match.

### 3.3 Side-Unique Control Sinks

Control dependency now compares the sinks reachable from each branch/switch
side. A sink is emitted only if it is reachable from one side but not the
others (keyed by `function + argIndex`). This removes the common case where a
sink is reachable regardless of the branch outcome.

**Where it lives**: `src/svf-core/lib/ControlDependencyAnalysis.cpp`,
`analyze()`.

**Effect**: large reduction in feature-bit rule explosion; no impact on LLM
match.

### 3.4 Canonical Argument Indices for Pattern Fallback

The sink pattern fallback now registers only semantically-correct argument
indices for each function family. For example:

- `memcpy` / `memmove` / copy helpers: size = arg2
- `kmalloc` / `kzalloc` / variants: size = arg0 or arg1
- `skb_put*` / `napi_alloc_skb`: size/length = arg1
- `virtqueue_add*` / `vring_add*`: scatter/gather count = arg2/arg3

**Where it lives**: `src/svf-core/lib/SinkCatalog.cpp`, `match()`.

**Effect**: reduced `memcpy`/`memset`/`kmalloc` noise; no impact on LLM match.

### 3.5 Scope Argument Heuristic to Virtio-Related Functions

The `len`/`size`/`num` argument-source heuristic is now applied only inside
functions whose names contain `virtio`, `vring`, `virtqueue`, `virtnet`, `xdp`,
or `napi`. Explicit argument schemas are unaffected and still apply everywhere.

**Where it lives**: `src/svf-core/lib/SourceCatalog.cpp`, `matchArgument()`.

**Effect**: reduced `InternalState.state.*` noise from generic kernel helpers;
no impact on LLM match.

### 3.6 Drop Conversion-Helper Control Rules

Control-dependency rules whose only sinks are endian-conversion helpers
(`cpu_to_virtio*`, `virtio*_to_cpu`) are dropped. The same source is usually
still reported through a data-flow rule that reaches the real security sink.
Data-flow rules with conversion-helper sinks are intentionally kept.

**Where it lives**: `src/llvm-pass/SDGExtractPass.cpp`.

**Effect**: removed conversion-helper noise from control rules; no impact on
LLM match.

### 3.7 Deduplicate `virtio_has_feature` Self-Checks

The bit argument of `virtio_has_feature` is also registered as a source so
that self-check rules are emitted. The same feature bit is checked in many
functions, producing one rule per function. Only the first self-check rule per
feature-bit source id is kept.

**Where it lives**: `src/llvm-pass/SDGExtractPass.cpp`.

**Effect**: reduced ~700 self-check rules to ~70; no impact on LLM match.

### 3.8 Global Pair Deduplication

After all other filters, data-flow and modeled rules are deduplicated by the
`(source id, sink function, sink arg index)` triple across the whole module.
Only the first occurrence is kept; control-dependency rules are exempt because
the branch function is part of the semantics.

**Where it lives**: `src/llvm-pass/SDGExtractPass.cpp`.

**Effect**: further ~15% rule reduction; no impact on LLM match.

### 3.9 Feature-Bit Control Sink Blocklist

Feature-bit control-dependency rules whose sinks are internal virtqueue/vring
helpers (`vring_create_*`, `vring_map_*`, `virtqueue_add_indirect_*`,
`virtqueue_add_packed_*`, `virtqueue_add_desc_split`, etc.) or endian-conversion
helpers are dropped. Public wrappers such as `virtqueue_add_sgs` and
security-relevant sinks remain.

**Where it lives**: `src/llvm-pass/SDGExtractPass.cpp`.

**Effect**: removed internal-helper noise from feature-bit control rules; no
impact on LLM match.

---

## 4. Recommended Next Filters

All of these can be added in `SDGExtractPass.cpp` or in the core layer,
depending on whether the change weakens soundness.

### 4.1 Feature-Bit Range Validation

Drop feature-bit sources with indices clearly outside the valid guest-visible
range, or require the bit to appear in a known feature bitmap.

**Expected impact**: removes `BIT_63`-style noise.
**Risk**: low for known devices; higher for new device types.

---

## 5. Confidence as a Filtering Knob

Rules already carry a confidence value:

| Source | Confidence |
|--------|------------|
| SVFG dataflow | 0.9 |
| Self-check argument | 0.7 |
| External-API modeled | 0.6 |
| Source-level modeled | 0.5 |
| `memcpy` size modeled | 0.55 |
| Control dependency | 0.55 |

A downstream consumer can therefore drop everything below 0.7 and keep only
high-confidence dataflow rules. This is useful for triage, but should not be
the primary recall-first output because some LLM-modeled rules have lower
confidence.

---

## 6. Summary

- **FN strategy**: over-approximate sources, sinks, value-flow, and control
  dependency; model external APIs and protocol-level relationships.
- **FP strategy**: keep the core sound, then filter in
  `src/llvm-pass/SDGExtractPass.cpp`.
- **Current state**: 24/24 LLM match, ~3,800 rules.
- **Biggest remaining FP**: feature-bit branches that still produce side-unique
  allocation/copy sinks; some may be true positives depending on the feature.

---

## 6. Stopping Point

Further generic FP reduction would start removing true-positive source-sink
relationships:

- The remaining `kmalloc` / `memcpy` / `memset` / `skb_put` / `dma_map_*`
  rules are exactly the security-relevant sinks the extractor is designed to
  find.
- `InternalState.state.*` sources such as `qp_index`, `buflen`, and `total_sg`
  are derived from guest-visible config or descriptors; tightening them risks
  false negatives.
- Feature-bit branches genuinely gate many allocation/copy paths; the remaining
  rules need per-feature manual review rather than another blanket filter.

The current output is therefore treated as the recall-first baseline for this
workflow. Any additional precision should come from downstream confidence
thresholding or device-specific sink allowlists, not from weakening the core
analysis.
