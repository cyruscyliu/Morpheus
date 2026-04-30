import { WorkflowViewer } from "@/components/workflow-viewer";
import { resolveViewerContext } from "@/src/server/context";
import { listRunSummariesWithTotal } from "@/src/server/runs-store";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ config?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const context = resolveViewerContext(resolvedSearchParams.config || null);
  const initialRuns = listRunSummariesWithTotal(context.runRoot, {});

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
    />
  );
}
