import { NextResponse } from "next/server";

import { listOutlineFiles } from "@/lib/outline-store";

export async function GET() {
  return NextResponse.json(listOutlineFiles());
}
