# libvmm

Fetch, build, and register libvmm checkouts as stable workspace artifacts.

`libvmm` is a small local tool that provisions a libvmm git checkout and can
build one of its examples given an existing Microkit SDK. It treats the
checkout root as a first-class artifact so Morpheus-managed workflows can
depend on it.

## Quick start

```bash
libvmm inspect --path <workspace>/tools/libvmm/src/libvmm --json
```

## Usage

The public command tree is:

```text
libvmm inspect
libvmm build
libvmm run
libvmm version
libvmm help
```

## Build

Build the `virtio` example (requires a Microkit SDK):

```bash
libvmm build \
  --source <workspace>/tools/libvmm/src/libvmm-main \
  --patch-dir <workspace>/tools/libvmm/patches \
  --microkit-sdk <workspace>/tools/microkit-sdk/builds/microkit-sdk-2.2.0/sdk \
  --board qemu_virt_aarch64 \
  --example virtio \
  --linux ./out/Image \
  --initrd ./out/rootfs.cpio.gz \
  --json
```

This command:

- Clones or updates `https://github.com/au-ts/libvmm`
- Runs `git submodule update --init --recursive`
- Treats git operations as non-interactive and applies timeouts (so a missing
  credential prompt does not hang forever)
- Invokes `make` in `examples/<example>` with `MICROKIT_SDK` and
  `MICROKIT_BOARD` (and optionally `LINUX`, `INITRD`)

It also writes a `runtime-contract.json` file in the libvmm source tree and
returns a `runtime-contract` artifact in `--json` output. Consumers such as
`nvirsh` use that contract instead of hard-coding `make qemu`.

## Run

Launch the libvmm-owned runtime action from an emitted runtime contract:

```bash
libvmm run \
  --contract <workspace>/tools/libvmm/builds/<key>/source/runtime-contract.json \
  --action qemu \
  --libvmm-dir <workspace>/tools/libvmm/builds/<key>/source \
  --microkit-sdk <workspace>/tools/microkit-sdk/builds/<key>/install \
  --board qemu_virt_aarch64 \
  --microkit-config debug \
  --kernel <workspace>/tools/buildroot/builds/<key>/output/images/Image \
  --initrd <workspace>/tools/buildroot/builds/<key>/output/images/rootfs.cpio.gz \
  --qemu <workspace>/tools/qemu/builds/<key>/install/bin/qemu-system-aarch64 \
  --toolchain-bin-dir <workspace>/tools/microkit-sdk/deps/<toolchain>/bin \
  --run-dir ./.libvmm-run \
  --detach \
  --json
```

This command:

- Validates the runtime contract and selected action
- Launches the provider-owned `qemu` action from `examples/virtio`
- Writes a run manifest and log under the explicit `--run-dir`
- Returns machine-readable runtime metadata in `--json` mode

## Patching

If you need to customize libvmm's example Makefiles (for example to tweak QEMU
invocation flags), keep your patches in the workspace and apply them with
`--patch-dir`.

This repo also ships an upstreamable patch you can apply via `--patch-dir`:

- `tools/libvmm/patches/0001-add-requirements-for-sdfgen-0.26.patch` adds a
  `requirements.txt` to the libvmm checkout and improves the `sdfgen` version
  mismatch error message for the `virtio` example.

Morpheus-managed builds should set `tools.libvmm.patch-dir` in `morpheus.yaml`
to a workspace-local directory (for example `<workspace>/tools/libvmm/patches`).

If you want to use the patches shipped in this repo directly, you can also set
`tools.libvmm.patch-dir` to `tools/libvmm/patches` (repo-relative).

When Morpheus runs libvmm provisioning, the execution is recorded as a workflow
run under `<workspace>/runs/<workflow-run-id>/`.

## Dependencies

libvmm builds typically require host packages such as:

- `make`, `clang`, `lld`, `llvm`
- `qemu-system-arm`
- `device-tree-compiler`

Install them via your system package manager.

The `virtio` example also relies on python dependencies (not installed by
Morpheus). Install them inside the libvmm checkout:

```bash
cd <workspace>/tools/libvmm/builds/<key>/source
python3 -m pip install -r requirements.txt
```

## JSON

Every command supports `--json`, including help and errors.

When `--json` is used, libvmm writes progress logs to stderr and prints a
single JSON object on stdout as the last line.

When `--patch-dir` changes (different patch fingerprint), libvmm resets the
managed git worktree to a clean checkout before applying patches. This makes
project patch iteration predictable.
