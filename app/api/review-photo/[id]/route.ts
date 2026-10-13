// GET /api/review-photo/<id>?sig=… — an owner's ORIGINAL photo, for John only (signed link in his email).
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { REVIEW_UPLOADS_DIR, verifyPhotoSignature } from "@/lib/reviews";
import { linkSecret, stores } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!verifyPhotoSignature(id, req.nextUrl.searchParams.get("sig"), linkSecret())) return new NextResponse("Not found", { status: 404 });
  const s = stores();
  const r = await s.reviews.get(id);
  if (!r?.photo) return new NextResponse("Not found", { status: 404 });
  const ext = r.photo.split(".").pop()!;
  const bytes = await fs.readFile(path.join(s.dir, REVIEW_UPLOADS_DIR, r.photo));
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Disposition": `${ext === "heic" ? "attachment" : "inline"}; filename="review-${id}.${ext}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
