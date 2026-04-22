# sel4

Inspect, build, and register seL4 source directories with one stable CLI.

`sel4` is a small local tool that treats the seL4 source tree as a first-class
artifact. It does not own target launch behavior. Consumer tools such as
`nvirsh` can depend on its resolved source path through Morpheus, whether that
directory comes from an existing local checkout or a managed archive fetch into
the workspace.

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
  --archive-url https://github.com/seL4/seL4/archive/refs/tags/15.0.0.tar.gz \
  --json
```

## Flags

- `sel4 inspect --path PATH`: local source directory to inspect
- `sel4 build --source DIR`: managed source directory
- `sel4 build --sel4-version VER`: expected seL4 version to record
- `sel4 build --archive-url URL`: archive URL to fetch when the source is
  missing

Managed `morpheus tool build --tool sel4` supports placement modes:

- `mode: local`: execute seL4 provisioning locally (no remote runner today)

Within that placement mode, Morpheus picks the provisioning strategy:

- if `tools.sel4.path` exists, register it as the `source-dir` artifact
- otherwise, run `sel4 build` to fetch an archive into the workspace and
  register the resulting source directory

For incremental workflows, set:

- `tools.sel4.reuse-build-dir: true`
- `tools.sel4.build-dir-key: <name>`

This keeps the managed source directory under `tools/sel4/builds/<key>/`.

## JSON

Every command supports `--json`, including help and errors.

## Morpheus boundary

- `sel4` owns local directory inspection
- `sel4` owns archive fetch for managed source directories
- `morpheus` owns `local` vs `remote` placement and tool dependency wiring
- `nvirsh` should consume the resolved source artifact, not provision it

## Smoke test

Run:

```bash
pnpm --filter @morpheus/sel4 smoke
```
