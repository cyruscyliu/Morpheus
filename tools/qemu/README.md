# qemu

Inspect, fetch, unpack, build, run, and register QEMU with one stable CLI.

`qemu` is a small local tool that treats the QEMU binary as a first-class
artifact. It can also launch a direct kernel-plus-initrd runtime when that is
the intended workflow. Morpheus can depend on the resolved executable path or
invoke the runtime directly, whether the executable comes from an existing
local install or from a managed QEMU release fetch, unpack, and build flow.

## Quick start

```bash
qemu inspect \
  --path <workspace>/tools/qemu/bin/qemu-system-aarch64 \
  --json
```

That command:

- Validates that the executable exists and is runnable
- Reads the version string from `--version`
- Returns a stable artifact record for `qemu-system-aarch64`

Example response shape:

```json
{
  "command": "inspect",
  "status": "success",
  "exit_code": 0,
  "summary": "inspected local QEMU executable",
  "details": {
    "artifact": {
      "path": "qemu-system-aarch64",
      "location": "<workspace>/tools/qemu/bin/qemu-system-aarch64"
    }
  }
}
```

## Usage

The public command tree is:

```text
qemu inspect
qemu build
qemu run
qemu version
qemu help
```

Use Morpheus when the executable should be a managed dependency for another
tool:

```bash
morpheus tool build --tool qemu --mode local --path <workspace>/tools/qemu/bin/qemu-system-aarch64 --json
```

Or have Morpheus build it into the workspace when the configured executable
path does not exist yet:

```bash
morpheus tool build \
  --tool qemu \
  --mode remote \
  --qemu-version 8.2.7 \
  --build-dir-key qemu-8.2.7-aarch64-softmmu \
  --target-list aarch64-softmmu \
  --json
```

Run a kernel and initrd directly with QEMU:

```bash
qemu run \
  --path <workspace>/tools/qemu/builds/qemu-8.2.7-aarch64-softmmu/install/bin/qemu-system-aarch64 \
  --kernel <workspace>/tools/buildroot/builds/arm64-dev/output/images/Image \
  --initrd <workspace>/tools/buildroot/builds/arm64-dev/output/images/rootfs.cpio.gz \
  --run-dir <workspace>/runs/qemu-dev \
  --detach \
  --json
```

That command:

- Validates the local QEMU executable
- Starts a local AArch64 `virt` machine
- Writes runtime metadata to `<run-dir>/manifest.json`
- Streams runtime output into `<run-dir>/stdout.log`

When `--run-dir` is omitted, `qemu run` defaults to `./tmp/qemu-run/`.
When Morpheus runs QEMU in a workflow, the execution is recorded under
`<workspace>/runs/<workflow-run-id>/`.

When Morpheus runs QEMU provisioning, the execution is recorded as a workflow
run under `<workspace>/runs/<workflow-run-id>/`.

## Flags

- `qemu inspect --path PATH`: local QEMU executable to inspect
- `qemu build --source DIR --build-dir DIR --install-dir DIR`: managed build
  entrypoint
- `qemu build --qemu-version VER`: fetch `qemu-<version>.tar.xz` when the
  managed source tree does not exist yet
- `qemu build --archive-url URL`: override the release archive location
- `qemu build --target-list NAME`: repeatable target list such as
  `aarch64-softmmu`
- `qemu build --configure-arg ARG`: repeatable extra configure argument
- `qemu run --path PATH --kernel PATH --initrd PATH`: launch a local runtime
- `qemu run --run-dir DIR`: write runtime manifest and logs under `DIR`
- `qemu run --append TEXT`: override the kernel command line
- `qemu run --qemu-arg ARG`: repeatable extra QEMU argument
- `qemu run --detach`: start in the background

Managed `morpheus tool build --tool qemu` supports placement modes:

- `mode: local`: execute QEMU locally
- `mode: remote`: execute QEMU provisioning in the remote managed workspace
  through a remote `morpheus` executable

For `mode: remote`, the remote host must expose `morpheus` on `PATH`, or a
repo checkout with `bin/morpheus`, or an explicit `MORPHEUS_REMOTE_BIN`
override.

Within that placement mode, Morpheus picks the provisioning strategy:

- if `tools.qemu.path` exists, register it as the `qemu-system-aarch64` artifact
- otherwise, run `qemu build` to fetch/unpack/build/install into the workspace
  and register the resulting executable
- `morpheus tool run --tool qemu` uses the same managed executable resolution
  and then launches `qemu run`

## JSON

Every command supports `--json`, including help and errors.

## Morpheus boundary

- `qemu` owns local executable inspection
- `qemu` owns fetch, unpack, source staging, and build/install for managed
  builds
- `qemu` owns direct local runtime launch for kernel-plus-initrd boots
- `morpheus` owns `local` vs `remote` placement and tool dependency wiring
- remote build outputs live under `tools/qemu/{src,downloads,builds}/` in the
  managed remote workspace
- remote execution reuses a remote Morpheus runtime instead of syncing the
  tool bundle into the workspace
- `nvirsh` should consume the resolved executable path, not provision QEMU
- `tools/qemu/tool.json` declares the managed workspace path contract that
  Morpheus consumes

## Smoke test

Run:

```bash
pnpm --filter @morpheus/qemu smoke
```
