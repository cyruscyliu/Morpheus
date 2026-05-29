## Context

The current repository already has managed build and runtime tooling for QEMU,
`nvirsh`, `libvmm`, and related nested-stack components, but it does not yet
have a dedicated LibAFL-side crate for nested fuzzing semantics. The current
discussion settled on keeping the first change focused on LibAFL itself:
structured nested inputs, encoding, mutators, generators, and a guest stub
artifact. The runtime launcher and profile work in `nvirsh` will come later.

The `tmp/hyperarm-libafl-design.md` draft already narrows the model to what
LibAFL actually supports:

- one input
- one execution
- one terminal result

That means this change should avoid inventing new host-visible execution states
or a new runtime control protocol inside Morpheus. The crate should instead
provide a structured input model and the host/guest conversion glue needed for
future runtime integration.

## Goals / Non-Goals

**Goals:**
- Add a new `libafl_nesting` crate to the LibAFL workspace.
- Define a structured `ScenarioInput` with ordered action groups.
- Provide generator and mutator support for that input.
- Provide scenario serialization and optional decode support for canonicalized
  target output.
- Produce a guest stub artifact that can later be copied into an L1 userspace
  image.
- Keep the crate usable independently of any one runtime launcher.

**Non-Goals:**
- No `nvirsh` profile design in this change.
- No Morpheus workflow or tool contract changes in this change.
- No first-class transport implementation in `nvirsh` in this change.
- No requirement to finalize the exact guest runtime ABI beyond what the crate
  must encode and decode.

## Decisions

### 1. Add `libafl_nesting` as a LibAFL workspace crate
The new functionality should live as a crate inside the LibAFL workspace rather
than as a Morpheus tool.

Rationale:
- The structured input, mutator, generator, and encoding logic are LibAFL-side
  concerns.
- This keeps the fuzzing model versioned with LibAFL instead of leaking into
  runtime tooling.

Alternative considered:
- Add a standalone Morpheus tool first. Rejected because it would force
  launcher/tool semantics before the core fuzzing abstractions are stable.

### 2. Use a structured `ScenarioInput` with ordered groups
The corpus type should be a structured input with explicit ordered action
groups, not a raw byte blob.

Rationale:
- The user wants schema lock-in.
- Group-preserving mutations are easier to express on a structured input.
- This aligns with LibAFL's documented model of keeping an internal structured
  input and serializing it just before execution.

Alternative considered:
- Store only raw bytes and rely on a target-side conveyor. Rejected for this
  change because the desired direction is a host-side structured input.

### 3. Serialize at execution time
The crate should keep the corpus in structured form and serialize it into a
wire format only when preparing a run.

Rationale:
- This is the pattern LibAFL explicitly documents for structured inputs.
- It keeps mutators and generators operating on semantic data instead of a
  packed wire image.

Alternative considered:
- Store already-serialized bytes in the corpus. Rejected because it weakens the
  benefit of structured mutation and grouping.

### 4. Preserve group boundaries in the wire format
Serialization must preserve ordered group boundaries so a future guest stub can
execute and canonicalize scenarios without losing the grouping model.

Rationale:
- Group-level mutation is a first-class feature.
- A canonicalized scenario must remain decodable into the same structural form.

Alternative considered:
- Flatten actions and let the target infer grouping. Rejected because it would
  make host-side grouping non-authoritative.

### 5. Emit a guest stub artifact from the crate build
The crate build should produce a guest stub artifact that later runtime tooling
can place into the L1 userspace image.

Rationale:
- The stub belongs to the LibAFL nesting model.
- `nvirsh` should later consume the artifact rather than define the stub.

Alternative considered:
- Let `nvirsh` generate the stub. Rejected because it couples the stub to one
  runtime platform and weakens crate ownership.

## Risks / Trade-offs

- `[Schema churn]` → Keep the initial action set small and version the wire
  format explicitly inside the crate.
- `[Canonicalization mismatch]` → Require the encoder and decoder to target one
  stable grouped wire format and add round-trip tests.
- `[Premature runtime coupling]` → Keep transport and profile integration out of
  scope for this change.
- `[Stub artifact ambiguity]` → Define one clear build output for the guest stub
  and document that future runtime tooling consumes it.

## Migration Plan

1. Add the new crate to the LibAFL workspace.
2. Add `ScenarioInput`, grouped actions, and serialization support.
3. Add generator and mutator support for the new input.
4. Add build outputs for the guest stub artifact.
5. Add tests for encoding, decoding, and structural mutation behavior.
6. Follow up with a separate change to integrate the crate artifact into
   `nvirsh` profiles and runtime workflows.

## Open Questions

- Should the top-level grouped input reuse an existing LibAFL helper such as
  `ListInput`, or should `libafl_nesting` define its own dedicated input type
  from the start?
- Should canonicalized target output be a required v1 feature, or should the
  first implementation only support encode-to-target and leave decode-from-
  target for a follow-up?
- Should the guest stub artifact be a binary, a library, or both?
