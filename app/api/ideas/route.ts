// POST /api/ideas {idea, name, email, agree, website} — the /ideas form (lib/ideas-server.ts).
// Nothing the visitor wrote is logged: log lines carry the idea's id only.
import { NextRequest, NextResponse, after } from "next/server";
import { handleIdea, ideaStore } from "@/lib/ideas-server";
import { clientIp, createRateLimiter } from "@/lib/subscribers";
import { dataDir } from "@/lib/orders/store";
import { sendEmail } from "@/lib/orders/notify";
import { linkSecret, siteUrl } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 3 ideas per 10 minutes per visitor (salted in-memory IP hash, as for /custom).
const allow = createRateLimiter({ limit: 3, windowMs: 10 * 60 * 1000 });

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
  const result = await handleIdea(
    { idea: s("idea"), name: s("name"), email: s("email"), agree: body.agree === true, website: s("website") },
    { ip: clientIp(req.headers) },
    {
      store: ideaStore(dataDir()),
      allow,
      now: () => new Date(),
      siteUrl: siteUrl(),
      linkSecret: linkSecret(),
      // the PingPigeon helper the order emails use (it retries once)
      notify: (subject, text) =>
        sendEmail(
          { subject, body: text, html: "" },
          {
            env: process.env,
            fetch: (u, i) => fetch(u, i),
            // the email holds the sender's details: never echo it (ORDER_DRY_RUN would print it)
            log: (m) => console.log(m.includes("DRY-RUN email") ? "[ideas] DRY-RUN: email to John not sent (contents not logged)" : m.split("\n")[0]),
          }
        ),
      log: (m) => console.log(m),
    }
  );
  if (result.after) after(result.after);
  return NextResponse.json(result.body, { status: result.status });
}
