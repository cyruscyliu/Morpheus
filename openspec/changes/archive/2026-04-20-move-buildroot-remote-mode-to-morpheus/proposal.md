## Why

`buildroot` currently mixes local tool semantics with remote orchestration over
SSH. That makes the tool heavier than necessary and blurs the boundary between
Buildroot-specific behavior and repository-level run management. The repository
is already moving toward `morpheus` as the orthogonal management layer, so
remote workspace provisioning, run identity, logs, artifacts, and SSH-backed
execution should move there.

## What Changes

- Remove `remote-build`, `remote-inspect`, `remote-logs`, and `remote-fetch`
  from the public `buildroot` CLI surface.
- Keep `buildroot` focused on local Buildroot operations such as `build`,
  `inspect`, and `clean`.
- Support remote workspaces only through Morpheus-managed remote runs.
- Do not support remote workspaces when invoking `buildroot` directly.
- Add a Morpheus remote run surface that can execute a single tool node over
  SSH with persistent metadata, logs, and artifact references.
- Make Buildroot the first migrated tool for that remote run model.
- Treat a remote Buildroot invocation as a managed Morpheus run rather than as
  a Buildroot-native remote feature.
- **BREAKING** Remote Buildroot commands move from `buildroot` to `morpheus`.

## Capabilities

### New Capabilities
- `morpheus-remote-runs`: Provide SSH-backed remote managed runs in Morpheus
  with stable ids, manifests, logs, and explicit artifact fetch behavior.

### Modified Capabilities
- `buildroot-cli`: Narrow the Buildroot CLI to local-only semantics and remove
  repo-specific remote orchestration commands.

## Impact

- `tools/buildroot` help, parser, docs, and tests will change.
- `apps/morpheus` will gain a remote managed-run surface.
- Existing users of `buildroot remote-*` will need to migrate to Morpheus
  commands.
- Future tool integrations can reuse the same Morpheus remote model instead of
  inventing one-off remote commands per tool.
