import { WorkflowViewer } from "@/components/workflow-viewer";
import { buildInitialGraphLayout } from "@/src/lib/graph-layout";
import { resolveViewerContext } from "@/src/server/context";
import { listRunSummariesWithTotal, loadRunDetail } from "@/src/server/morpheus-client";
import { type RunSummary } from "@/src/types";

function normalizeInitialSelectedRunId(
  runs: RunSummary[],
  requestedRunId: string | null,
): string | null {
  if (runs.length === 0) {
    return null;
  }
  if (requestedRunId && runs.some((run) => run.id === requestedRunId)) {
    return requestedRunId;
  }
  return runs[0]?.id || null;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ config?: string; runId?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const context = resolveViewerContext(resolvedSearchParams.config || null);
  const initialRuns = listRunSummariesWithTotal(context, {});
  const initialSelectedRunId = normalizeInitialSelectedRunId(initialRuns.runs, resolvedSearchParams.runId || null);
  const initialRunDetail = initialSelectedRunId
    ? loadRunDetail(context, initialSelectedRunId)
    : null;
  const initialGraphLayout = initialRunDetail
    ? buildInitialGraphLayout(initialRunDetail.graph.nodes, initialRunDetail.graph.edges)
    : null;

  return (
    <WorkflowViewer
      initialSummaries={initialRuns.runs}
      initialTotalRuns={initialRuns.total}
      initialUpdatedAt={new Date().toISOString()}
      initialWorkspaceRoot={context.workspaceRoot}
      initialConfigPath={context.configPath}
      initialConfigLabel={context.configLabel}
      initialAvailableConfigs={context.availableConfigs}
      initialAvailableWorkflows={context.availableWorkflows}
      initialSelectedRunId={initialSelectedRunId}
      initialRunDetail={initialRunDetail}
      initialGraphLayout={initialGraphLayout}
    />
  );
}
