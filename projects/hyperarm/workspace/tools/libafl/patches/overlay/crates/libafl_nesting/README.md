# `libafl_nesting`

`libafl_nesting` provides structured nested-fuzzing support for `LibAFL`.

It owns:

- `ScenarioInput`
- grouped action modeling
- scenario encoding and decoding
- generator and mutator support
- coverage-only `qemu-libafl-bridge` helpers
- the guest stub artifact contract

## QEMU Bridge Coverage

Enable the `qemu-bridge-aarch64` feature to use the patched
`qemu-libafl-bridge` backend through `libafl_qemu`.

This integration is intentionally coverage-only:

- edge coverage builders are re-exported
- address-range coverage filters can be applied
- no guest/host command ABI is defined here

## Guest Stub Artifact

The crate exposes a guest stub binary target:

```bash
cargo build -p libafl_nesting --bin libafl_nesting_stub
```

Later runtime integration may copy that artifact into an L1 userspace image.
