# Morpheus

Morpheus is a repo-local CLI for managing workspaces, tool executions, and
workflow-run inspection.

## Quick Start

Create the configured workspace layout:

```bash
./bin/morpheus workspace create
```

Run a tool through Morpheus (records a workflow run under the workspace):

```bash
./bin/morpheus workflow run --name build-buildroot --json
```

Launch an `nvirsh` runtime through Morpheus:

```bash
./bin/morpheus run --tool nvirsh --json -- --detach
```

## Run Storage Model

Morpheus records executions as workflow runs under:

- `<workspace>/runs/<workflow-run-id>/`
- `<workspace>/runs/<workflow-run-id>/steps/<step-id>/run/`

When a managed tool run provisions other managed tool dependencies, those child
runs are nested under the parent tool run:

- `<workspace>/runs/<workflow-run-id>/steps/<step-id>/run/runs/<tool-run-id>/`

Tool caches remain reusable under:

- `<workspace>/tools/<tool>/src/`
- `<workspace>/tools/<tool>/builds/`
- `<workspace>/tools/<tool>/cache/`

When Morpheus runs in remote mode with synced repo sources, the remote runtime
rebuilds all repo-local CLI wrappers from `tool.json` metadata. This keeps
`morpheus`, `llbic`, `llcg`, and other managed tool launchers consistent
without hardcoding per-tool wrapper scripts.

## Usage

The public command tree includes:

- `workspace create|show`
- `config check`
- `tool list`
- `workflow run|inspect|logs`

## `nvirsh` runtime wiring

When `tools.nvirsh` is configured in `morpheus.yaml`, use `dependencies` for
artifact producers and `runtime` for the runtime provider contract:

```yaml
tools:
  nvirsh:
    mode: local
    target: sel4
    name: sel4-dev
    runtime:
      provider:
        tool: libvmm
        artifact: runtime-contract
      action: qemu
    dependencies:
      libvmm:
        tool: libvmm
        artifact: libvmm-dir
      kernel:
        tool: buildroot
        artifact: images/Image
      initrd:
        tool: buildroot
        artifact: images/rootfs.cpio.gz
```
