# nvirsh

Run local nested-virtualization targets from explicit runtime artifacts.

`nvirsh` is a local-first lifecycle CLI.
It validates pinned prerequisites, prepares stable local state, launches the
runtime provider, and exposes `inspect`, `logs`, `stop`, and `clean`.
It does not own remote execution or dependency resolution.

## Quick start

```bash
nvirsh run \
  --target sel4 \
  --state-dir ./tmp/nvirsh/sel4-dev \
  --qemu ./deps/qemu-system-aarch64 \
  --microkit-sdk ./deps/microkit-sdk \
  --microkit-version 1.4.1 \
  --toolchain ./deps/arm-gnu-toolchain \
  --libvmm-dir ./deps/libvmm \
  --kernel ./out/Image \
  --initrd ./out/rootfs.cpio.gz \
  --detach \
  --json
```

That command:

- Validates the local prerequisites for the `sel4` target
- Prepares stable local state under `--state-dir` when it is missing
- Starts the runtime provider for the target
- Writes runtime metadata to `<state-dir>/manifest.json`
- Streams runtime output into `<state-dir>/stdout.log`

Expected local output layout:

```text
tmp/nvirsh/sel4-dev/
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

To attach to the VM console, omit `--detach` and `--json`:

```bash
nvirsh run \
  --target sel4 \
  --state-dir ./tmp/nvirsh/sel4-dev \
  --qemu ./deps/qemu-system-aarch64 \
  --microkit-sdk ./deps/microkit-sdk \
  --toolchain ./deps/arm-gnu-toolchain \
  --libvmm-dir ./deps/libvmm \
  --kernel ./out/Image \
  --initrd ./out/rootfs.cpio.gz
```

## Usage

The public command tree is:

```text
nvirsh doctor
nvirsh run
nvirsh inspect
nvirsh stop
nvirsh logs
nvirsh clean
nvirsh help
```

Use `doctor` when you want validation without state writes:

```bash
nvirsh doctor \
  --target sel4 \
  --qemu ./deps/qemu-system-aarch64 \
  --microkit-sdk ./deps/microkit-sdk \
  --toolchain ./deps/arm-gnu-toolchain \
  --libvmm-dir ./deps/libvmm \
  --json
```

Use `inspect`, `logs`, `stop`, and `clean` for local lifecycle follow-up:

```bash
nvirsh inspect --state-dir ./tmp/nvirsh/sel4-dev --json
nvirsh logs --state-dir ./tmp/nvirsh/sel4-dev
nvirsh stop --state-dir ./tmp/nvirsh/sel4-dev
nvirsh clean --state-dir ./tmp/nvirsh/sel4-dev
```

When `--state-dir` is omitted, `nvirsh` defaults to
`<workspace>/tmp/nvirsh/<name>/` if `morpheus.yaml` defines `workspace.root`,
or `./tmp/nvirsh/<name>/` otherwise.

When Morpheus runs `nvirsh` in a workflow, the execution is recorded under
`<workspace>/runs/<workflow-run-id>/`.

## Flags

- `--target sel4`: select the target contract
- `--state-dir DIR`: explicit local state root for manifests and logs
- `--name NAME`: stable instance name recorded in the manifest
- `--qemu PATH`: local QEMU executable used at runtime
- `--microkit-sdk DIR`: local Microkit SDK root
- `--microkit-version VER`: expected Microkit SDK version
- `--toolchain DIR`: local ARM toolchain root
- `--libvmm-dir DIR`: local `libvmm` source or checkout root
- `--runtime-contract PATH`: explicit runtime contract override
- `--kernel PATH`: explicit kernel artifact for `run`
- `--initrd PATH`: explicit initrd artifact for `run`
- `--qemu-arg ARG`: extra QEMU argument, repeatable
- `--detach`: start in the background

## JSON

Every command supports `--json`, including help and errors.

```bash
nvirsh --json --help
nvirsh inspect --state-dir ./tmp/nvirsh/sel4-dev --json
```

## Morpheus boundary

- `nvirsh` stays local and artifact-driven
- `morpheus` owns `morpheus.yaml` configuration and dependency resolution
- `morpheus` passes explicit resolved paths to `nvirsh run`
- workflow-managed runs live under `<workspace>/runs/`
- direct ad hoc state defaults to `<workspace>/tmp/nvirsh/<name>/`

## Smoke test

Run the direct CLI smoke check with:

```bash
pnpm --filter @morpheus/nvirsh smoke
```
