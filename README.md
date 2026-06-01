# Morpheus

[![Version](https://img.shields.io/badge/version-0.4.2-blue.svg)](#)
[![Buildroot](https://img.shields.io/badge/tool-buildroot-6aa84f.svg)](#)
[![QEMU](https://img.shields.io/badge/tool-qemu-3d85c6.svg)](#)
[![Microkit SDK](https://img.shields.io/badge/tool-microkit--sdk-e69138.svg)](#)
[![libvmm](https://img.shields.io/badge/tool-libvmm-cc0000.svg)](#)
[![NQC2](https://img.shields.io/badge/tool-nqc2-674ea7.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)](#)

Morpheus is a system security research platform.

It provides:

- a workflow-first management CLI
- managed tool execution and artifact tracking
- project-scoped workspace layout
- local and remote workflow orchestration

## Quick start

Install dependencies and project tooling:

```bash
./install-dependencies.sh
```

Install JavaScript dependencies:

```bash
pnpm install
```

Build the workspace and install the repo-local CLI wrapper:

```bash
pnpm setup
```

This builds the workspace and installs the repo-local `morpheus` wrapper under
`bin/`.

Validate a project config:

```bash
./bin/morpheus --config projects/hyperarm/morpheus.yaml config check --json
```

Run a workflow:

```bash
./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow run --name buildroot-qemu-runtime --json
```

Inspect a prior run:

```bash
./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow inspect --id <workflow-run-id> --json
./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow logs --id <workflow-run-id>
```

Enable and migrate global cache for a config:

```bash
pnpm cache:enable -- --config projects/hyperarm/morpheus.yaml
```

## Maintenance

Common maintenance tasks:

- rebuild the CLI:

```bash
pnpm --filter @morpheus/app build
```

- install or refresh the repo-local wrapper:

```bash
pnpm run install:bin
```

- enable cache for a config at the beginning or in the middle of development:

```bash
pnpm cache:enable -- --config morpheus.yaml
pnpm cache:enable -- --config projects/hyperarm/morpheus.yaml
```

The shared cache root defaults to `~/.cache/morpheus`.

- check available scripts:

```bash
pnpm run
```

- stop and remove a workflow run cleanly:

```bash
./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow stop --id <run-id> --json
./bin/morpheus --config projects/hyperarm/morpheus.yaml workflow remove --id <run-id> --json
```

Developer UI helpers:

Start the documentation site locally:

```bash
pnpm dev:docs
```

Then open `http://127.0.0.1:4173`.

Start the local runs viewer:

```bash
pnpm dev:runs-viewer
```

Then open `http://127.0.0.1:4174`.

When launching the run viewer through Paseo, set `RUN_VIEWER_PORT` to override
the default `8081`.

Project configs live under `projects/<project>/morpheus.yaml`.
The root `morpheus.yaml` is intentionally minimal and exists only as a default
CI/testing stub.

For runtime-managed runs, keep the lifecycle split explicit:

- `stop` ends execution and preserves manifests and logs
- `remove` deletes persisted run state
- `remove` requires a prior successful stop

Tool-specific usage and workflow guidance now live in the skills under
`skills/`.

Use those as the authoritative source for:

- per-tool setup
- managed dependency wiring
- remote transport expectations
- artifact path conventions
- realistic examples

## License

This repository is released under the [MIT license](./LICENSE).
