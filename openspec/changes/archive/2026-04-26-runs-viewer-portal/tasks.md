## 1. App scaffolding

- [x] 1.1 Create `apps/runs-viewer` package skeleton
- [x] 1.2 Add Vite dev server bound to `127.0.0.1:4174`
- [x] 1.3 Add root `pnpm` script to start the viewer

## 2. Workspace and run root discovery

- [x] 2.1 Implement `morpheus.yaml` discovery (walk parents to find nearest)
- [x] 2.2 Resolve `workspace.root` relative to config directory
- [x] 2.3 Implement fallback to default workspace when config missing

## 3. Run parsing and normalization

- [x] 3.1 Define normalized `RunSummary` and `RunDetail` data shapes
- [x] 3.2 Implement legacy run reader (`run.json` + `index.json` + step files)
- [x] 3.3 Implement workflow-first run reader (`workflow.json` + step `step.json`)
- [x] 3.4 Sort and paginate run listing (start with newest-first ordering)

## 4. HTTP API

- [x] 4.1 Implement `GET /api/runs` with normalized summaries
- [x] 4.2 Implement `GET /api/runs/<run-id>` with normalized details
- [x] 4.3 Implement `GET /api/runs/<run-id>/steps/<step-id>/log`
- [x] 4.4 Add strict run id / step id validation to prevent path traversal

## 5. Live updates (watch + SSE)

- [x] 5.1 Add file watcher for the run root
- [x] 5.2 Implement `GET /api/events` SSE endpoint
- [x] 5.3 Broadcast `runs-changed` events on watcher updates
- [x] 5.4 Debounce watcher events to avoid UI thrash

## 6. UI

- [x] 6.1 Build a simple index view that lists runs and basic metadata
- [x] 6.2 Build a run detail view with step list and status highlighting
- [x] 6.3 Wire UI to refetch on `runs-changed` SSE events
- [x] 6.4 Add manual refresh and basic filtering (status and search by id)

## 7. Tests and docs

- [x] 7.1 Add unit tests for config discovery and path resolution
- [x] 7.2 Add unit tests for legacy and workflow-first normalization
- [x] 7.3 Document the viewer dev command and expected workspace layout
