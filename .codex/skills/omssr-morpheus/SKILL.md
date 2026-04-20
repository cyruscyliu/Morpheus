---
name: morpheus
description: Manage Morpheus workspace metadata, managed local and remote tool runs, logs, manifests, and explicit artifact fetches. Use when the user needs Morpheus-managed Buildroot runs, local or remote workspaces, or Morpheus app behavior.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# morpheus Skill

Use this skill when you need to work with the `morpheus` app in this repo.

## Purpose

`morpheus` is the repo management CLI.
It owns workspace metadata, managed local and remote runs, manifests, logs,
and explicit fetch behavior for supported tools.

For now, Buildroot is the first managed tool.

## First Steps

When operating as an agent in this repo:

1. Run `pnpm --filter @morpheus/app build` if the CLI has not been built.
2. Run `node apps/morpheus/dist/cli.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.
4. Use `inspect` or `logs` to re-read prior run state instead of rerunning
   work when possible.

Optional repo-local config for one local workspace and one remote workspace:

```yaml
workspace:
  root: ./workflow-workspace
  remote: true
remote:
  ssh: builder@example.com:2222
  workspace:
    root: ./remote-workflow-workspace
```

Optional repo-local config for only Buildroot running remotely:

```yaml
workspace:
  root: ./workflow-workspace
remote:
  ssh: builder@example.com:2222
  workspace:
    root: ./remote-buildroot-workspace
tools:
  buildroot:
    mode: remote
```

Typical flow:

```bash
node apps/morpheus/dist/cli.js workspace create --json
node apps/morpheus/dist/cli.js tool run \
  --tool buildroot \
  --mode remote \
  --source tools/buildroot/test/fixtures/minimal-buildroot \
  --defconfig qemu_x86_64_defconfig \
  --json
node apps/morpheus/dist/cli.js inspect \
  --id buildroot-20260419-abcdef12 \
  --json
```

## Command Surface

The main user-facing commands are:

```text
morpheus workspace create
morpheus workspace show
morpheus tool run
morpheus list
morpheus inspect
morpheus logs
morpheus fetch
morpheus remove
morpheus runs list
morpheus runs show
morpheus runs export-html
morpheus tool list
morpheus tool verify
morpheus tool resolve
morpheus contracts
```

Use these commands by intent:

- `workspace create`: create the standard local workspace layout.
- `workspace show`: inspect workspace roots and their current presence.
- `tool run`: start a managed tool run in local or remote mode.
- `tool runs`: list managed runs, optionally scoped by workspace or SSH target.
- `tool inspect`: inspect managed manifest state by run id and reconcile stale
  remote runs when final state was not written back cleanly.
- `tool logs`: stream or read managed logs by run id.
- `tool fetch`: copy explicit paths from a managed run.
- `tool remove`: remove a managed run by id.

## Managed Workspace Model

Treat `--workspace` as a shared high-level workspace root.
Morpheus owns the managed workspace lifecycle.
Tools do not own managed workspaces directly.

Expected managed layout for Buildroot:

```text
<workspace>/
  downloads/
  sources/
  builds/
  runs/
  cache/
  tmp/
  tools/
    buildroot/
      cache/
      src/
      runs/
        <id>/
          manifest.json
          stdout.log
          output/
```

Use explicit SSH targets with host and optional port for remote mode:

```bash
node apps/morpheus/dist/cli.js tool run \
  --tool buildroot \
  --mode remote \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --source tools/buildroot/test/fixtures/minimal-buildroot \
  --json
```

Use local mode when Morpheus should manage the same tool in a local workspace:

```bash
node apps/morpheus/dist/cli.js tool run \
  --tool buildroot \
  --mode local \
  --workspace workflow-workspace \
  --source tools/buildroot/test/fixtures/minimal-buildroot \
  --defconfig qemu_x86_64_defconfig \
  --json
```

Use `--detach` when you want the run id immediately and plan to follow up with
`inspect`, `logs`, or `fetch`.

When `morpheus.yaml` defines either a workspace remote or a tool remote, you
can omit `--ssh`.

## JSON Contract

Every Morpheus command should be treated as scriptable.
Prefer `--json` for automation.

- Expect `run` and `logs` to emit stream events before a final summary object
  when JSON mode is enabled.
- Treat managed `manifest.json` paths and final summary objects as the primary
  automation contracts.
- Treat workspace support as Morpheus-managed.
- Treat run ids as the primary lookup key for `inspect`, `logs`, `fetch`, and
  `remove`.

## Boundary Rules

- Use `buildroot` directly for unmanaged Buildroot work.
- Use `morpheus tool run --tool buildroot --mode local|remote` for managed runs.
- Use `morpheus list` and `morpheus remove` for managed run lifecycle work.
- Do not assume `buildroot remote-*` exists.
