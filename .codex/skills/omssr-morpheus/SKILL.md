---
name: morpheus
description: Manage Morpheus workspace metadata, SSH-backed remote runs, logs, manifests, and explicit remote artifact fetches. Use when the user needs remote workspaces, remote Buildroot runs, or Morpheus app behavior.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# morpheus Skill

Use this skill when you need to work with the `morpheus` app in this repo.

## Purpose

`morpheus` is the repo management CLI.
It owns workspace metadata, remote workspaces, SSH-backed remote runs, remote
manifests, remote logs, and explicit remote fetch behavior.

For now, Buildroot is the first remote-managed tool.

## First Steps

When operating as an agent in this repo:

1. Run `pnpm --filter @morpheus/app build` if the CLI has not been built.
2. Run `node apps/morpheus/dist/cli.js --help` to inspect the current surface.
3. Prefer `--json` when the output will be consumed programmatically.
4. Use `remote inspect` or `remote logs` to re-read prior run state instead of
   rerunning work when possible.

Typical flow:

```bash
node apps/morpheus/dist/cli.js workspace create --json
node apps/morpheus/dist/cli.js remote run \
  --tool buildroot \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1 \
  --defconfig qemu_x86_64_defconfig \
  --json
node apps/morpheus/dist/cli.js remote inspect \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --id buildroot-20260419-abcdef12 \
  --json
```

## Command Surface

The main user-facing commands are:

```text
morpheus workspace create
morpheus workspace show
morpheus remote run
morpheus remote inspect
morpheus remote logs
morpheus remote fetch
morpheus runs list
morpheus runs show
morpheus runs export-html
morpheus tool list
morpheus tool verify
morpheus tool path
morpheus tool resolve
morpheus contracts
```

Use these commands by intent:

- `workspace create`: create the standard local workspace layout.
- `workspace show`: inspect workspace roots and their current presence.
- `remote run`: start a managed remote tool run over SSH.
- `remote inspect`: inspect remote manifest state by run id.
- `remote logs`: stream or read remote logs by run id.
- `remote fetch`: copy explicit remote paths from a managed remote run.

## Remote Workspace Model

Treat `--workspace` as a shared high-level remote workspace root.
Morpheus owns the remote workspace lifecycle.
Tools do not own remote workspaces directly.

Expected remote layout for Buildroot:

```text
<workspace>/
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

Use explicit SSH targets with host and optional port:

```bash
node apps/morpheus/dist/cli.js remote run \
  --tool buildroot \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1 \
  --json
```

Use `--detach` when you want the run id immediately and plan to follow up with
`remote inspect`, `remote logs`, or `remote fetch`.

## JSON Contract

Every Morpheus command should be treated as scriptable.
Prefer `--json` for automation.

- Expect `remote run` and `remote logs` to emit stream events before a final
  summary object when JSON mode is enabled.
- Treat remote `manifest.json` paths and final summary objects as the primary
  remote automation contracts.
- Treat remote workspace support as Morpheus-only.

## Boundary Rules

- Use `buildroot` directly for local Buildroot work.
- Use `morpheus remote ...` for remote Buildroot work.
- Do not assume `buildroot remote-*` exists.
