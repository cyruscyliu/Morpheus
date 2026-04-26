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
