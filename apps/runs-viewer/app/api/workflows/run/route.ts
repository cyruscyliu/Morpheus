import { NextResponse } from "next/server";

import { startConfiguredWorkflow } from "@/src/server/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const configPath = url.searchParams.get("config");
  const body = await request.json().catch(() => ({}));
  const workflowName = body && typeof body.name === "string" ? body.name.trim() : "";
  if (!workflowName) {
    return NextResponse.json({ summary: "workflow name is required" }, { status: 400 });
  }
  const result = startConfiguredWorkflow(configPath, workflowName);
  return NextResponse.json(result.body, { status: result.statusCode });
}
