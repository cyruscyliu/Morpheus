import { NextResponse } from "next/server";

import { resolveViewerContext } from "@/src/server/context";
import { loadStepLogText } from "@/src/server/runs-store";
import { isSafeId } from "@/src/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; stepId: string }> },
): Promise<NextResponse> {
  const resolvedParams = await params;
  const runId = decodeURIComponent(resolvedParams.runId || "");
  const stepId = decodeURIComponent(resolvedParams.stepId || "");
  if (!isSafeId(runId) || !isSafeId(stepId)) {
    return new NextResponse("not found\n", { status: 404 });
  }
  const url = new URL(request.url);
  const context = resolveViewerContext(url.searchParams.get("config"));
  const logText = loadStepLogText(context.runRoot, runId, stepId);
  if (logText == null) {
    return new NextResponse("not found\n", { status: 404 });
  }
  return new NextResponse(logText, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
