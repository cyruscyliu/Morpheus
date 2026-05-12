## Why

LibAFL needs a structured nested-fuzzing front end that can own testcase
construction, encoding, and guest-stub integration without forcing those
semantics into `nvirsh` yet. This change creates a dedicated `libafl_nesting`
crate so the fuzzing model can be developed and tested independently of the
runtime launcher work.

## What Changes

- Add a new `libafl_nesting` crate under the LibAFL workspace.
- Define a structured `ScenarioInput` model with grouped actions.
- Add generator and mutator support for nested scenarios.
- Add serialization and optional canonicalization for the scenario wire
  format.
- Add a guest stub artifact for the L1 userspace image.
- Add workspace and build wiring for the new crate and its QEMU-facing patch
  set.
- Defer `nvirsh` profile and workflow integration until a later change.

## Capabilities

### New Capabilities
- `libafl-nesting`: Structured nested-fuzzing crate, guest stub artifact, and
  scenario encoding/decoding support for LibAFL.

### Modified Capabilities
- None.

## Impact

- New crate and source files under the LibAFL workspace.
- New guest stub artifact packaging for the L1 image.
- New patch and build wiring for the crate's QEMU-facing integration points.
- Future `nvirsh` integration will consume these artifacts, but is not part of
  this change.
