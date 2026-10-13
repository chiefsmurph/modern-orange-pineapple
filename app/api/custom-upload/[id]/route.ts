// GET /api/custom-upload/<id>?sig=<hmac> — the reference image of a custom
// request, for John only: the link in his email carries an HMAC of the id
// (MOP_LINK_SECRET), so ids alone can't be used to fetch anyone's upload.
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { findUpload, verifyUploadSignature } from "@/lib/custom-request-server";
import { dataDir } from "@/lib/orders/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!verifyUploadSignature(id, req.nextUrl.searchParams.get("sig"), process.env.MOP_LINK_SECRET)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const found = await findUpload(dataDir(), id);
  if (!found) return new NextResponse("Not found", { status: 404 });
  const bytes = await fs.readFile(found.file);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": TYPES[found.ext] ?? "application/octet-stream",
      // HEIC doesn't show in most browsers: download it instead
      "Content-Disposition": `${found.ext === "heic" ? "attachment" : "inline"}; filename="custom-${id}.${found.ext}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
