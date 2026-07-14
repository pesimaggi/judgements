import { NextResponse } from "next/server";
import { SOURCES } from "@/lib/sources";

/** Returns the three selectable court sources for the left panel. */
export async function GET() {
  return NextResponse.json({ sources: SOURCES });
}
