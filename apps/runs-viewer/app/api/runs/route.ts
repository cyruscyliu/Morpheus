import { NextResponse } from "next/server";

import { listRunSummariesWithTotal } from "@/src/server/runs-store";
import { resolveViewerContext } from "@/src/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const context = resolveViewerContext(url.searchParams.get("config"));
  const result = listRunSummariesWithTotal(context.runRoot, {
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  return NextResponse.json({
    runRoot: context.runRoot,
    workspaceRoot: context.workspaceRoot,
    configPath: context.configPath,
    configLabel: context.configLabel,
    availableConfigs: context.availableConfigs,
    availableWorkflows: context.availableWorkflows,
    updatedAt: new Date().toISOString(),
    runs: result.runs,
    totalRuns: result.total,
    offset: result.offset,
    limit: result.limit,
  });
}
