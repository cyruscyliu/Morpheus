# qemu

Inspect, fetch, unpack, build, and register QEMU with one stable CLI.

`qemu` is a small local tool that treats the QEMU binary as a first-class
artifact. It does not own guest lifecycle behavior. Consumer tools such as
`nvirsh` can depend on its resolved executable path through Morpheus, whether
that executable comes from an existing local install or from a managed QEMU
release fetch, unpack, and build flow.

## Quick start

```bash
qemu inspect \
  --path ./hyperarm-workspace/tools/qemu/bin/qemu-system-aarch64 \
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
      "location": "./hyperarm-workspace/tools/qemu/bin/qemu-system-aarch64"
    }
  }
}
```

## Usage

The public command tree is:

```text
qemu inspect
qemu build
qemu version
qemu help
```

Use Morpheus when the executable should be a managed dependency for another
tool:

```bash
morpheus tool build --tool qemu --mode local --path ./hyperarm-workspace/tools/qemu/bin/qemu-system-aarch64 --json
```

Or have Morpheus build it into the workspace when the configured executable
path does not exist yet:

```bash
morpheus tool build \
  --tool qemu \
  --mode local \
  --qemu-version 8.2.7 \
  --build-dir-key qemu-8.2.7-aarch64-softmmu \
  --target-list aarch64-softmmu \
  --json
```

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

Managed `morpheus tool build --tool qemu` supports placement modes:

- `mode: local`: execute QEMU locally (no remote runner today)

Within that placement mode, Morpheus picks the provisioning strategy:

- if `tools.qemu.path` exists, register it as the `qemu-system-aarch64` artifact
- otherwise, run `qemu build` to fetch/unpack/build/install into the workspace
  and register the resulting executable

## JSON

Every command supports `--json`, including help and errors.

## Morpheus boundary

- `qemu` owns local executable inspection
- `qemu` owns fetch, unpack, source staging, and build/install for managed
  builds
- `morpheus` owns `local` vs `remote` placement and tool dependency wiring
- `nvirsh` should consume the resolved executable path, not provision QEMU

## Smoke test

Run:

```bash
pnpm --filter @morpheus/qemu smoke
```
