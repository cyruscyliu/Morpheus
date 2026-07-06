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
