## Why

Nested virtualization setup is too brittle to hand-script every time. `nvirsh`
should provide a stable, spec-driven entry point for bringing up, provisioning,
and stopping nested stacks without forcing users to manage the L0/L1/L2 flow
manually.

## What Changes

- Define `nvirsh` as a repo-local, profile-driven tool for nested virtualization
  stacks.
- Keep the public contract limited to `fetch`, `build`, `exec`, `inspect`,
  `logs`, and `stop`.
- Make `exec` phase-driven so the same command can cover boot, provision,
  nested launch, and readiness transitions.
- Treat profiles as stable tool-owned data under `tools/nvirsh/`.
- Allow `build` to prepare L0-side artifacts when a profile requires them.
- Remove separate `run`, `ssh`, `launch`, `remove`, and other extra public
  lifecycle verbs from the user-facing surface.

## Capabilities

### New Capabilities
- `nvirsh-nested-stacks`: Define profile-backed nested virtualization stacks,
  phase-driven execution, and tool-owned profile data.

### Modified Capabilities
- `nvirsh-tool`: Change the public command surface to `fetch`, `build`, `exec`,
  `inspect`, `logs`, and `stop`, and remove extra verbs from the public
  contract.
- `nvirsh-build-run-split`: Change the build/exec split so `build` prepares a
  runnable manifest and `exec` advances it through explicit phases.

## Impact

- `tools/nvirsh`: new profiles, scripts, descriptors, and run manifests.
- `apps/morpheus`: tool descriptor handling for phase-driven exec and managed
  nested runs.
- OpenSpec specs for `nvirsh` command surface, stack lifecycle, and build/run
  behavior.
