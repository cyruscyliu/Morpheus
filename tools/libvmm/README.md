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
libvmm version
libvmm help
```

## Build

Build the `virtio` example (requires a Microkit SDK):

```bash
libvmm build \
  --source <workspace>/tools/libvmm/src/libvmm-main \
  --patch-dir <workspace>/tools/libvmm/patches \
  --microkit-sdk <workspace>/tools/microkit-sdk/builds/microkit-sdk-2.0.1/sdk \
  --board qemu_virt_aarch64 \
  --example virtio \
  --linux ./out/Image \
  --initrd ./out/rootfs.cpio.gz \
  --qemu <workspace>/tools/qemu/bin/qemu-system-aarch64 \
  --make-target qemu \
  --json
```

This command:

- Clones or updates `https://github.com/au-ts/libvmm`
- Runs `git submodule update --init --recursive`
- Treats git operations as non-interactive and applies timeouts (so a missing
  credential prompt does not hang forever)
- Invokes `make` in `examples/<example>` with `MICROKIT_SDK` and `MICROKIT_BOARD`
  (and optionally `LINUX`, `INITRD`, `QEMU`)

## Patching

If you need to customize libvmm's example Makefiles (for example to tweak QEMU
invocation flags), keep your patches in the workspace and apply them with
`--patch-dir`.

Morpheus-managed builds should set `tools.libvmm.patch-dir` in `morpheus.yaml`
to a workspace-local directory (for example `<workspace>/tools/libvmm/patches`).

When Morpheus runs libvmm provisioning, the execution is recorded as a workflow
run under `<workspace>/runs/<workflow-run-id>/`.

## Dependencies

libvmm builds typically require host packages such as:

- `make`, `clang`, `lld`, `llvm`
- `qemu-system-arm`
- `device-tree-compiler`

Install them via your system package manager.

## JSON

Every command supports `--json`, including help and errors.
