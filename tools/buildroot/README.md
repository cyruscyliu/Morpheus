# buildroot

Run local and SSH-backed remote Buildroot workflows with one stable CLI.

`buildroot` is a Buildroot orchestration CLI for users, tool builders, and
agent workflows that need explicit commands, inspectable metadata, and
machine-readable output instead of ad hoc shell scripts.

## Quick start

```bash
buildroot remote-build \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1 \
  --defconfig qemu_x86_64_defconfig \
  --json
```

That single command:

- Connects to the remote host over SSH.
- Provisions the requested official Buildroot release if needed.
- Reuses cached tarballs or extracted trees when available.
- Creates a generated build id and persistent remote metadata.
- Streams logs and prints a final JSON summary.

Expected remote workspace layout:

```text
workflow-workspace/
  tools/
    buildroot/
      cache/
        buildroot-2025.02.1.tar.gz
      src/
        buildroot-2025.02.1/
      builds/
        br-20260419-abcdef12/
          manifest.json
          stdout.log
          output/
```

Inspect an existing remote build without rerunning it:

```bash
buildroot remote-inspect \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --id br-20260419-abcdef12 \
  --json
```

Example response shape:

```json
{
  "command": "remote-inspect",
  "status": "success",
  "exit_code": 0,
  "summary": "inspected remote build",
  "details": {
    "manifest": {
      "id": "br-20260419-abcdef12",
      "mode": "remote",
      "status": "success",
      "command": "remote-build",
      "workspace": "workflow-workspace",
      "buildrootVersion": "2025.02.1",
      "defconfig": "qemu_x86_64_defconfig",
      "buildDir": "workflow-workspace/tools/buildroot/builds/br-20260419-abcdef12",
      "logFile": "workflow-workspace/tools/buildroot/builds/br-20260419-abcdef12/stdout.log"
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
buildroot remote-build
buildroot remote-inspect
buildroot remote-logs
buildroot remote-fetch
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

Use `remote-build` for SSH-backed provisioning and execution:

```bash
buildroot remote-build \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1 \
  --defconfig qemu_x86_64_defconfig
```

Use `remote-build --detach` when you want a build id immediately:

```bash
buildroot remote-build \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1 \
  --detach \
  --json
```

Use `remote-logs` and `remote-inspect` to work with an existing build id:

```bash
buildroot remote-logs \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --id br-20260419-abcdef12

buildroot remote-inspect \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --id br-20260419-abcdef12 \
  --json
```

Use `remote-fetch` only with explicit paths:

```bash
buildroot remote-fetch \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --id br-20260419-abcdef12 \
  --dest ./artifacts \
  --path output/images/*
```

## Flags

The CLI owns orchestration flags such as `--ssh`, `--workspace`,
`--buildroot-version`, `--output`, `--json`, and `--detach`.

Buildroot-specific execution flags are:

- `--defconfig NAME`: run a defconfig target before the final build.
- `--make-arg ARG`: pass a repeated explicit make argument.
- `--env KEY=VALUE`: pass a repeated environment variable.
- `-- ...`: forward remaining raw arguments to the final `make` invocation.

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

Successful commands emit one JSON object unless the command streams logs.
Streaming commands emit newline-delimited JSON events followed by a final
summary object.

Example:

```bash
buildroot --json --help
buildroot remote-build \
  --json \
  --ssh builder@example.com:2222 \
  --workspace workflow-workspace \
  --buildroot-version 2025.02.1
```

Example final object:

```json
{
  "command": "remote-build",
  "status": "success",
  "exit_code": 0,
  "summary": "completed remote Buildroot build",
  "details": {
    "id": "br-20260419-abcdef12",
    "workspace": "workflow-workspace",
    "build_dir": "workflow-workspace/tools/buildroot/builds/br-20260419-abcdef12",
    "manifest": "workflow-workspace/tools/buildroot/builds/br-20260419-abcdef12/manifest.json",
    "log_file": "workflow-workspace/tools/buildroot/builds/br-20260419-abcdef12/stdout.log"
  }
}
```

## Provisioning

`remote-build` provisions Buildroot from the official release tarball pattern:

```text
https://buildroot.org/downloads/buildroot-<version>.tar.gz
```

The tool reuses cached tarballs and extracted source trees inside the remote
workspace when the requested version already exists.

The `--workspace` value is intended to be a shared high-level workflow
workspace. `buildroot` should use a namespaced tool area within that workspace
rather than assuming it owns the workspace root.

## Stable metadata

For automation, these files are the primary stable contracts:

- `manifest.json`: build identity, mode, status, version, and workspace state.
- `stdout.log`: captured build output for later inspection.

Local builds store metadata under:

```text
<output>/.buildroot-cli/build.json
```

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
