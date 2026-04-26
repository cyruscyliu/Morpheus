# Workflow Viewer

Local-first web UI for browsing Morpheus workflow runs.

This app reads the on-disk workflow records under `<workspace>/runs/` and
serves a small UI + JSON API for workflow inspection. It does not invoke the
Morpheus CLI.

## Quick start

Start the Workflow Viewer:

```bash
pnpm dev:runs-viewer
```

The server binds to `127.0.0.1:4174`.

## Workspace discovery

The Workflow Viewer searches for `morpheus.yaml` by walking up from the current
working directory. When `workspace.root` is present, it uses
`<workspace.root>/runs/` as the workflow root.

When `morpheus.yaml` is missing, the Workflow Viewer falls back to the
repo-local default workspace root under `hyperarm-workspace/`.

## API

- `GET /api/runs`
- `GET /api/runs/<run-id>`
- `GET /api/runs/<run-id>/steps/<step-id>/log`
- `GET /api/events` (SSE `runs-changed`)

## UI Notes

- The left pane is workflow navigation, with each workflow labeled as
  `build` or `run`.
- Collapsing the left pane shrinks it to a persistent rail instead of hiding
  workflow navigation entirely.
- The middle pane shows workflow overview metadata above the step list.
