import { NextResponse } from "next/server";

import { resolveViewerContext } from "@/src/server/context";
import { listConfiguredWorkflows } from "@/src/server/morpheus-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const context = resolveViewerContext(url.searchParams.get("config"));
  const workflows = listConfiguredWorkflows(context);
  return NextResponse.json({
    configPath: context.configPath,
    configLabel: context.configLabel,
    workflows,
  });
}
