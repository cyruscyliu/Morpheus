# Workflow Viewer

Next.js workflow viewer for browsing Morpheus workflow runs.

This app serves both a React UI and local JSON API for workflow inspection.
Run reads, workflow/config cataloging, and selected-config resolution are
CLI-backed through Morpheus where possible, while live file watching still
uses local workspace state.

## Quick start

Start the Workflow Viewer:

```bash
pnpm dev:runs-viewer
```

The server binds to `127.0.0.1:4174`.

## UI notes

- The top bar keeps refresh and workflow summary controls visible.
- The middle workspace keeps workflow history on the left and the selected
  workflow graph on the right.
- The bottom panel provides `Overview`, `Log`, and `Artifacts` tabs for
  workflow-scoped and step-scoped inspection.
- The UI uses a small `shadcn/ui`-style component base on top of Tailwind.

## Endpoint Map

This section maps each HTTP endpoint to its backend implementation and whether
it uses direct on-disk run metadata or Morpheus CLI commands.

### Read endpoints

| HTTP endpoint | Route handler | Backend implementation | Morpheus CLI |
| --- | --- | --- | --- |
| `GET /` | `app/page.tsx` | `resolveViewerContext(...)` + `listRunSummariesWithTotal(context, ...)` | `morpheus --json config show` then `morpheus --json workflow runs [--limit <n>] [--offset <n>] --workspace <workspaceRoot>` |
| `GET /api/runs` | `app/api/runs/route.ts` | `resolveViewerContext(...)` + `listRunSummariesWithTotal(context, ...)` | `morpheus --json config show` then `morpheus --json workflow runs [--limit <n>] [--offset <n>] --workspace <workspaceRoot>` |
| `GET /api/workflows` | `app/api/workflows/route.ts` | `resolveViewerContext(...)` + `listConfiguredWorkflows(context)` | `morpheus --json config show` then `morpheus --json workflow list --workspace <workspaceRoot>` |
| `GET /api/runs/[runId]` | `app/api/runs/[runId]/route.ts` | `resolveViewerContext(...)` + `loadRunDetail(context, runId)` | `morpheus --json config show` then `morpheus --json workflow inspect --id <runId> --workspace <workspaceRoot>` |
| `GET /api/runs/[runId]/log` | `app/api/runs/[runId]/log/route.ts` | `loadRunLogText(context, runId)` | `morpheus --json config show` then `morpheus --json workflow inspect --id <runId> --workspace <workspaceRoot>` plus per-step `morpheus workflow logs --id <runId> --step <stepId> --workspace <workspaceRoot>` |
| `GET /api/runs/[runId]/steps/[stepId]/log` | `app/api/runs/[runId]/steps/[stepId]/log/route.ts` | `loadStepLogText(context, runId, stepId)` | `morpheus --json config show` then `morpheus workflow logs --id <runId> --step <stepId> --workspace <workspaceRoot>` |
| `GET /api/runs/[runId]/events` | `app/api/runs/[runId]/events/route.ts` | `loadRunEvents(context, runId)` | `morpheus --json config show` then `morpheus --json workflow events --id <runId> --workspace <workspaceRoot>` |
| `GET /api/events` | `app/api/events/route.ts` | `subscribeRunsEvents(configPath, client)` | No CLI equivalent; filesystem watcher |

### Action endpoints

| HTTP endpoint | Route handler | Backend implementation | Morpheus CLI |
| --- | --- | --- | --- |
| `POST /api/workflows/run` | `app/api/workflows/run/route.ts` | `startConfiguredWorkflow(configPath, workflowName)` | `workflow run --name <workflowName>` |
| `POST /api/runs/[runId]/stop` | `app/api/runs/[runId]/stop/route.ts` | `stopWorkflowRun(runId, configPath)` | `workflow stop --id <runId>` |
| `POST /api/runs/[runId]/resume` | `app/api/runs/[runId]/resume/route.ts` | `resumeWorkflowRun(runId, fromStep, configPath)` | `workflow resume --id <runId> [--from-step <stepId>]` |
| `POST /api/runs/[runId]/remove` | `app/api/runs/[runId]/remove/route.ts` | `removeWorkflowRun(runId, configPath)` | Stops via CLI first when needed, then removes run dir directly |

### Notes

- Current App Router read endpoints use Morpheus CLI wrappers in
  `src/server/morpheus-client.ts`.
- Selected-config resolution now uses Morpheus CLI `config show`, while local
  fallback helpers remain in `src/server/run-root.ts` for tests.
- Current write/control actions use Morpheus CLI wrappers in
  `src/server/actions.ts`.
- `GET /api/events` still uses direct filesystem watching in
  `src/server/events.ts` because the Morpheus CLI does not currently expose a
  live watch/streaming interface for run changes.
- The older custom Node middleware server path in `src/server/dev-server.ts`
  has been removed; the maintained server surface is the Next.js App Router API.

### File-backed Candidates

These surfaces still rely on direct filesystem or repo-local state and would
need new Morpheus CLI support to become fully CLI-backed:

- Live change notifications in `src/server/events.ts`
  `GET /api/events` uses `chokidar` on the run root and emits SSE updates.
  There is no Morpheus CLI watch/stream equivalent today.

- Filesystem-backed fallback/test reader in `src/server/workspace-runs-store.ts`
  This remains as the direct on-disk implementation used by tests and as a
  fallback/reference path, but it is no longer the primary App Router read path.
