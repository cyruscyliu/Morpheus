import { NextResponse } from "next/server";

import { resolveViewerContext } from "@/src/server/context";
import { loadRunLogText } from "@/src/server/runs-store";
import { isSafeId } from "@/src/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const resolvedParams = await params;
  const runId = decodeURIComponent(resolvedParams.runId || "");
  if (!isSafeId(runId)) {
    return new NextResponse("not found\n", { status: 404 });
  }
  const url = new URL(request.url);
  const context = resolveViewerContext(url.searchParams.get("config"));
  const logText = loadRunLogText(context.runRoot, runId);
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
