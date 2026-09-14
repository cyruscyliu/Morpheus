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

Build the workspace:

```bash
pnpm setup
```

This builds the workspace. Run the CLI with `node apps/morpheus/dist/cli.js`
or use an independently installed `morpheus` command.

Validate a project config:

```bash
./bin/morpheus --config <workspace-root>/morpheus.yaml config check --json
```

Run a workflow:

```bash
./bin/morpheus --config <workspace-root>/morpheus.yaml workflow run --name buildroot-qemu-runtime --json
```

Inspect a prior run:

```bash
./bin/morpheus --config <workspace-root>/morpheus.yaml workflow inspect --id <workflow-run-id> --json
./bin/morpheus --config <workspace-root>/morpheus.yaml workflow logs --id <workflow-run-id>
```

## Maintenance

Common maintenance tasks:

- rebuild the CLI:

```bash
pnpm --filter @morpheus/app build
```

The workspace is the current directory. It must contain both `morpheus.yaml`
and `.morpheus`. Cache is only `cache.root` in the project `morpheus.yaml`.

- check available scripts:

```bash
pnpm run
```

- stop and remove a workflow run cleanly:

```bash
./bin/morpheus --config <workspace-root>/morpheus.yaml workflow stop --id <run-id> --json
./bin/morpheus --config <workspace-root>/morpheus.yaml workflow remove --id <run-id> --json
```

Project configs live under `<workspace-root>/morpheus.yaml`.
The CI-only fixture lives at `tests/morpheus.yaml`; it is not a project config.

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
