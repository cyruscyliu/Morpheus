# `libafl_nesting`

`libafl_nesting` provides structured nested-fuzzing support for `LibAFL`.

It owns:

- `ScenarioInput`
- grouped action modeling
- scenario encoding and decoding
- generator and mutator support
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
     serialized scenario input into guest-visible memory.
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

The `libafl_nesting` crate stays focused on structured nested inputs, encoding,
mutation, and the guest stub artifact.
The exact communication model can evolve independently on top of the same
patched QEMU coverage backend.

## Guest Stub Artifact

The crate exposes a guest stub binary target:

```bash
cargo build -p libafl_nesting --bin libafl_nesting_stub
```

Later runtime integration may copy that artifact into an L1 userspace image.
