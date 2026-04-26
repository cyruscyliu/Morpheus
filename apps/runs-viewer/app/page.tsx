import { WorkflowViewer } from "@/components/workflow-viewer";
import { resolveViewerContext } from "@/src/server/context";
import { listRunSummariesWithTotal } from "@/src/server/runs-store";

export default function Page() {
  const context = resolveViewerContext();
  const initialRuns = listRunSummariesWithTotal(context.runRoot, {});

  return (
    <WorkflowViewer
      initialSummaries={initialRuns.runs}
      initialTotalRuns={initialRuns.total}
      initialUpdatedAt={new Date().toISOString()}
    />
  );
}
