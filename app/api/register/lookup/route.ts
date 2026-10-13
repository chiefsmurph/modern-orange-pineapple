// POST /api/register/lookup {code} — what a registration code stands for (lib/register-server.ts).
import { NextRequest, NextResponse } from "next/server";
import { lookupCode } from "@/lib/register-server";
import { clientIp } from "@/lib/subscribers";
import { allowLookup, stores } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await lookupCode(body?.code, { codes: stores().codes, allow: allowLookup }, clientIp(req.headers));
  return NextResponse.json(result, { status: result.status === "limited" ? 429 : 200 });
}
