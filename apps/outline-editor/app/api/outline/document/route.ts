import { NextRequest, NextResponse } from "next/server";

import { readOutlineFile } from "@/lib/outline-store";
import { outlineToText } from "@/lib/outline-text";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") || "current-outline.json";
  const file = readOutlineFile(name);
  return NextResponse.json({
    name: file.name,
    path: file.path,
    metadata: file.metadata,
    text: outlineToText(file.outline),
  });
}
