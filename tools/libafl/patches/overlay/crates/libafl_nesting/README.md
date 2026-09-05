# `libafl_nesting`

`libafl_nesting` provides structured nested-fuzzing support for `LibAFL`.

It owns:

- `ScenarioInput`, which contains device override records only
- fixed-width override-seed encoding and decoding
- grammar-guided override generation and value mutation
- the guest stub artifact contract

## QEMU Bridge Build Support

Enable the `qemu-bridge-aarch64` feature to build against the patched
`qemu-libafl-bridge` backend through `libafl_qemu`.

This crate keeps the patched QEMU backend available for nested fuzzing, but it
does not define one single mandatory guest/host control ABI.
Instead, there are three practical communication models between the host-side
LibAFL runner and the guest stub:

1. Pure breakpoint model

   - The host sets a breakpoint at a known guest location such as the stub's
     `main()`.
   - When execution stops there, the host snapshots the VM and writes the
     serialized device override seed into guest-visible memory.
   - The host later detects iteration completion using another breakpoint,
     crash, or timeout.

   In this model, the guest stub does not actively signal LibAFL.
   Breakpoints only provide synchronization points.

2. `libvharness` model

   - The guest stub uses the `libvharness` command ABI.
   - The stub triggers a `SyncExit` or custom instruction back to the host.
   - The patched QEMU backend exposes this as a host-visible command boundary.
   - The host parses start, end, and related command arguments from the guest
     register ABI.

   In this model, the guest stub explicitly talks to the host through the
   `libafl_qemu` command path.

The `libafl_nesting` crate stays focused on device override seeds, encoding,
mutation, and the guest stub artifact. The guest and L2 QEMU perform the normal
virtio protocol; the seed never describes that protocol as a trace.
The exact communication model can evolve independently on top of the same
patched QEMU coverage backend.

## Devilang Grammar Configuration

Grammar-guided generation is device-agnostic at the configuration boundary.
Pass a generated state-machine `.state` file, a directory of `.state` files,
or a manifest listing root `.state` files to the LibAFL tool:

```text
--enable-grammar
--grammar <grammar-path>
```

The active workflow uses the virtio-net analysis output, but another workflow
can pass any grammar with the same format. A directory loads every top-level
`.state` file as a root phase; use a manifest when the directory also contains
import-only helper modules. Enabled mode is fail-closed: an unreadable, empty,
or unsupported grammar aborts the fuzzing runner instead of silently falling
back to random generation. The `probe-grammar` tool command loads the path,
generates and mutates a device seed, and prints the readable overrides without
starting QEMU. The `--devilang-grammar` and `--enable-devilang-grammar` names
remain accepted as compatibility aliases.

## Seed-driven virtio device input

The L2 QEMU seed consumer is compiled into the version-scoped qemu-cca patch
used by the workflow. It consumes the same encoded `ScenarioInput` that the
guest stub hands to the L2 launcher; no QMP, vhost-user process, or separate
device backend is involved. The supported Devilang seed directives are:

```text
mmio_read_override(ADDRESS, WIDTH, VALUE);
queue_dma_write(op=OP, dir=DIRECTION, path=PATH, sequence=SEQ,
                queue=QUEUE, payload_len=PAYLOAD_LENGTH,
                used_len=USED_LENGTH);
```

`mmio_read_override` supplies an exact device-side MMIO result. A
`queue_dma_write` is armed by the seed and is consumed after the guest's
native virtqueue-notify MMIO. QEMU performs the descriptor walk, writes the
payload through the device DMA address space, publishes the supplied used
length, and raises the normal virtqueue notification. No virtio-net helper,
MMIO aperture, vhost-user process, or QMP command is involved.

Every replay outcome also contains `seed.trace.jsonl`. It is an observation
record, not an additional device input. It includes the decoded seed overrides,
all generic virtio-MMIO reads and writes, native seed MMIO/DMA events, and
Linux virtio DMA telemetry when available. Teardown and queue-progress events
remain visible in the report without being reinterpreted as new device
actions. CVE-specific QEMU profile patches are not needed by this path.

For debugging, LibAFL exec hides the outer L1 and nested L2 console streams by
default while retaining the complete raw stream in `launcher.stdout.log` for
runtime extraction. Pass `--show-console` (or set
`MORPHEUS_LIBAFL_SHOW_CONSOLE=true`) to display those streams as they arrive.
The LibAFL nesting workflow exposes the same boolean in its `libafl_exec` step;
Set
`workflows.nvirsh-qemu-arm64-cvm-libafl-nesting-fuzzing.metadata.console.show`
(or the corresponding grammar-workflow value) to `true` when running that
workflow interactively.

## Guest Stub Artifact

The crate exposes a guest stub binary target:

```bash
cargo build -p libafl_nesting --bin libafl_nesting_stub
```

Later runtime integration may copy that artifact into an L1 userspace image.
