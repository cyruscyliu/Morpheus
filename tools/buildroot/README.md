# buildroot

Run local Buildroot workflows with one stable CLI.

`buildroot` is a local Buildroot orchestration CLI for users, tool builders,
and agent workflows that need explicit commands, inspectable metadata, and
machine-readable output instead of ad hoc shell scripts.

Remote workspace support is not part of `buildroot`.
Use `morpheus remote ...` when you need SSH-backed remote runs.

## Quick start

```bash
buildroot build \
  --source ./buildroot-src \
  --output ./out \
  --defconfig qemu_x86_64_defconfig \
  --json
```

That single command:

- Runs a local Buildroot build from an explicit source tree
- Writes output into an explicit local output directory
- Records stable local metadata for later inspection
- Prints a machine-readable result with `--json`

Expected local output layout:

```text
out/
  .buildroot-cli/
    build.json
  images/
```

Inspect an existing local build:

```bash
buildroot inspect \
  --output ./out \
  --json
```

Example response shape:

```json
{
  "command": "inspect",
  "status": "success",
  "exit_code": 0,
  "summary": "inspected local Buildroot build",
  "details": {
    "manifest": {
      "mode": "local",
      "status": "success",
      "command": "build",
      "source": "./buildroot-src",
      "output": "./out"
    }
  }
}
```

## Usage

The public command tree is:

```text
buildroot build
buildroot inspect
buildroot clean
buildroot version
buildroot help
```

Use `build` for a local Buildroot workflow:

```bash
buildroot build \
  --source ./buildroot-src \
  --output ./out \
  --defconfig qemu_x86_64_defconfig
```

Use `inspect` to read a local manifest:

```bash
buildroot inspect --output ./out --json
```

Use `clean` to remove a local output or explicit path:

```bash
buildroot clean --output ./out
```

When you need a remote workspace, use Morpheus instead:

```bash
morpheus remote run \
  --tool buildroot \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1 \
  --json
```

## Flags

Local Buildroot execution flags are:

- `--source DIR`: Buildroot source directory
- `--output DIR`: local output directory
- `--defconfig NAME`: run a defconfig target before the final build
- `--make-arg ARG`: pass a repeated explicit make argument
- `--env KEY=VALUE`: pass a repeated environment variable
- `-- ...`: forward remaining raw arguments to the final `make` invocation

Example:

```bash
buildroot build \
  --source ./buildroot-src \
  --output ./out \
  --defconfig qemu_x86_64_defconfig \
  --make-arg BR2_JLEVEL=8 \
  --env HOSTCC=clang \
  -- V=1
```

## JSON

Every command supports `--json`, including `--help` and errors.

Example:

```bash
buildroot --json --help
buildroot build \
  --json \
  --source ./buildroot-src \
  --output ./out
```

## Stable metadata

For automation, this file is the primary stable contract:

- `<output>/.buildroot-cli/build.json`

## Remote boundary

- `buildroot` supports local execution only
- `morpheus` owns remote workspaces and SSH-backed remote runs
- remote inspect, logs, and fetch move to `morpheus remote ...`

## Smoke test

The tool includes a tiny local smoke fixture for fast validation of the CLI
without downloading Buildroot or building a full toolchain.

Run it with:

```bash
pnpm --filter @morpheus/buildroot smoke
```

The smoke test uses `test/fixtures/minimal-buildroot/` and verifies that
`buildroot build` and `buildroot inspect` produce a small archive artifact and
a local manifest.
