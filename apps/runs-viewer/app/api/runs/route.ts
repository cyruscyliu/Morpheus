import { NextResponse } from "next/server";

import { listRunSummariesWithTotal } from "@/src/server/runs-store";
import { resolveViewerContext } from "@/src/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const context = resolveViewerContext();
  const url = new URL(request.url);
  const result = listRunSummariesWithTotal(context.runRoot, {
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  return NextResponse.json({
    runRoot: context.runRoot,
    workspaceRoot: context.workspaceRoot,
    configPath: context.configPath,
    updatedAt: new Date().toISOString(),
    runs: result.runs,
    totalRuns: result.total,
    offset: result.offset,
    limit: result.limit,
  });
}
