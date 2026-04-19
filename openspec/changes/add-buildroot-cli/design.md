## Context

This change introduces a standalone `buildroot` CLI focused on orchestrating upstream Buildroot usage rather than redefining Buildroot itself. The CLI must support both local and remote operation, but remote behavior is the main architectural concern because it requires SSH transport, provisioning, persistent remote workspaces, generated build IDs, streaming logs, and consistent JSON contracts for agents.

The user explicitly wants broad Unix-style coverage with flat verbs, no workflow config in v1, and all operational inputs passed through flags. The tool should avoid making semantic assumptions about Buildroot artifacts beyond what the user explicitly asks for. In particular, remote fetch operations should act as path-copy primitives keyed by build ID and remote workspace, not as an opinionated artifact API.

## Goals / Non-Goals

**Goals:**
- Deliver a standalone `buildroot` executable under `tools/`.
- Provide a flat Unix-like command surface for local and remote workflows.
- Support SSH targets including explicit ports.
- Provision remote Buildroot installations from official release tarballs.
- Reuse cached remote tarballs and extracted trees when the requested version already exists.
- Store remote build metadata in a persistent workspace and identify builds by generated IDs.
- Make `--json` available for every command, including help, errors, and remote orchestration commands.
- Stream logs for blocking remote builds by default and support `--detach` for asynchronous operation.

**Non-Goals:**
- Adding HTTP, queue-based, or non-SSH remote transports in this change.
- Introducing workflow config files or repo-wide configuration in v1.
- Inferring or standardizing Buildroot artifact layouts beyond explicit user input.
- Replacing upstream Buildroot configuration/build semantics with a new build model.

## Decisions

### 1. Use a standalone tool under `tools/`

The CLI will live under `tools/` as its own tool rather than extending `apps/cli` or `tools/llbic`.

Why:
- The tool has a separate purpose and lifecycle from Morpheus catalog commands and from llbic.
- A standalone tool can own its own docs, tests, and packaging expectations.

Alternatives considered:
- Extending `apps/cli`: rejected because it would turn Buildroot orchestration into a subfeature of an unrelated CLI.
- Extending `tools/llbic`: rejected because Buildroot is a distinct workflow and should not inherit llbic semantics.

### 2. Use flat top-level verbs

The public interface will prefer flat verbs such as `build`, `inspect`, `clean`, `remote-build`, `remote-inspect`, `remote-logs`, and `remote-fetch`.

Why:
- This better matches Unix-style ergonomics for typing, piping, and shell completion.
- It keeps human and agent invocation compact while still leaving room for explicit flag-based configuration.

Alternatives considered:
- Hierarchical commands such as `remote build`: rejected because the user explicitly preferred a flatter Unix feel.

### 3. Treat `--json` as a universal output contract

Every command will accept `--json`, including `help`, validation failures, and remote lifecycle commands.

Why:
- Agents need predictable machine-readable responses everywhere, not only on success paths.
- A universal contract avoids special cases when scripting command discovery, status inspection, and error handling.

Alternatives considered:
- JSON only on selected commands: rejected because it creates gaps for agent workflows.

### 4. Remote execution uses persistent workspaces plus generated build IDs

Remote operations will run under a user-specified workspace directory on the remote host. Each remote build creates a generated build ID and stores metadata beneath that workspace.

Why:
- Build IDs provide a stable reference for later `remote-inspect`, `remote-logs`, and `remote-fetch` operations.
- A persistent workspace supports cache reuse across builds and avoids losing state after the initial command exits.

Alternatives considered:
- Temporary per-build workspaces: rejected because they weaken inspection and cache reuse.
- Identifying builds only by remote path: rejected because it is less ergonomic and more error-prone than generated IDs.

### 5. Provision remote Buildroot from official release tarballs with cache reuse

`remote-build` will ensure the requested Buildroot release exists in the remote workspace, downloading official release tarballs and reusing cached tarballs or extracted trees when possible.

Why:
- This matches the user requirement to provision automatically from upstream official releases.
- Reuse reduces repeated downloads and setup time for iterative builds.

Alternatives considered:
- Git-based provisioning: rejected because the user explicitly chose official release tarballs.
- Local-tree sync: rejected because the user explicitly did not want that model.

### 6. Keep Buildroot semantics thin

The CLI will mainly orchestrate upstream Buildroot commands and transport/log/copy behavior rather than inventing new assumptions about artifacts.

Why:
- Buildroot users can structure outputs differently; the CLI should not overfit to one policy.
- This keeps the tool generally useful across boards, defconfigs, and custom workflows.

Alternatives considered:
- Artifact-aware fetch defaults: rejected because the user explicitly said the CLI “should not know”.

## Risks / Trade-offs

- [SSH environment drift] → Mitigate by validating remote prerequisites early and emitting structured diagnostics in both text and JSON modes.
- [Persistent workspace accumulation] → Mitigate by defining explicit `clean` behavior for local and remote metadata/work directories.
- [JSON output for streaming commands is tricky] → Mitigate by defining a line-oriented event schema for streaming mode and a final summary object for completion.
- [Buildroot command passthrough can become ambiguous] → Mitigate by clearly separating CLI-owned flags from forwarded Buildroot arguments in help and parsing logic.
- [Remote cache reuse may surface stale state issues] → Mitigate by storing versioned provisioning metadata and offering explicit clean/reset operations.

## Migration Plan

No production migration is required because this is a new standalone tool. Implementation should proceed by introducing the new tool, documenting its command contract, and validating representative local and SSH-backed remote flows.

## Open Questions

- Which exact forwarded Buildroot argument model should the CLI expose first: explicit flags, `--` passthrough, or a hybrid?
- What remote metadata layout is most maintainable for build IDs, logs, and provisioning state?
- Should streaming JSON logs use newline-delimited JSON events, or another structured streaming format?
