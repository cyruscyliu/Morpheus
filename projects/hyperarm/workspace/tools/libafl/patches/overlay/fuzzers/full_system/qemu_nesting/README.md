# LibAFL QEMU Systemmode for nesting fuzzing

This folder contains a minimal AArch64 `virt` system-mode nesting example using
`libafl_nesting` on top of `libafl_qemu`.

This example assumes you already have an external guest image or kernel that
contains a userspace fuzzing stub with exported symbols such as:

- `main`
- `FUZZ_INPUT`
- `BREAKPOINT`

The first cut is intentionally simple:

- pure breakpoint start and end boundaries
- a serialized `ScenarioInput` written into guest memory
- a userspace-like guest stub symbol contract
- a simulated crash objective

## Prerequisite

You need a runnable AArch64 `virt` guest image or kernel and initrd that export
the stub symbols the host resolves.

## Build

```bash
cargo build --profile release --features std,breakpoint,arm
```

## Run

```bash
KERNEL=/path/to/Image \
INITRD=/path/to/rootfs.cpio.gz \
./target/release/qemu_nesting \
  -machine virt,virtualization=on,gic-version=3 \
  -cpu cortex-a57 \
  -m 1024 \
  -nographic \
  -kernel /path/to/Image \
  -initrd /path/to/rootfs.cpio.gz \
  -append "console=ttyAMA0 rdinit=/bin/sh" \
  -monitor null \
  -serial null
```
