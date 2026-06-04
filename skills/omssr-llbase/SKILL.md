---
name: llbase
description: Prepare and inspect the shared llbase runtime contract that llbic and llcg use for helper scripts, image-family metadata, and container-oriented execution guidance.
license: MIT
compatibility: Designed for Claude Code (or similar products)
---

# llbase Skill

Use this skill when you need to reason about the shared runtime layer for
`llbic` and `llcg`, especially when deciding how Morpheus-managed execution
should refer to helper scripts, image families, and the actual container
execution path without hard-coding environment-specific assumptions into each
tool separately.

## Purpose

`llbase` is the shared runtime provider for the `ll*` tools in this repo.
Under Morpheus it is modeled as a managed tool that emits a runtime contract
consumed directly by the `llbic` and `llcg` bridge scripts.

That contract records:

- helper script locations such as `install_rust_env.sh`
- the shared container runtime helper used to launch managed runs
- image-family metadata for `latest`, `mid`, and `legacy`
- the shared IRDumper install root expectation
- the kernel-era to image-family mapping

## Managed Usage

Published image families:

- `ghcr.io/cyruscyliu/llbase:latest` for recent kernels (`6.x`, `7.x`)
  with Clang `14`, `15`, `16`, and `18`
- `ghcr.io/cyruscyliu/llbase:mid` for mid-era kernels (`4.x`, `5.x`)
  with Clang `8`, `9`, `10`, `11`, and `12`
- `ghcr.io/cyruscyliu/llbase:legacy` for older kernels (`2.6`, `3.x`)
  with Clang `6.0`, `7`, and `8`

Build the runtime contract:

```bash
./bin/morpheus build --tool llbase \
  --source ./tools/llbase \
  --output ./workspace/tools/llbase/builds/latest/output \
  --json
```

By default this resolves and pulls the published GHCR image metadata for the
selected family. Keep local image builds as an explicit debugging path with
`--build-image`.

Inspect an existing contract:

```bash
./bin/morpheus inspect --tool llbase \
  --target ./workspace/tools/llbase/builds/latest/output/runtime-contract.json \
  --json
```

Provision host-side prerequisites first when needed:

```bash
./tools/llbase/scripts/install-dependencies.sh
```

The repo-root `install-dependencies.sh` also discovers and runs this tool-local
installer automatically.

Build the images from the `tools/llbase` source tree with:

```bash
docker build -f docker/Dockerfile -t ghcr.io/cyruscyliu/llbase:latest .
docker build -f docker/Dockerfile.mid -t ghcr.io/cyruscyliu/llbase:mid .
docker build -f docker/Dockerfile.legacy -t ghcr.io/cyruscyliu/llbase:legacy .
```

Or use Compose:

```bash
docker compose build llbase
docker compose build llbase-mid
docker compose build llbase-legacy
```

Images are published to GHCR by the repo workflow that builds and publishes:

- `ghcr.io/cyruscyliu/llbase:latest`
- `ghcr.io/cyruscyliu/llbase:mid`
- `ghcr.io/cyruscyliu/llbase:legacy`

## How llbic and llcg Use It

- `llbic` consumes the runtime contract through `llbase-contract` and runs the
  legacy kernel-bitcode pipeline inside the selected `llbase` image.
- `llcg` consumes the same contract and runs both mutator generation and
  callgraph execution inside the selected `llbase` image.

## Practical Guidance

- Treat `llbase` as the authoritative place for shared image-family metadata
  and container-launch behavior.
- Keep helper-script paths and container runtime guidance in the contract
  rather than duplicating them across `llbic` and `llcg`.
- Keep `llbase` focused on shared runtime concerns only, not tool-specific
  workflow logic.
- Keep image family behavior aligned across `docker/Dockerfile`,
  `docker/Dockerfile.mid`, and `docker/Dockerfile.legacy`.
- If image names, helper scripts, or shared runtime conventions change, update
  `tools/llbase/tool.json` and this skill together.
