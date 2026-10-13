// POST /api/legacy-claim/lookup {code} — can this old card code (COW-76) be claimed? (lib/legacy-claims.ts)
import { NextRequest, NextResponse } from "next/server";
import { lookupClaim } from "@/lib/legacy-claims";
import { clientIp } from "@/lib/subscribers";
import { allowClaimLookup, stores } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const s = stores();
  const result = await lookupClaim(body?.code, { dir: s.dir, claims: s.claims, allow: allowClaimLookup }, clientIp(req.headers));
  return NextResponse.json(result, { status: result.status === "limited" ? 429 : 200 });
}
