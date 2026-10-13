// POST /api/legacy-claim (multipart: code, name, fact, contact, photo) — claim an old card code
// for John to check (lib/legacy-claims.ts). Nothing the visitor wrote is logged.
import { NextRequest, NextResponse, after } from "next/server";
import { handleClaim } from "@/lib/legacy-claims";
import type { UploadIn } from "@/lib/custom-request-server";
import { clientIp } from "@/lib/subscribers";
import { allowClaim, linkSecret, notifyJohn, siteUrl, stores } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const f = form.get("photo");
  const photo: UploadIn | null =
    f && typeof f === "object" && "arrayBuffer" in f && f.size > 0
      ? { name: f.name, type: f.type, size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) }
      : null;
  const s = stores();
  const result = await handleClaim(
    { code: str("code"), name: str("name"), fact: str("fact"), contact: str("contact"), website: str("website") },
    photo,
    clientIp(req.headers),
    {
      dir: s.dir,
      claims: s.claims,
      allow: allowClaim,
      now: () => new Date(),
      notify: notifyJohn,
      log: (m) => console.log(m),
      siteUrl: siteUrl(),
      linkSecret: linkSecret(),
    }
  );
  if (result.after) after(result.after);
  return NextResponse.json(result.body, { status: result.status });
}
