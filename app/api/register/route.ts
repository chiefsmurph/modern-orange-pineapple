// POST /api/register (multipart) — register a piece, with an optional review and/or owner photo.
import { NextRequest, NextResponse, after } from "next/server";
import { handleRegister, type RegisterInput } from "@/lib/register-server";
import type { UploadIn } from "@/lib/custom-request-server";
import { clientIp } from "@/lib/subscribers";
import { allowRegister, hashUa, linkSecret, notifyJohn, siteUrl, stores } from "@/lib/register-deps";

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
  const input: RegisterInput = {
    code: str("code"),
    firstName: str("firstName"),
    email: str("email"),
    optIn: str("optIn") === "true",
    reviewOn: str("reviewOn"),
    stars: str("stars"),
    title: str("title"),
    text: str("text"),
    connection: str("connection") === "true",
    featureOk: str("featureOk") === "true",
    website: str("website"),
  };
  const s = stores();
  const rewardCode = process.env.MOP_REGISTER_REWARD_CODE?.trim();
  const ua = req.headers.get("user-agent");
  const result = await handleRegister(input, photo, clientIp(req.headers), {
    dir: s.dir,
    codes: s.codes,
    reviews: s.reviews,
    allow: allowRegister,
    now: () => new Date(),
    subscribe: (email) => s.subscribers.add({ email, ts: new Date().toISOString(), source: "register", ua_hash: hashUa(ua) }),
    notify: notifyJohn,
    log: (m) => console.log(m),
    siteUrl: siteUrl(),
    linkSecret: linkSecret(),
    reward: rewardCode ? { code: rewardCode, off: process.env.MOP_REGISTER_REWARD_OFF?.trim() || "10%" } : null,
  });
  if (result.after) after(result.after);
  return NextResponse.json(result.body, { status: result.status });
}
