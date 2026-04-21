---
name: morpheus
description: Manage Morpheus workspace metadata, managed local and remote tool runs, logs, manifests, explicit artifact fetches, and Morpheus-managed buildroot/qemu/nvirsh workflows. Use when the user needs Morpheus-managed tool runs, local or remote workspaces, or Morpheus app behavior.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# morpheus Skill

Use this skill when you need to work with the `morpheus` app in this repo.

## Purpose

`morpheus` is the repo management CLI.
It owns workspace metadata, managed local and remote runs, manifests, logs,
and explicit fetch behavior for supported tools.

Managed tools currently include Buildroot, local `qemu`, and local `nvirsh`.

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
    reuse-build-dir: true
    build-dir-key: arm64-dev
    patch-dir: ./workflow-workspace/tools/buildroot/patches
    config-fragment:
      - BR2_LINUX_KERNEL=y
      - BR2_LINUX_KERNEL_CUSTOM_VERSION=y
      - BR2_LINUX_KERNEL_CUSTOM_VERSION_VALUE="6.18.16"
```

Optional repo-local config for local `nvirsh` with Buildroot-wired runtime
artifacts:

```yaml
workspace:
  root: ./workflow-workspace
tools:
  qemu:
    mode: local
    path: ./workflow-workspace/tools/qemu/bin/qemu-system-aarch64
  nvirsh:
    mode: local
    target: sel4
    name: sel4-dev
    microkit-sdk: ./deps/microkit-sdk
    microkit-version: 1.4.1
    toolchain: ./deps/arm-gnu-toolchain
    libvmm-dir: ./deps/libvmm
    sel4-dir: ./deps/seL4
    sel4-version: 15.0.0
    dependencies:
      qemu:
        tool: qemu
        artifact: qemu-system-aarch64
      kernel:
        tool: buildroot
        artifact: images/Image
      initrd:
        tool: buildroot
        artifact: images/rootfs.cpio.gz
```

When the deps already exist somewhere else on disk, materialize them into the
workspace-local paths declared above with:

```bash
node scripts/nvirsh/prepare-sel4-deps.mjs \
  --qemu /path/to/qemu-system-aarch64 \
  --microkit-sdk /path/to/microkit-sdk \
  --toolchain /path/to/arm-gnu-toolchain \
  --libvmm-dir /path/to/libvmm \
  --sel4-dir /path/to/seL4 \
  --json
```

This script uses symlinks by default and does not download anything.

Register the workspace-local QEMU executable as a managed dependency with:

```bash
node apps/morpheus/dist/cli.js tool run \
  --tool qemu \
  --json
```

Or build the executable into the workspace from a local source tree:

```bash
node apps/morpheus/dist/cli.js tool run \
  --tool qemu \
  --mode build \
  --source ./workflow-workspace/tools/qemu/src/qemu \
  --target-list aarch64-softmmu \
  --json
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
node apps/morpheus/dist/cli.js tool inspect \
  --id buildroot-20260419-abcdef12 \
  --json
```

## Command Surface

The main user-facing commands are:

```text
morpheus workspace create
morpheus workspace show
morpheus tool run
morpheus tool runs
morpheus tool inspect
morpheus tool logs
morpheus tool fetch
morpheus tool remove
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
- `tool run --tool nvirsh`: resolve configured runtime dependencies and launch
  local `nvirsh` from concrete artifact paths.
- `tool run --tool qemu`: register a local QEMU executable as a managed
  dependency artifact, or build and register one from a local source tree.
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
Keep Buildroot patch trees inside the managed workspace when possible, for
example under `tools/buildroot/patches/linux/`.
Use `reuse-build-dir: true` when you want a persistent Buildroot `O=` tree
under `tools/buildroot/builds/<key>/` instead of a fresh per-run output tree.
When you set a custom kernel tarball version, Morpheus can also populate the
matching `linux.hash` and `linux-headers.hash` entries in that workspace patch
tree.
When `patch-dir/linux/*.patch` exists, Morpheus stages those kernel patches
into a patched kernel tarball for the run so `linux-headers` can reuse the
source tarball without trying to apply full kernel patches itself.
Morpheus also writes run-local hash entries for that patched tarball so the
Buildroot download phase accepts the rewritten tarball name.
The rewritten tarball name includes a kernel patch fingerprint so reusable
build dirs do not reuse a stale cached tarball after patch edits.

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
    nvirsh/
      runs/
        <id>/
          manifest.json
          stdout.log
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

Use Morpheus-managed `nvirsh` when the stable configuration lives in
`morpheus.yaml` and Morpheus should resolve producer artifacts first:

```bash
node apps/morpheus/dist/cli.js tool run \
  --tool nvirsh \
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
- Use `nvirsh` directly for unmanaged local target lifecycle work.
- Use `morpheus tool run --tool buildroot --mode local|remote` for managed runs.
- Use `morpheus tool run --tool nvirsh` when Morpheus must resolve runtime
  dependencies from managed producer outputs.
- Use Morpheus `tool` subcommands for managed run lifecycle work.
- Do not assume `buildroot remote-*` exists.
