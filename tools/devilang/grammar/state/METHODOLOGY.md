# State Trace Generation Methodology

This document summarizes the agreed method for generating `state.g4`-based
descriptions from kernel code and callgraph evidence.

## Goal

The goal is not to transliterate source code into DSL mechanically.

The goal is to generate reusable static-analysis summaries with:

- real control flow
- explicit path splits
- reusable function summaries
- IO / SG / DMA leaf visibility

## Layering

Generate descriptions in three layers.

### 1. Entry layer

These are top-level entry functions such as:

- `virtio_mmio_probe`
- `virtnet_probe`
- `virtnet_send_command_reply`

This layer describes function-level control flow and key call sites.

### 2. Summary layer

Stable helper groups that are used repeatedly should live in standalone
summary files.

Examples:

- `virtio_mmio_config_ops.state`
- future `virtio_helpers.state`

When upper-layer analysis reaches one of these functions, it should stop
expanding locally and reuse the summary.

### 3. Leaf layer

Only the leaves we care about should remain at the bottom:

- IO leaves: `read8`, `read16`, `read32`, `write8`, `write16`, `write32`
- SG leaves: `sg_init_one`, `sg_next`
- DMA leaves: `virtqueue_*`, `vring_*`, `dma_*`

Non-interesting leaves should not be expanded unless they are necessary to
keep the path structure coherent.

## Core rules

### Use real entry functions

Start from real source entry points and confirmed callgraph boundaries.
Do not invent artificial dispatch events when the code does not contain them.

### Preserve real control flow

Build traces using:

- `sequence { ... }`
- `repeat { ... }`
- `neqj a, b, @label;`
- `@label: sequence { ... }`

Do not start from an abstract state-machine graph and fill code later.
Start from control flow.

### Keep real function names

When a helper should be represented, use the real function name from source.

Do not invent synthetic helpers like:

- `dma_setup`
- `append_sg`
- `netdev_op_dispatch`

unless they are clearly marked as temporary placeholders and scheduled for
removal.

### Expand by adding traces, not by replacing calls

If a helper should be analyzed further, keep the helper in the upper trace
and add a corresponding lower trace.

Example:

- keep `virtio_cread32(...)` in the upper layer
- add `virtio_cread32_trace`
- continue down to `vdev->config->get`
- continue down to `vm_get`
- continue down to `read32`

Do not replace the upper call with the lower leaf directly.

### Stop expansion at summary boundaries

Expansion can stop when:

1. a leaf of interest is reached
2. a previously defined reusable summary is reached
3. continuing would only enter helpers outside the current scope and would
   not expose new IO / SG / DMA semantics

## Scratch area

### Purpose

Each machine may declare a small scratch area for values derived from reads.

This is used to model "read a value once, use it later" explicitly.

### Placement

Declare scratch explicitly under `initial start`.

Example:

```dsl
machine virtio_mmio_config_ops {
    initial start

    scratch {
        scratch.status;
        scratch.dword;
    }
}
```

### What belongs in scratch

Only values derived from `read*` operations belong in scratch.

Examples:

- `scratch.status = read32(...);`
- `scratch.byte = read8(...);`
- `scratch.features_hi = read32(...);`

### What does not belong in scratch

Inputs, parameters, structure fields, and abstract type/control values do not
belong in scratch.

Examples:

- `len`
- `irq`
- `status` parameter
- `vm_dev.version`

These should be used directly in later checks.

### Use scratch in later control flow

If a value was produced by `read*`, later uses should read from `scratch.*`.

Example:

```dsl
scratch.status = read32(vm_dev.base + VIRTIO_MMIO_STATUS);
neqj scratch.status, 0, @ok;
BUG_ON(scratch.status);
```

## Error and warning semantics

Do not encode these as generic calls.

Represent them with dedicated trace primitives:

- `BUG();`
- `BUG_ON(expr);`
- `WARN_ON(expr);`

Use these at real source locations such as:

- default arms that end in `BUG()`
- invariant checks that use `BUG_ON(...)`
- MMIO postcondition checks that use `WARN_ON(...)`

## Summary-file strategy

### Transport summaries

`virtio_mmio_config_ops` is a good example of a reusable summary group.

It should live in its own file and include:

- `vm_get_trace`
- `vm_set_trace`
- `vm_generation_trace`
- `vm_get_status_trace`
- `vm_set_status_trace`
- `vm_reset_trace`
- `vm_notify_trace`
- `vm_notify_with_data_trace`
- `vm_get_features_trace`
- `vm_finalize_features_trace`
- `vm_find_vqs_trace`
- `vm_del_vqs_trace`
- `vm_get_shm_region_trace`
- supporting helpers such as `vm_setup_vq_trace` and `vm_del_vq_trace`

### Import summaries into higher-level files

Higher-level files should import summary files rather than duplicate them.

Example:

```dsl
import "virtio_mmio_config_ops.state";
```

## Interprocedural expansion examples

### Config read chain

Example expansion:

- `virtio_cread32`
- `vdev->config->get`
- `vm_get`
- `read32`

### Command / DMA chain

Example expansion:

- `virtnet_send_command_reply`
- `virtqueue_add_sgs`
- `virtqueue_add`
- `vring_map_one_sg`
- `vring_map_single`
- `virtqueue_map_single_attrs`
- `virtqueue_map_page_attrs`
- `dma_map_page_attrs`

## Over-approximation and reduction

It is acceptable to build an initial over-approximation first.

Recommended flow:

1. build a conservative initial graph
2. preserve all plausible paths
3. identify infeasible paths later
4. reduce edges gradually

This is preferred over starting too narrow and missing real behavior.

## Practical workflow

1. Pick one real entry function.
2. Build its control-flow skeleton.
3. Store read-derived values in `scratch`.
4. Add labels and `neqj` for real branches.
5. Identify repeated helper groups.
6. Move those helpers into summary files.
7. Continue expansion until IO / SG / DMA leaves are reached.
8. Mark `BUG` / `WARN` semantics explicitly.
9. Revisit helper calls and remove unnecessary non-leaf detail.
10. Reduce over-approximated edges only after a complete first pass exists.

## Current conventions

- Use direct register names such as `VIRTIO_MMIO_STATUS` and
  `VIRTIO_MMIO_VERSION`.
- Keep higher-level helper names visible in upper traces.
- Keep lower-level trace files focused and reusable.
- Prefer one concern per file when a helper family is stable and reused.
