// GET /api/crew — approved, OK-to-feature owner photos for The MOP Crew (read at request time).
import { NextResponse } from "next/server";
import { crewPhotos } from "@/lib/reviews";
import { stores } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = stores();
  const photos = await crewPhotos(await s.reviews.readAll(), s.dir);
  return NextResponse.json({ photos }, { headers: { "Cache-Control": "public, max-age=60" } });
}
