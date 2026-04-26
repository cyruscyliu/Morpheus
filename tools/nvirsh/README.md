# nvirsh

Run local nested-virtualization targets from explicit runtime artifacts.

`nvirsh` is a local-first lifecycle CLI for dependency staging, runtime launch,
inspection, logs, stop, and cleanup. It does not own remote execution,
workspace transport, or provider-specific launch logic.

Before `nvirsh build`, stage existing local `sel4` dependencies into the
workspace-local tree referenced by `morpheus.yaml`. When Morpheus manages the
workflow, QEMU, Microkit SDK, and `seL4` should come from managed tool
dependencies rather than direct `tools.nvirsh.*` paths when possible.

When Morpheus runs `nvirsh` as a managed tool, the execution is recorded as a
workflow run under `<workspace>/runs/<workflow-run-id>/`.

## sel4-dev runtime

The HyperARM `sel4-dev` workflow uses `libvmm` as its runtime provider.
`nvirsh build` prepares the state and resolves the provider contract.
`nvirsh run` then invokes `libvmm run` rather than embedding `make qemu`
directly.

## Quick start

When using Morpheus-managed dependencies, prefer configuring dependencies in
`morpheus.yaml` and using:

- `morpheus tool build --tool nvirsh` to stage dependencies and local state
- `morpheus tool run --tool nvirsh` to launch the runtime provider

```bash
nvirsh build \
  --target sel4 \
  --state-dir ./.nvirsh/sel4-dev \
  --qemu ./deps/qemu-system-aarch64 \
  --microkit-sdk ./deps/microkit-sdk \
  --microkit-version 1.4.1 \
  --toolchain ./deps/arm-gnu-toolchain \
  --libvmm-dir ./deps/libvmm \
  --runtime-contract ./deps/libvmm/runtime-contract.json
```

That command:

- Validates pinned local prerequisites for the `sel4` target
- Materializes stable local state under the explicit `--state-dir`
- Records a local manifest and runtime provider contract for later inspection

Then launch from explicit runtime artifacts:

```bash
nvirsh run \
  --target sel4 \
  --state-dir ./.nvirsh/sel4-dev \
  --kernel ./out/Image \
  --initrd ./out/rootfs.cpio.gz \
  --qemu-arg -machine \
  --qemu-arg virt,virtualization=on,gic-version=3 \
  --detach \
  --json
```

Expected local output layout:

```text
.nvirsh/sel4-dev/
  manifest.json
  provider-run/
    manifest.json
    stdout.log
```

Example response shape:

```json
{
  "command": "run",
  "status": "success",
  "exit_code": 0,
  "summary": "started local target instance",
  "details": {
    "manifest": {
      "target": "sel4",
      "status": "starting"
    }
  }
}
```

To attach to the VM console (interactive), omit `--detach` and do not use
`--json`:

```bash
nvirsh run \
  --target sel4 \
  --state-dir ./.nvirsh/sel4-dev \
  --kernel ./out/Image \
  --initrd ./out/rootfs.cpio.gz
```

## Usage

The public command tree is:

```text
nvirsh doctor
nvirsh build
nvirsh prepare
nvirsh run
nvirsh inspect
nvirsh stop
nvirsh logs
nvirsh clean
nvirsh help
```

Use `doctor` when you want validation without state writes:

```bash
nvirsh doctor --target sel4 --qemu ./deps/qemu-system-aarch64 --microkit-sdk ./deps/microkit-sdk --toolchain ./deps/arm-gnu-toolchain --libvmm-dir ./deps/libvmm --json
```

Use `inspect` to read a prepared or running manifest:

```bash
nvirsh inspect --state-dir ./.nvirsh/sel4-dev --json
```

Use `logs`, `stop`, and `clean` for local lifecycle follow-up:

```bash
nvirsh logs --state-dir ./.nvirsh/sel4-dev
nvirsh stop --state-dir ./.nvirsh/sel4-dev
nvirsh clean --state-dir ./.nvirsh/sel4-dev
```

Use `scripts/nvirsh/prepare-sel4-deps.mjs` when you already have the local
inputs and want the workspace-local layout expected by `morpheus.yaml`:

```bash
pnpm prepare:tool:nvirsh:sel4 \
  --qemu /path/to/qemu-system-aarch64 \
  --microkit-sdk /path/to/microkit-sdk \
  --toolchain /path/to/arm-gnu-toolchain \
  --libvmm-dir /path/to/libvmm \
  --json
```

## Flags

The initial `sel4` target uses these stable flags:

- `--target sel4`: select the initial target contract
- `--state-dir DIR`: explicit local state root for manifests and logs
- `--name NAME`: stable instance name recorded in the manifest
- `--qemu PATH`: local QEMU executable used at runtime
- `--microkit-sdk DIR`: local Microkit SDK root
- `--microkit-version VER`: expected Microkit SDK version
- `--toolchain DIR`: local ARM toolchain root
- `--libvmm-dir DIR`: local `libvmm` source or checkout root
- `--runtime-contract PATH`: explicit libvmm runtime contract for `build`
- `--kernel PATH`: explicit kernel artifact for `run`
- `--initrd PATH`: explicit initrd artifact for `run`
- `--qemu-arg ARG`: extra QEMU argument, repeatable
- `--append TEXT`: optional kernel command line

## JSON

Every command supports `--json`, including help and errors.

```bash
nvirsh --json --help
nvirsh inspect --state-dir ./.nvirsh/sel4-dev --json
```

## Morpheus boundary

- `nvirsh` stays local and artifact-driven
- `morpheus` owns `morpheus.yaml` configuration
- `morpheus` resolves the `qemu` tool dependency into a concrete executable
- `morpheus` can resolve `microkit-sdk` and `sel4` tool dependencies into
  concrete local directories
- `morpheus` resolves producer artifacts, such as Buildroot outputs
- `morpheus tool build --tool nvirsh` stages the local `nvirsh` state
- `morpheus tool run --tool nvirsh` builds dependencies, then launches the
  configured runtime provider
- `scripts/nvirsh/prepare-sel4-deps.mjs` stages existing local deps into the
  workspace-local paths declared in `morpheus.yaml`

## Smoke test

Run the direct CLI smoke check with:

```bash
pnpm --filter @morpheus/nvirsh smoke
```
