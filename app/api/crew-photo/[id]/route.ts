// GET /api/crew-photo/<id>[?size=square] — the web copy of an APPROVED, OK-to-feature owner
// photo (The MOP Crew). Anything else is a 404.
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CREW_DIR } from "@/lib/reviews";
import { stores } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{16}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const s = stores();
  const r = await s.reviews.get(id);
  if (!r || r.photo_status !== "approved" || !r.feature_ok) return new NextResponse("Not found", { status: 404 });
  const file = path.join(s.dir, CREW_DIR, req.nextUrl.searchParams.get("size") === "square" ? `${id}-sq.webp` : `${id}.webp`);
  const bytes = await fs.readFile(file).catch(() => null);
  if (!bytes) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    // short cache: hiding a photo later takes effect within the hour
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=3600" },
  });
}
