# microkit-sdk

Inspect, build, and register Microkit SDK directories with one stable CLI.

`microkit-sdk` is a small local tool that treats the SDK directory as a
first-class artifact. It does not own target launch behavior. Consumer tools
such as `nvirsh` can depend on its resolved SDK path through Morpheus, whether
that directory comes from an existing local checkout or a managed archive
fetch into the workspace.

## Quick start

```bash
microkit-sdk inspect \
  --path <workspace>/tools/microkit-sdk/builds/default/install \
  --json
```

That command:

- Validates that the SDK directory exists
- Detects the SDK version from local metadata when available
- Returns a stable artifact record for `sdk-dir`

Example response shape:

```json
{
  "command": "inspect",
  "status": "success",
  "exit_code": 0,
  "summary": "inspected local Microkit SDK directory",
  "details": {
    "artifact": {
      "path": "sdk-dir",
      "location": "<workspace>/tools/microkit-sdk/builds/default/install"
    }
  }
}
```

## Usage

The public command tree is:

```text
microkit-sdk inspect
microkit-sdk build
microkit-sdk version
microkit-sdk help
```

Use Morpheus when the SDK should be a managed dependency for another tool:

```bash
morpheus tool build \
  --tool microkit-sdk \
  --mode local \
  --path <workspace>/tools/microkit-sdk/builds/default/install \
  --json
```

Or have Morpheus build it into the workspace when the configured directory
does not exist yet:

When Morpheus runs Microkit SDK provisioning, the execution is recorded as a
workflow run under `<workspace>/runs/<workflow-run-id>/`.

```bash
morpheus tool build \
  --tool microkit-sdk \
  --mode local \
  --microkit-version 2.2.0 \
  --json
```

That command treats `build` as the full entrypoint: it can fetch missing
upstream inputs (Microkit sources, seL4 sources) and then build the SDK.

If you want to avoid downloads, set `tools.microkit-sdk.microkit-dir` to an
existing Microkit checkout and set `tools.sel4.path` to an existing seL4
checkout.

Microkit SDK builds for aarch64 targets typically require an aarch64 bare-metal
toolchain (for example `aarch64-none-elf-gcc`). Morpheus can manage this as an
additional artifact when building the SDK from source.

If you need a Microkit SDK built from source (for development), use the repo
script which wraps Microkit's `build_sdk.py` and auto-detects flag names:

```bash
pnpm run build:microkit:sdk -- \
  --microkit-dir ./deps/microkit \
  --sel4-dir ./deps/seL4 \
  --json
```

## Flags

- `microkit-sdk inspect --path PATH`: local SDK directory to inspect
- `microkit-sdk build --source DIR`: managed SDK directory
- `microkit-sdk build --microkit-version VER`: expected SDK version to record
- `microkit-sdk build --archive-url URL`: archive URL to fetch when the managed
  SDK directory does not exist yet

Managed `morpheus tool build --tool microkit-sdk` supports placement modes:

- `mode: local`: execute Microkit locally (no remote runner today)

Within that placement mode, Morpheus picks the provisioning strategy:

- If you configured build inputs (for example `tools.microkit-sdk.microkit-version`
  or `tools.microkit-sdk.microkit-dir`), Morpheus treats `tool build` as a
  build-oriented workflow:
  - ensures the Arm GNU toolchain is available (and records `toolchain-dir`)
  - ensures the seL4 source dependency is available (and applies `tools.sel4.patch-dir`)
  - builds the SDK if missing (or if tracked inputs changed)
  - otherwise, reuses the existing SDK directory and records build inputs
- If you only configured `tools.microkit-sdk.path` (and no build inputs),
  Morpheus registers that directory as the `sdk-dir` artifact.

For incremental workflows, set:

- `tools.microkit-sdk.build-dir-key: <name>`

Morpheus keeps the managed SDK directory under `tools/microkit-sdk/builds/<key>/`.
The installed SDK root is stored at `tools/microkit-sdk/builds/<key>/install/`.

## Patching Microkit sources

When building the SDK from source, Morpheus can also apply local patch files
to the Microkit source tree before running `build_sdk.py`.

Configure a patch directory in `morpheus.yaml`:

```yaml
tools:
  microkit-sdk:
    patch-dir: ./hyperarm-workspace/tools/microkit-sdk/patches
```

The directory is expected to contain `*.patch` files that apply with `-p1`
relative to the Microkit source root. The patch fingerprint is included in the
SDK reuse cache (`.morpheus-build.json`), so changing a patch forces a rebuild.

## Reuse and rebuilds

When Morpheus runs a source build, it records a small metadata file in the SDK
directory (`.morpheus-build.json`) containing a fingerprint of the inputs (Microkit
version/source, Microkit patch fingerprint, seL4 patch fingerprint, toolchain
version, selected boards/configs).

If the fingerprint matches on the next run, Morpheus reuses the SDK directory
instead of rebuilding.

## Toolchain

When building the SDK from source, Morpheus can also ensure the Arm GNU
toolchain is present under the workspace and record it as an additional
artifact:

- `toolchain-dir`: extracted toolchain root directory

Configure it in `morpheus.yaml` under `tools.microkit-sdk`:

- `toolchain-version`: toolchain version to fetch (default: `12.3.rel1`)
- `toolchain-archive-url`: override archive URL
- `toolchain-dir`: use an existing toolchain instead of fetching
- `toolchain-prefix-aarch64`: default `aarch64-none-elf`

## Network requirements

Microkit source builds compile a Rust tool via Cargo. If your environment has
no access to `crates.io`, you must provide an offline Cargo setup or prebuilt
artifacts.

## JSON

Every command supports `--json`, including help and errors.

## Morpheus boundary

- `microkit-sdk` owns local directory inspection
- `microkit-sdk` owns archive fetch and unpack for managed SDK directories
- `morpheus` owns `local` vs `remote` placement and tool dependency wiring
- `nvirsh` should consume the resolved SDK artifact, not provision it

## Smoke test

Run:

```bash
pnpm --filter @morpheus/microkit-sdk smoke
```
