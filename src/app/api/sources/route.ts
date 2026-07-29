import { NextResponse } from "next/server";
import { SOURCES } from "@/lib/sources";

/**
 * The sources the search UI offers. Pilot sources (an adapter still being
 * built, so no documents yet) are deliberately excluded — see lib/sources.ts.
 */
export async function GET() {
  return NextResponse.json({ sources: SOURCES });
}
