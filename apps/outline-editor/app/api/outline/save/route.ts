import { NextRequest, NextResponse } from "next/server";

import { readOutlineFile, saveOutlineVersion } from "@/lib/outline-store";
import { parseTextDocument, textDocumentToOutline } from "@/lib/outline-text";

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const baseName = typeof payload.baseName === "string" && payload.baseName.trim()
    ? payload.baseName.trim()
    : "current-outline.json";
  const text = typeof payload.text === "string" ? payload.text : "";
  const makeCurrent = Boolean(payload.makeCurrent);
  const previous = readOutlineFile(baseName);
  const textDocument = parseTextDocument(text);
  const outline = textDocumentToOutline(textDocument, previous.outline);
  const saved = saveOutlineVersion(outline, { makeCurrent });
  return NextResponse.json({
    ok: true,
    version: saved.versionName,
    currentOutline: saved.currentPath,
  });
}
