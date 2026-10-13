// POST /api/custom-request — the /custom form (lib/custom-request-server.ts).
import { NextRequest, NextResponse, after } from "next/server";
import { handleCustomRequest, inputFromForm, type UploadIn } from "@/lib/custom-request-server";
import { clientIp, createRateLimiter } from "@/lib/subscribers";
import { dataDir } from "@/lib/orders/store";
import { sendEmail } from "@/lib/orders/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 3 requests per 10 minutes per visitor (salted in-memory IP hash; no IP stored).
const allow = createRateLimiter({ limit: 3, windowMs: 10 * 60 * 1000 });

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : null;
  };
  const f = form.get("reference");
  const file: UploadIn | null =
    f && typeof f === "object" && "arrayBuffer" in f && f.size > 0
      ? { name: f.name, type: f.type, size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) }
      : null;

  const result = await handleCustomRequest(inputFromForm(str), file, { ip: clientIp(req.headers) }, {
    dir: dataDir(),
    allow,
    now: () => new Date(),
    siteUrl: process.env.MOP_SITE_URL || "https://mopclothing.com",
    linkSecret: process.env.MOP_LINK_SECRET || undefined,
    // the PingPigeon helper the order emails use (it retries once)
    notify: (subject, body) =>
      sendEmail(
        { subject, body, html: "" },
        {
          env: process.env,
          fetch: (u, i) => fetch(u, i),
          // the email holds the customer's details: never echo it (ORDER_DRY_RUN would print it)
          log: (m) => console.log(m.includes("DRY-RUN email") ? "[custom] DRY-RUN: email to John not sent (contents not logged)" : m.split("\n")[0]),
        }
      ),
    log: (m) => console.log(m),
  });
  if (result.after) after(result.after);
  return NextResponse.json(result.body, { status: result.status });
}
