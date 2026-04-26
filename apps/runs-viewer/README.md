# Runs Viewer

Local-first web UI for browsing Morpheus workflow runs.

This app reads the on-disk run records under `<workspace>/runs/` and serves a
small UI + JSON API for run inspection. It does not invoke the Morpheus CLI.

## Quick start

Start the viewer:

```bash
pnpm dev:runs-viewer
```

The server binds to `127.0.0.1:4174`.

## Workspace discovery

The viewer searches for `morpheus.yaml` by walking up from the current working
directory. When `workspace.root` is present, it uses `<workspace.root>/runs/` as
the run root.

When `morpheus.yaml` is missing, the viewer falls back to the repo-local default
workspace root under `hyperarm-workspace/`.

## API

- `GET /api/runs`
- `GET /api/runs/<run-id>`
- `GET /api/runs/<run-id>/steps/<step-id>/log`
- `GET /api/events` (SSE `runs-changed`)

