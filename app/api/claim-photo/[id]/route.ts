// GET /api/claim-photo/<id>?sig=… — the photo sent with an old card claim, for John only (signed link).
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CLAIM_UPLOADS_DIR, verifyClaimPhoto } from "@/lib/legacy-claims";
import { linkSecret, stores } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!verifyClaimPhoto(id, req.nextUrl.searchParams.get("sig"), linkSecret())) return new NextResponse("Not found", { status: 404 });
  const s = stores();
  const c = await s.claims.get(id);
  if (!c?.photo) return new NextResponse("Not found", { status: 404 });
  const ext = c.photo.split(".").pop()!;
  const bytes = await fs.readFile(path.join(s.dir, CLAIM_UPLOADS_DIR, c.photo)).catch(() => null);
  if (!bytes) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Disposition": `${ext === "heic" ? "attachment" : "inline"}; filename="claim-${id}.${ext}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
