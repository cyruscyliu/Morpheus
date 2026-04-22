# sel4

Inspect, build, and register seL4 source directories with one stable CLI.

`sel4` is a small local tool that treats the seL4 source tree as a first-class
artifact. It does not own target launch behavior. Consumer tools such as
`nvirsh` can depend on its resolved source path through Morpheus, whether that
directory comes from an existing local checkout, a managed archive fetch, or a
managed Git clone into the workspace.

## Quick start

```bash
sel4 inspect \
  --path ./hyperarm-workspace/tools/sel4/src/seL4 \
  --json
```

That command:

- Validates that the source directory exists
- Detects the seL4 version from local metadata when available
- Returns a stable artifact record for `source-dir`

Example response shape:

```json
{
  "command": "inspect",
  "status": "success",
  "exit_code": 0,
  "summary": "inspected local seL4 source directory",
  "details": {
    "artifact": {
      "path": "source-dir",
      "location": "./hyperarm-workspace/tools/sel4/src/seL4"
    }
  }
}
```

## Usage

The public command tree is:

```text
sel4 inspect
sel4 build
sel4 version
sel4 help
```

Use Morpheus when the source tree should be a managed dependency for another
tool:

```bash
morpheus tool build --tool sel4 --mode local --path ./hyperarm-workspace/tools/sel4/src/seL4 --json
```

Or have Morpheus build it into the workspace when the configured directory
does not exist yet:

```bash
morpheus tool build \
  --tool sel4 \
  --mode local \
  --sel4-version 15.0.0 \
  --git-url https://github.com/seL4/seL4.git \
  --git-ref 15.0.0 \
  --json
```

## Flags

- `sel4 inspect --path PATH`: local source directory to inspect
- `sel4 build --source DIR`: managed source directory
- `sel4 build --sel4-version VER`: expected seL4 version to record
- `sel4 build --archive-url URL`: archive URL to fetch when the source is
  missing
- `sel4 build --git-url URL`: Git URL to clone when the source is missing
- `sel4 build --git-ref REF`: Git ref to checkout after clone

Managed `morpheus tool build --tool sel4` supports placement modes:

- `mode: local`: execute seL4 provisioning locally (no remote runner today)

Within that placement mode, Morpheus picks the provisioning strategy:

- if `tools.sel4.path` exists, register it as the `source-dir` artifact
- otherwise, run `sel4 build` to clone/fetch into the workspace and register
  the resulting source directory

## JSON

Every command supports `--json`, including help and errors.

## Morpheus boundary

- `sel4` owns local directory inspection
- `sel4` owns archive fetch or Git clone for managed source directories
- `morpheus` owns `local` vs `remote` placement and tool dependency wiring
- `nvirsh` should consume the resolved source artifact, not provision it

## Smoke test

Run:

```bash
pnpm --filter @morpheus/sel4 smoke
```
