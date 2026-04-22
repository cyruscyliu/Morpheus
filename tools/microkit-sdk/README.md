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
  --path ./hyperarm-workspace/tools/microkit-sdk/sdk \
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
      "location": "./hyperarm-workspace/tools/microkit-sdk/sdk"
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
morpheus tool build --tool microkit-sdk --mode local --path ./hyperarm-workspace/tools/microkit-sdk/sdk --json
```

Or have Morpheus build it into the workspace when the configured directory
does not exist yet:

```bash
morpheus tool build \
  --tool microkit-sdk \
  --mode local \
  --microkit-version 2.0.1 \
  --json
```

That command treats `build` as the full entrypoint: it can fetch missing
upstream inputs (Microkit sources, seL4 sources) and then build the SDK.

If you want to avoid downloads, set `tools.microkit-sdk.microkit-dir` to an
existing Microkit checkout and set `tools.sel4.path` to an existing seL4
checkout.

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

- if `tools.microkit-sdk.path` exists, register it as the `sdk-dir` artifact
- otherwise, run `microkit-sdk build` to fetch/unpack into the workspace and
  register the resulting directory

For incremental workflows, set:

- `tools.microkit-sdk.reuse-build-dir: true`
- `tools.microkit-sdk.build-dir-key: <name>`

This keeps the managed SDK directory under `tools/microkit-sdk/builds/<key>/`.

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
