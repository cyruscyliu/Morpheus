## Context

Morpheus records workflow runs under `<workspace>/runs/` and provides inspection
via CLI output. There is also an existing static HTML export path
(`morpheus runs export-html`) that renders run summaries and run detail pages.

The on-disk run schema is evolving. Today, the workspace can contain:

- Legacy/trace runs rooted at `<workspace>/runs/<run-id>/` with `run.json`,
  `index.json`, and per-step records like `artifacts.json`, `invocation.json`,
  and `assessment-*.json`.
- Workflow-first runs rooted at `<workspace>/runs/<workflow-run-id>/` with
  `workflow.json`, per-step `step.json`, and log files such as `stdout.log`.

The user experience goal is a live, local-first web portal that makes it easy
to scan runs and drill into failures, without mixing the viewer with Morpheus
CLI command execution.

Constraints:

- Local-first: read run records from disk.
- Safe by default: bind to `127.0.0.1` only.
- Integrate with existing workspace config: discover the workspace root via
  `morpheus.yaml` when present.

## Goals / Non-Goals

**Goals:**

- Provide a `pnpm` target that starts a run viewer on `127.0.0.1:4174`.
- Discover the run root as `<workspace.root>/runs` by reading `morpheus.yaml`
  (fallback to the repo's default workspace when missing).
- Provide a minimal JSON API for run listing and run detail views.
- Watch the run root and notify connected browsers so the UI updates live.
- Normalize multiple on-disk run layouts into one viewer model.

**Non-Goals:**

- No changes to the Morpheus CLI surface for v1.
- No remote/managed run inspection in the viewer for v1.
- No authentication or multi-user deployment model.
- No guarantee of stable viewer API for third parties (v1 is a developer tool).

## Decisions

### Decision: Create a dedicated viewer app as a workspace package

Implement the viewer as `apps/runs-viewer` with its own `pnpm` scripts. The app
reads run data directly and does not invoke `./bin/morpheus`.

Rationale:

- Keeps responsibilities clear and avoids circular coupling.
- Enables rapid UI iteration without affecting the CLI interface.

Alternatives considered:

- Add `morpheus runs serve` to the CLI.
  - Rejected: mixes viewer runtime concerns with Morpheus CLI semantics.

### Decision: Use a single-port dev server with built-in API endpoints

Use Vite's dev server with a small middleware plugin that exposes `/api/*`
endpoints and an SSE endpoint for change notifications.

Rationale:

- One process, one port, low overhead.
- No separate backend build step for v1.

Alternatives considered:

- Separate Node server + SPA.
  - Possible later, but unnecessary for v1.

### Decision: Watch run root and push change events via SSE

Use file watching on `<run-root>` and broadcast a `runs-changed` event to
clients via Server-Sent Events (SSE). The browser responds by refetching run
lists and (when open) run details.

Rationale:

- Simple model that avoids polling.
- Works well for "refresh when anything changes" semantics.

Alternatives considered:

- Client-side polling.
  - Rejected per requirement ("watching").

### Decision: Parse `morpheus.yaml` for workspace discovery

Mirror the existing Morpheus config search behavior: walk up from the current
working directory to find `morpheus.yaml`, parse it, and resolve
`workspace.root` relative to the config directory.

Rationale:

- Matches user expectations and existing tooling behavior.

### Decision: Normalize run records to a common viewer model

The viewer detects a run layout by presence of `workflow.json` versus
`run.json`/`index.json`, then maps into a single run summary / run detail model
used by the UI.

Rationale:

- Keeps the viewer useful during the workflow-first migration.
- Avoids forcing a run schema migration for the portal to work.

## Risks / Trade-offs

- [Watcher flakiness on some filesystems] → Prefer a robust watcher library and
  add a manual refresh action in the UI.
- [Schema drift between run formats] → Keep the normalization layer small and
  explicitly handle missing fields.
- [Accidental data exfiltration via static file serving] → Do not serve
  arbitrary files from disk; only return parsed JSON and known log paths after
  validating run ids and step ids.
- [Performance on large run histories] → Provide paging or incremental loading
  later; v1 can start with loading summaries only and lazy-loading details.

## Migration Plan

1. Scaffold `apps/runs-viewer` with a Vite dev server bound to `127.0.0.1:4174`.
2. Implement config discovery (`morpheus.yaml`) and compute `<workspace>/runs`.
3. Implement `/api/runs` and `/api/runs/:id` by reading and normalizing the on
   disk records.
4. Add file watching and an SSE endpoint; wire the UI to refresh on events.
5. Add a root-level `pnpm` convenience script for quick launch.
6. Add basic tests for parsing/normalization and config discovery.

## Open Questions

- Should the viewer support multiple configured workspaces (beyond the default)
  in v1, or only the default workspace from `morpheus.yaml`?
- Should the viewer expose step logs as full text or a bounded tail by default?

