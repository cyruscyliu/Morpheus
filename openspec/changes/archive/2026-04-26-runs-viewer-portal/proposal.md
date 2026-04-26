## Why

Morpheus records rich workflow run data on disk, but inspecting runs through the
CLI makes it hard to scan history, compare failures, and quickly drill into step
artifacts and logs. A local-first web portal improves day-to-day iteration and
provides a fast feedback loop while the run schema evolves.

## What Changes

- Add a new local-first Runs Viewer web app under `apps/` with a `pnpm` dev
  target.
- The viewer discovers the workspace via `morpheus.yaml` and reads
  `<workspace>/runs/` directly, without invoking the Morpheus CLI.
- The viewer exposes a small HTTP API for listing runs and loading run details,
  and serves a simple UI for browsing them.
- The viewer watches the run root and pushes "runs changed" notifications to the
  browser so the UI can refresh live.
- The viewer binds to `127.0.0.1` only and defaults to port `4174`.

## Capabilities

### New Capabilities

- `morpheus-runs-viewer`: Local-first web portal that reads Morpheus run
  directories, serves a UI + JSON API, and updates live via file watching.

### Modified Capabilities

- (none)

## Impact

- Adds a new workspace package under `apps/` and a root-level `pnpm` convenience
  script.
- Introduces a small set of runtime dependencies for the viewer (Vite dev
  server, file watching).
- No changes to Morpheus CLI behavior are required for v1; the viewer reads the
  on-disk run records.

