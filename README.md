# Morpheus

Morpheus is a research platform from North Star Systems Security Lab (NS3L).

## Quick start

Install dependencies:

```bash
pnpm install
```

Build the workspace:

```bash
pnpm build
```

Set up all tools:

```bash
pnpm setup
```

This builds the tool entrypoints and installs repo-local CLI wrappers under
`bin/`.

List available project scripts:

```bash
pnpm run
```

## Development

Start the documentation site locally:

```bash
pnpm dev:docs
```

Then open `http://127.0.0.1:4173`.

## Tool setup

Set up one tool at a time when needed:

```bash
pnpm setup:llbase
pnpm setup:llbic
pnpm setup:llcg
pnpm setup:buildroot
pnpm setup:qemu
pnpm setup:nvirsh
```

Install or refresh the repo-local CLI wrappers directly:

```bash
pnpm run install:bin
```

Use the wrappers from `bin/`:

```bash
./bin/buildroot --help
./bin/qemu --help
./bin/llbic --help
./bin/llcg --help
./bin/nvirsh --help
./bin/morpheus --help
./bin/morpheus tool resolve buildroot --json
./bin/morpheus tool resolve nvirsh --json
./bin/morpheus --json tool inspect --id <run-id>
```

For a repo-local Morpheus config, start from:

```bash
cp morpheus.example.yaml morpheus.yaml
```

For Buildroot kernel patching, keep a Buildroot global patch tree in the
workspace, for example `hyperarm-workspace/tools/buildroot/patches/linux/`,
and point Morpheus at it with `patch-dir` in `morpheus.yaml`.
Set `reuse-build-dir: true` when you want Morpheus to reuse a persistent
Buildroot `O=` directory across runs instead of rebuilding from scratch.
Use `build-dir-key` to keep separate incremental build trees when needed.
When a custom kernel version is selected, Morpheus also records the matching
`linux.hash` and `linux-headers.hash` entries in that workspace patch tree.
When `patch-dir/linux/*.patch` exists, Morpheus stages those kernel patches
into a patched kernel tarball for the run, so `linux-headers` keeps the hash
metadata but does not try to apply full kernel patches.
Morpheus also writes run-local hash entries for that patched tarball so
Buildroot accepts both the kernel and kernel-headers download step.
The patched tarball name includes a kernel patch fingerprint, so reusable
Buildroot trees do not collide with stale cached tarballs after patch changes.

For `nvirsh`, keep stable target configuration in `tools.nvirsh` inside
`morpheus.yaml`. Morpheus resolves configured dependencies such as
Buildroot-produced `images/Image` and `images/rootfs.cpio.gz` into concrete
local paths before invoking `nvirsh`.

Keep `sel4` dependencies workspace-local as well. When you already have local
checkouts or SDKs, stage them into the workspace paths from `morpheus.yaml`
with:

```bash
pnpm prepare:tool:nvirsh:sel4 \
  --qemu /path/to/qemu-system-aarch64 \
  --microkit-sdk /path/to/microkit-sdk \
  --toolchain /path/to/arm-gnu-toolchain \
  --libvmm-dir /path/to/libvmm \
  --sel4-dir /path/to/seL4
```

The script uses symlinks by default, so it does not download or duplicate
large trees unless you pass `--copy`.
Register the workspace-local QEMU executable as a managed dependency with:

```bash
./bin/morpheus --json tool run --tool qemu
```

Or build QEMU into the workspace from a local source tree:

```bash
./bin/morpheus tool run \
  --tool qemu \
  --mode build \
  --source ./hyperarm-workspace/tools/qemu/src/qemu \
  --target-list aarch64-softmmu \
  --json
```

Example:

```yaml
tools:
  qemu:
    mode: local
    path: ./hyperarm-workspace/tools/qemu/bin/qemu-system-aarch64
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

For a built QEMU instead:

```yaml
tools:
  qemu:
    mode: build
    source: ./hyperarm-workspace/tools/qemu/src/qemu
    build-dir-key: aarch64-softmmu
    target-list:
      - aarch64-softmmu
```

Run it through Morpheus after a successful local Buildroot run:

```bash
./bin/morpheus --json tool run --tool nvirsh
```

## TODO

- Add a remote task callback mechanism where the Morpheus-managed remote
  runner triggers the callback after final manifest update.
