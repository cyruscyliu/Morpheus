---
name: buildroot
description: Run local and SSH-backed remote Buildroot workflows, inspect build metadata, fetch explicit remote artifacts, and validate the CLI with the smoke fixture. Use when the user wants to build with Buildroot, inspect a prior run, or reason about shared remote workspaces and Buildroot CLI behavior.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# buildroot Skill

Use this skill when you need to work with the `buildroot` CLI in this repo.

## Purpose

`buildroot` is a standalone Unix-like CLI for local and remote Buildroot
workflows. It supports local builds, SSH-backed remote builds, explicit JSON
output, generated build ids, remote inspection, remote log streaming, and
explicit remote fetch operations.

## First Steps

When operating as an agent in this repo:

1. Run `pnpm --filter @morpheus/buildroot build` if the CLI has not been built.
2. Run `node tools/buildroot/dist/index.js --help` to discover the current
   command surface.
3. Prefer `--json` when the output will be consumed programmatically.
4. Use `inspect` or `remote-inspect` to re-read metadata instead of rerunning a
   build when possible.

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
buildroot remote-build
buildroot remote-inspect
buildroot remote-logs
buildroot remote-fetch
```

Use these commands by intent:

- `build`: run a local Buildroot workflow against a source tree.
- `inspect`: read a local manifest from a prior run.
- `clean`: remove a local output or explicit path.
- `remote-build`: provision and run Buildroot over SSH.
- `remote-inspect`: read remote metadata by build id.
- `remote-logs`: stream or read remote logs by build id.
- `remote-fetch`: copy explicit remote paths for a build id.

## Remote Workspace Model

Treat `--workspace` as a shared high-level workflow workspace. `buildroot`
should use a namespaced tool area under that workspace rather than assuming it
owns the workspace root.

Expected remote layout:

```text
<workspace>/
  tools/
    buildroot/
      cache/
      src/
      builds/
```

Use explicit SSH targets with host and optional port:

```bash
node tools/buildroot/dist/index.js remote-build \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1 \
  --defconfig qemu_x86_64_defconfig \
  --json
```

Use `--detach` when you want the build id immediately and plan to follow up
with `remote-inspect`, `remote-logs`, or `remote-fetch`.

## JSON Contract

Every command supports `--json`, including `--help` and error cases.

- Prefer `--json` for automation.
- Expect streaming commands to emit line-oriented events followed by a final
  summary object.
- Treat local manifest files and remote manifest payloads as the primary stable
  automation contracts.

## Smoke Test

The repo includes a tiny fixture for fast validation of the local CLI path.
Use it when you want to confirm the command surface without downloading a real
Buildroot release.

```bash
pnpm --filter @morpheus/buildroot smoke
```

The smoke test verifies that `buildroot build` and `buildroot inspect` can
produce and read a small local artifact and manifest.
