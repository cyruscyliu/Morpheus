# Workflow Viewer

Next.js workflow viewer for browsing Morpheus workflow runs.

This app reads the on-disk workflow records under `<workspace>/runs/` and
serves both a React UI and local JSON API for workflow inspection.

## Quick start

Start the Workflow Viewer:

```bash
pnpm dev:runs-viewer
```

The server binds to `127.0.0.1:4174`.

## What it serves

- Next.js App Router UI at `/`
- `GET /api/runs`
- `GET /api/runs/<run-id>`
- `GET /api/runs/<run-id>/steps/<step-id>/log`
- `POST /api/runs/<run-id>/stop`
- `POST /api/runs/<run-id>/remove`
- `GET /api/events`

## UI notes

- The left pane stays workflow-first and can collapse to a dot rail.
- The workflow and log panes remain side-by-side with a draggable split.
- The UI uses a small `shadcn/ui`-style component base on top of Tailwind.
