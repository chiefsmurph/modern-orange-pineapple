// POST /api/validate-code — retired (10/13): /redeem now uses /api/legacy-claim/lookup,
// which also accepts old card codes that were lost from codes.json, with a rate limit.
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ valid: false, error: "Please use the form at /redeem." }, { status: 410 });
}
