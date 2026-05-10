## Context

`nvirsh` is intended to manage nested virtualization setups that are too
opinionated for a generic VM wrapper. The current problem space is a two-level
stack: L0 prepares and hosts an L1 guest, and L1 provisions and launches L2.
The reference flow shows that these steps are tightly coupled, stateful, and
resumable.

The tool must fit Morpheus conventions: thin shell-backed commands, managed
state under `tools/`, deterministic manifests, and a small public CLI surface.

## Goals / Non-Goals

**Goals:**
- Provide a profile-driven CLI for nested virtualization stacks.
- Keep the public surface to `fetch`, `build`, `exec`, `inspect`, `logs`, and
  `stop`.
- Make `exec` phase-driven so one command can cover boot, provision, nested
  launch, and readiness transitions.
- Store stable profiles and scripts in `tools/nvirsh/`.
- Record run state in manifests that separate L0, L1, provisioning, and L2
  status.

**Non-Goals:**
- Implement a general-purpose virtualization API.
- Support remote orchestration or guest SSH as a first-class public command.
- Preserve legacy verbs like `run`, `launch`, `remove`, or `ssh` on the public
  surface.

## Decisions

### Phase-driven `exec`
Use `exec --phase <name>` instead of separate `up`, `launch`, and `ssh`
subcommands. This keeps the command contract small while still allowing the
runtime to advance through explicit stages.

Alternatives considered:
- Separate verbs for boot, provisioning, and nested launch. Rejected because it
  expands the surface without adding capability.
- A single monolithic `start`. Rejected because resumability and inspection
  become opaque.

### Profile-owned tool data
Keep profiles under `tools/nvirsh/` and treat them as stable repo-owned data.
This keeps the policy for L0 build inputs, guest provisioning, and nested
launch parameters versioned alongside the tool.

Alternatives considered:
- User-provided ad hoc configs only. Rejected because the tool needs reusable
reference profiles.
- libvirt-style XML. Rejected because the tool is not managing a generic domain
API.

### Build prepares runnable state
`build` should resolve inputs and prepare a runnable manifest, but not launch
the stack. That keeps the build step reproducible and makes `exec` the only
command that mutates runtime state.

Alternatives considered:
- Doing all setup in `exec`. Rejected because preflight and runtime are easier
to reason about when separated.
- Combining build and launch. Rejected because it makes reruns expensive.

### Manifested nested state
Record L0, L1, provisioning, and L2 state in a single manifest family so
`inspect`, `logs`, and `stop` can reason about the stack without parsing the
profile or shell scripts.

Alternatives considered:
- Separate ad hoc logs only. Rejected because inspection would be brittle.
- One manifest per layer. Rejected because cross-layer state becomes harder to
coordinate.

## Risks / Trade-offs

- [Phase drift] -> Mitigate with explicit phase names and manifest state
  transitions.
- [Profile sprawl] -> Mitigate by keeping profiles in `tools/nvirsh/` and
  limiting them to stable, reusable setups.
- [Stack teardown ambiguity] -> Mitigate by making `stop` operate on the run
  manifest, not on profile data.
- [Build/runtime coupling] -> Mitigate by keeping runnable manifests separate
  from launch steps and by preserving resumable state.
