import { NextResponse } from "next/server";

import { stopWorkflowRun } from "@/src/server/actions";
import { isSafeId } from "@/src/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const resolvedParams = await params;
  const runId = decodeURIComponent(resolvedParams.runId || "");
  if (!isSafeId(runId)) {
    return new NextResponse("not found\n", { status: 404 });
  }
  const result = stopWorkflowRun(runId);
  return NextResponse.json(result.body, { status: result.statusCode });
}
