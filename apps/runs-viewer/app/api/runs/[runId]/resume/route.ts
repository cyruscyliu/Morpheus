import { NextResponse } from "next/server";

import { resumeWorkflowRun } from "@/src/server/actions";

interface RouteContext {
  params: Promise<{
    runId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { runId } = await context.params;
  const url = new URL(request.url);
  const fromStep = url.searchParams.get("fromStep");
  const result = resumeWorkflowRun(runId, fromStep, url.searchParams.get("config"));
  return NextResponse.json(result.body, { status: result.statusCode });
}
