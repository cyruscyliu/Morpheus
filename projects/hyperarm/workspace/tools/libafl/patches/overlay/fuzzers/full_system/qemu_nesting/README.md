# LibAFL QEMU Systemmode for nesting fuzzing

This folder contains a minimal AArch64 `virt` system-mode nesting example using
`libafl_nesting` on top of `libafl_qemu`.

This example assumes you already have a guest image that auto-runs a userspace
fuzzing stub with exported symbols such as:

- `main`
- `FUZZ_INPUT`
- `BREAKPOINT`

The first cut is intentionally simple:

- pure breakpoint start and end boundaries
- a serialized `ScenarioInput` written into guest memory
- a userspace-like guest stub symbol contract
- a simulated crash objective

## Prerequisite

You need a runnable AArch64 `virt` guest image whose boot-time userspace launches
the stub.

## Build

```bash
cargo build --profile release --features std,breakpoint,aarch64
```

## Run

```bash
STUB=/path/to/libafl_nesting_stub \
./target/release/qemu_nesting \
  <qemu-system-aarch64 arguments for the prepared image>
```
