---
name: buildroot
description: Run local Buildroot workflows, inspect local build metadata, and validate the CLI with the smoke fixture. Use when the user wants to build with Buildroot locally, inspect a prior local build, or reason about the local Buildroot CLI boundary.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# buildroot Skill

Use this skill when you need to work with the `buildroot` CLI in this repo.

## Purpose

`buildroot` is a standalone Unix-like CLI for local Buildroot workflows.
It supports local builds, local manifest inspection, local cleanup, and
explicit JSON output.

Remote workspaces are not part of `buildroot`.
Use Morpheus for managed local or remote runs, inspection, logs, and fetch
operations when workspace-managed execution matters.

## First Steps

When operating as an agent in this repo:

1. Run `pnpm --filter @morpheus/buildroot build` if the CLI has not been built.
2. Run `node tools/buildroot/dist/index.js --help` to discover the current
   command surface.
3. Prefer `--json` when the output will be consumed programmatically.
4. Use `inspect` to re-read local metadata instead of rerunning a build when
   possible.

Typical flow:

```bash
node tools/buildroot/dist/index.js --help
node tools/buildroot/dist/index.js build \
  --source ./some-buildroot-tree \
  --output ./out \
  --defconfig qemu_x86_64_defconfig \
  --json
node tools/buildroot/dist/index.js inspect --output ./out --json
```

## Command Surface

The main user-facing commands are:

```text
buildroot build
buildroot inspect
buildroot clean
```

Use these commands by intent:

- `build`: run a local Buildroot workflow against a source tree.
- `inspect`: read a local manifest from a prior run.
- `clean`: remove a local output or explicit path.

## Remote Boundary

If the user needs a remote workspace:

- do not look for `buildroot remote-*`
- use Morpheus instead
- treat remote workspace lifecycle as a Morpheus concern

Typical remote handoff:

```bash
node apps/morpheus/dist/cli.js run \
  --tool buildroot \
  --mode remote \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1 \
  --defconfig qemu_x86_64_defconfig \
  --json
```

## JSON Contract

Every command supports `--json`, including `--help` and error cases.

- Prefer `--json` for automation.
- Treat local manifest files as the primary stable automation contract.

## Smoke Test

The repo includes a tiny fixture for fast validation of the local CLI path.
Use it when you want to confirm the command surface without downloading a real
Buildroot release.

```bash
pnpm --filter @morpheus/buildroot smoke
```

The smoke test verifies that `buildroot build` and `buildroot inspect` can
produce and read a small local artifact and manifest.
