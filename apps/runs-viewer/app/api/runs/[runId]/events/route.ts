import { NextResponse } from "next/server";

import { resolveViewerContext } from "@/src/server/context";
import { loadRunEvents } from "@/src/server/runs-store";
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
  const events = loadRunEvents(context.runRoot, runId);
  if (!events) {
    return new NextResponse("not found\n", { status: 404 });
  }
  return NextResponse.json({ events });
}
