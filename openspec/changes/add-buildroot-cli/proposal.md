## Why

The repository needs a standalone Unix-like CLI for Buildroot workflows that works equally well for humans and agents. Users need one consistent interface for local and SSH-backed remote builds, with first-class structured output and without baking in assumptions about Buildroot artifact semantics.

## What Changes

- Add a new standalone `buildroot` CLI under `tools/` rather than extending existing Morpheus or llbic CLIs.
- Support both local and remote Buildroot workflows, with remote execution over SSH.
- Add remote provisioning that installs pinned official Buildroot release tarballs into a user-specified persistent workspace and can reuse cached downloads/extracted trees.
- Standardize flat Unix-style verbs such as `build`, `inspect`, `clean`, `remote-build`, `remote-inspect`, `remote-logs`, and `remote-fetch`.
- Make `--json` a first-class global flag for all commands, including help output and errors, so agents can rely on machine-readable responses.
- Define generated build IDs as the stable handle for remote inspection, logs, and fetch operations.

## Capabilities

### New Capabilities
- `buildroot-cli`: Provide a standalone Buildroot command-line interface for local and SSH-backed remote Buildroot workflows with human-readable and JSON output modes.

### Modified Capabilities
- None.

## Impact

- New code under `tools/` for the standalone `buildroot` binary and supporting modules.
- New help, JSON response contracts, and documentation for Buildroot workflows.
- New SSH orchestration, remote workspace metadata, and provisioning logic for official Buildroot release tarballs.
