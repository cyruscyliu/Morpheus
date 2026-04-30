import { NextResponse } from "next/server";

import { loadRunDetail } from "@/src/server/runs-store";
import { resolveViewerContext } from "@/src/server/context";
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
  const detail = loadRunDetail(context.runRoot, runId);
  if (!detail) {
    return new NextResponse("not found\n", { status: 404 });
  }
  return NextResponse.json(detail);
}
