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
./bin/morpheus --json tool build --tool buildroot --mode local
```

Stage and then launch an `nvirsh` runtime through Morpheus:

```bash
./bin/morpheus --json tool build --tool nvirsh
./bin/morpheus --json tool run --tool nvirsh
```

Inspect recorded workflow runs:

```bash
./bin/morpheus runs list
./bin/morpheus runs show <workflow-run-id>
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

## Usage

The public command tree includes:

- `workspace create|show`
- `config check`
- `tool build|run|list`
- `workflow run|inspect|logs`
- `runs list|show|export-html`

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
