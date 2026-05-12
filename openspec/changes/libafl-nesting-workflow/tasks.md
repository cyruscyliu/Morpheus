## 1. Workspace Setup

- [x] 1.1 Add the `libafl_nesting` crate to the LibAFL workspace layout
- [x] 1.2 Create the crate module structure for input, generator, mutator, encoding, and stub artifact support

## 2. Scenario Input

- [x] 2.1 Define the `ScenarioInput` type with ordered action groups
- [x] 2.2 Define VM, CPU, hyper, and page-table action enums
- [x] 2.3 Ensure the input types satisfy LibAFL `Input` trait requirements

## 3. Generation And Mutation

- [x] 3.1 Implement a custom generator for `ScenarioInput`
- [x] 3.2 Implement action-level mutators for field edits and action replacement
- [x] 3.3 Implement group-level mutators for insert, delete, duplicate, swap, and splice
- [x] 3.4 Add validation helpers so mutators preserve schema validity and ordered grouping

## 4. Encoding And Decoding

- [x] 4.1 Define a grouped wire format for serialized scenarios
- [x] 4.2 Implement encode support from `ScenarioInput` to target bytes
- [x] 4.3 Implement decode support from canonicalized target bytes back to `ScenarioInput`
- [x] 4.4 Add round-trip tests for grouped scenario serialization

## 5. Guest Stub Artifact

- [x] 5.1 Define the guest stub artifact contract and build output location
- [x] 5.2 Add build support for producing the guest stub artifact
- [x] 5.3 Document the artifact output so later runtime integration can consume it

## 6. Verification

- [x] 6.1 Add unit tests for generator validity
- [x] 6.2 Add unit tests for mutator validity and group-order preservation
- [x] 6.3 Add unit tests for encode/decode correctness
- [x] 6.4 Validate that the crate remains independent of `nvirsh` runtime integration
