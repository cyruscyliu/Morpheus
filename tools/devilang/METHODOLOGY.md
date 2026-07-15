# Devilang Methodology

This document defines a first-pass methodology for generating `virtio-*`
driver models in Devilang.

The output format is `.state` text accepted by
`tools/devilang/grammar/devilang.g4`.

This version is intentionally narrow.

It is not a general device-modeling method.

It is a `virtio-*` method, with `virtio-mmio` defined now and
`virtio-pci` left as a future extension point.

## Goal

Given user-provided entry surfaces, the LLVM pass should directly emit
phase-specific `.state` models.

The first pass should:

- take explicit `booting` entry surfaces
- take explicit `runtime` entry surfaces
- expand across real function calls
- preserve accurate control flow
- continue until `io ops` leaves are reached
- record `sg` information along the path

The first pass should not try to solve everything.

In particular:

- `head` recovery is not a first-pass requirement
- type inference for `sg` payloads is not a first-pass requirement
- file splitting and reusable summaries are implementation optimizations,
  not core methodology

## Booting

`booting` is the phase before runtime callback operation begins.

For `virtio-mmio`, it has two entry surfaces with fixed order:

1. `transport probe`
2. `driver probe`

These are parallel categories with ordering, not a single merged surface.

### Booting entry surfaces

The user provides the booting entry surfaces explicitly.

Typical `virtio-mmio` examples are:

- `virtio_mmio_driver.probe`
- `virtio_driver.probe`

### Booting boundaries

The local boundary of `transport probe` is:

- the transport probe function returns

The local boundary of `driver probe` is:

- the driver probe function returns

Both belong to the `booting` phase.

### Booting modeling rule

The pass should start from the user-provided booting entries and keep
expanding across real calls until `io ops` leaves are reached.

It must not stop merely because probe-time helper boundaries were reached.

For `virtio-mmio`, transport MMIO behavior is mandatory in this phase.

That means `virtio-mmio` transport operations are part of the required
booting model, not optional detail.

## Runtime

`runtime` starts after probe-time setup has finished.

For `virtio-net`, the runtime phase starts from two parallel entry surfaces:

- `net_device_ops`
- `ethtool_ops`

These are distinct runtime entry surfaces and neither is subordinate to the
other.

### Runtime entry surfaces

The user provides the runtime entry surfaces explicitly.

For `virtio-net`, this means callbacks reachable from:

- `net_device_ops`
- `ethtool_ops`

### Runtime modeling rule

The pass should start from the user-provided runtime entries and keep
expanding across real calls until `io ops` leaves are reached.

It must preserve the real callback-to-helper structure, but the primary
requirement is accurate final `.state` output rather than a particular
file decomposition strategy.

## Leaf

For both `booting` and `runtime`, expansion must continue until leaves are
reached.

### Final leaf definition

In this methodology, the final leaves are `io ops`.

That includes the transport-visible IO operations that the grammar should
expose at the bottom of the model.

### DMA treatment

For the current `virtio-mmio` methodology, `dma ops` are treated as already
collapsed into transport-visible `io/mmio ops`.

So they are not modeled as a separate final leaf family in the first pass.

### Notify treatment

`notify` also ends as `io ops`.

It is not a separate terminal category.

### SG treatment

`sg` is not the final leaf.

But `sg` is mandatory information that must be recorded along the path.

The first pass must therefore preserve scatter-gather setup and submission
evidence even though the final terminal leaf is still `io ops`.

## Control Flow

The output must preserve accurate control flow.

It should not linearize uncertain regions into a fake straight-line trace.

The emitted `.state` should use the grammar forms that already exist:

- `sequence { ... }`
- `repeat { ... }`
- `neqj a, b, @label;`
- `@label: sequence { ... }`

Accuracy is preferred over convenience.

The methodology here is not "best effort approximate CFG pretty-printing".

The methodology is to recover correct phase-local control flow and emit valid
Devilang syntax for it.

## First-Pass Scope

The first pass is responsible for:

- phase-specific `.state` generation
- cross-function expansion to `io ops`
- `sg` recording in the path
- accurate control-flow reconstruction

The first pass is not responsible for:

- `head` recovery
- post-hoc payload type inference
- advanced reusable summary extraction
- generalization to all transports

Those may be added later as separate stages.

## Future Extension

This methodology formally defines `virtio-mmio` first.

`virtio-pci` is a future extension point, but is not specified here beyond
that statement.

## DMA Recovery

Devilang does not treat DMA as an opaque side effect.

For `virtio-net`, the pass tries to recover the DMA-side data structure that
is being submitted, received, or reclaimed.

The recovery algorithm has five layers.

### 1. Normalize the DMA event

The pass first recognizes transport-relevant DMA activity and normalizes it
into a common event form:

- `dma_event(op, dir, path, addr, len, ...)`

This event may come from:

- DMA API paths
- physical-address paths
- scatter-gather setup helpers
- virtqueue submission helpers
- virtqueue detach and unmap helpers

The goal of this layer is only to say:

- what operation happened
- in which direction
- through which path
- at which address and length

### 2. Recover SG payload sources

For each SG slot, the pass walks backward from the SG operand to recover the
buffer value that was actually attached to that slot.

This backward recovery follows:

- `sg_set_buf`
- `sg_init_one`
- `sg_fill_dma`
- `skb_to_sgvec`
- `skb_to_sgvec_nomark`

It also propagates through:

- casts
- GEPs
- loads
- `phi`
- `select`
- stack stores
- cross-function argument passing

This step is phase-local.

`booting` recovery is restricted to the booting phase scope.

`runtime` recovery is restricted to the runtime phase scope.

This prevents runtime SG provenance from contaminating booting output, and
vice versa.

### 3. Infer payload type

Once the source value of a DMA slot is recovered, the pass infers what kind of
payload that value represents.

This is done by combining:

- local def-use and data-flow reasoning
- debug type and debug offset recovery
- callsite-sensitive points-to hints
- use-site hints
- trace-context function names

The result is a payload record with:

- `kind`
- `type`
- `fields`

Typical recovered payload types include:

- `virtio_net_hdr`
- `virtio_net_hdr_v1_hash_tunnel`
- `virtio_net_rss_config_hdr`
- `virtio_net_rss_config_trailer`
- `virtio_net_ctrl_status`
- `xdp_frame`
- concrete packet families

### 4. Split descriptor, chain, and payload layers

The pass does not stop at "this DMA slot points to some buffer".

It models three separate layers.

Descriptor layer:

- records `addr`, `len`, `flags`, and `next`
- splits transport roles such as header, frame, RX, TX, control, and
  packed/split forms

Chain layer:

- groups related SG slots into relative chain schemas
- preserves role order such as "header first, frame second"
- does not falsely claim a global ring-slot meaning when only local SG order
  is known

Payload layer:

- maps descriptor addresses to concrete semantic payload structures
- keeps header payloads distinct from frame payloads
- keeps control payloads distinct from data payloads

### 5. Emit field-level grammar

The final output is not just "DMA of type X".

The pass emits the recovered payload fields into the grammar-visible DMA event.

For example, a recovered `virtio_net_hdr_v1_hash_tunnel` event should expose
fields such as:

- `flags`
- `gso_type`
- `hdr_len`
- `gso_size`
- `csum_start`
- `csum_offset`
- `num_buffers`
- hash and tunnel-related fields

Likewise, RSS and control payloads should expose their own recovered field
sets.

The output goal is therefore:

- DMA event
- associated SG slot or local chain role
- recovered payload type
- recovered payload fields

This lets the `.state` file represent not only that DMA happened, but also
which virtio-side data structure was in motion.

## Examples

Current examples under `tools/devilang/examples/` are still useful as
concrete references:

- `virtio_mmio_config_ops.state`
- `virtio_net_mmio_booting.state`
- `virtio_net_runtime.state`
- `virtnet_netdev.state`
- `virtnet_ethtool_ops.state`
- `virtnet_netdev_callpaths.md`

Read them as examples of shape and coverage.

Do not treat their current file decomposition as the core methodology.

The core methodology is:

- explicit phase-specific entry surfaces
- direct `.state` generation
- expansion to `io ops`
- mandatory `sg` recording
- accurate control flow

## State Replay

Once booting and runtime `.state` files exist, Devilang can compile them into
C and replay a concrete MMIO trace against the generated machine.

This replay path is phase-aware:

- it starts from booting
- it keeps booting and runtime in one machine
- it consumes MMIO read/write events plus decoded DMA aperture events
- it reports both:
  - `matched`: states that the current event actually matched
  - `active`: states that remain reachable after the event

The replay view reports the currently executing trace and block directly.

For example, a DMA submit observed while replaying `start_xmit` may appear as
`vring_map_one_sg_trace` or `vring_map_single_trace`, because those helper
traces are the concrete states currently consuming the event.

Replay scope is still bounded by the explicit entry surfaces used to produce
the `.state` files.

For `virtio-net`, if runtime replay was built only from `net_device_ops` and
`ethtool_ops`, then unrelated interrupt-driven completion paths are outside
that runtime scope. Such out-of-scope events should not be treated as replay
failure; they may leave the machine with no active in-scope candidates until a
later in-scope runtime event appears again.

For real trace replay, the `.state` inputs should come from the LLVM pass
output, not directly from `tools/devilang/examples/`.

In the HyperArm workflow this means using the `devilang_exec` artifacts:

- `booting-state`
- `runtime-state`

Minimal workflow-oriented usage:

```bash
tools/devilang/devilang replay-trace \
  --input booting.state \
  --input runtime.state \
  --trace-log tools/devilang/tests/fixtures/replay-trace/trace.txt \
  --output virtio-trace-replay.txt \
  --symbol-prefix virtio_trace_sm
```

The authoritative validation path is the workflow replay that consumes
LLVM-pass-produced `booting.state` and `runtime.state`.

## DMA Hint Recovery

For DMA payload recovery, Devilang now consumes a structured
`points-to-json` hint stream.

This stream may come from:

- `llcg` / `KallGraph`
- Devilang's own embedded SVF helper

The current schema is intentionally simple:

- `points_to_types`
- `points_to_values`
- `taint_types`
- `taint_calls`
- `taint_use_sites`
- `taint_fields`

`points_to_*` captures alias and points-to results for the seed payload
pointer.

`taint_*` captures a stronger use-flow summary from the seed across SVFG
use sites.

Devilang currently merges `points_to_types` and `taint_types` when
recovering `dma_event(..., data_type=...)`.

When available, `taint_fields` is emitted back into `.state` as repeated
`data_field=...` arguments on `dma_event(...)`.

This is the first step toward full DMA internal-structure recovery.

## MMIO Value Recovery

MMIO value recovery is separate from the booting/runtime split.

It only depends on:

- transport register layout
- data flow
- control flow

For `virtio-mmio`, the pass treats each register access as a small typed value
recovery problem.

### 1. Bind the access to a concrete register schema

For each `readl` / `writel` style transport access, the pass first resolves:

- direction
- transport offset
- width
- register schema name

This binds the operation to a grammar-visible `struct`, such as:

- `virtio_mmio_status`
- `virtio_mmio_device_features`
- `virtio_mmio_queue_notify`
- `virtio_mmio_queue_sel`

Dynamic config-space accesses under `0x100 + offset` are handled similarly, but
their schema names are derived from `struct virtio_net_config` debug layout or
fallback field tables.

### 2. Recover write-side composition

For MMIO writes, the pass walks backward from the value operand.

It propagates through:

- `phi`
- `select`
- casts
- `zext` / `sext` / `trunc`
- `and`
- `or`
- `shl` / `lshr`
- cross-function argument passing
- direct and resolved indirect callee returns

This recovers how a register value is built.

Examples:

- selector/immediate writes such as `queue_sel`, `status`, and feature-bank
  selectors
- packed writes such as `queue_notify`
- flag writes composed from OR-ed status or feature bits

For `virtio_mmio_queue_notify`, the pass should preserve the transport-facing
32-bit value and also expose the known overlapping layouts:

- low 16 bits: `queue_index`
- high 16 bits in split rings: `split_next_avail_idx`
- high 16 bits in packed rings: `packed_off_wrap`
- packed-ring subfields:
  - `packed_event_idx`
  - `packed_wrap_counter`

The pass records:

- whole-register immediate values
- observed bit masks
- selector-banked bit masks when a register is accessed through a selector

### 3. Recover read-side interpretation

For MMIO reads, the pass walks forward from the read result.

It tracks how the read value is consumed by:

- comparisons against constants
- `switch` dispatch
- `phi`
- `select`
- mask/extract logic such as `and`, `trunc`, `shl`, and `lshr`

This recovers how software interprets the register.

Examples:

- `virtio_mmio_status` bits consumed as `ACKNOWLEDGE`, `DRIVER`,
  `FEATURES_OK`, `DRIVER_OK`, or `FAILED`
- feature-bank reads where specific bits are tested via
  `virtio_has_feature`
- interrupt status and acknowledge masks

### 4. Lift the result into grammar-visible fields

Recovered MMIO semantics are emitted through normal Devilang `struct` fields.

Typical field forms are:

- named immediates
- named flags
- selector-banked flag groups
- raw scalar fields when no stronger structure is recoverable

This keeps MMIO modeling consistent with DMA modeling:

- both are emitted through the grammar
- both can later drive replay and matching
- neither depends on phase boundaries for their internal data semantics

### 5. Keep transport-specific knowledge narrow

The current implementation formally models `virtio-mmio`.

That means:

- register offsets and field names are transport-specific
- the value-recovery algorithm itself is transport-agnostic

Future work can extend the same algorithm to `virtio-pci` by swapping the
transport register catalog, without changing the core backward/forward value
recovery scheme.
