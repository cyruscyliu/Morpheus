# `libafl`

Managed LibAFL source-tree tooling for the `libafl_nesting` crate.

Commands:

- `fetch`
- `patch`
- `build`
- `exec`
- `inspect`

This tool fetches the LibAFL repository, patches in the
`libafl_nesting` crate, builds the guest stub artifact plus the
`qemu_nesting` host fuzzer, and can launch that host-side fuzzer against a
prepared `nvirsh` image.
