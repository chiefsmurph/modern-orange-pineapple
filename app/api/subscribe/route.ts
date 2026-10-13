// POST /api/subscribe — "Get notified of new drops" (lib/subscribers.ts).
import { NextRequest, NextResponse, after } from "next/server";
import { clientIp, createRateLimiter, handleSubscribe, subscriberStore } from "@/lib/subscribers";
import { dataDir } from "@/lib/orders/store";
import { sendEmail } from "@/lib/orders/notify";
import { getShopProduct } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 5 tries per 10 minutes per visitor (keyed on a salted hash of the IP, in memory).
const allow = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const result = await handleSubscribe(
    body,
    { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") },
    {
      store: subscriberStore(dataDir()),
      allow,
      productExists: (slug) => !!getShopProduct(slug),
      now: () => new Date(),
      log: (m) => console.log(m),
      // shown only once John has made the promotion code in Stripe and set this
      welcomeCode: process.env.MOP_WELCOME_CODE?.trim() || undefined,
      notify: (count, source) =>
        sendEmail(
          {
            subject: `New MOP subscriber (#${count})`,
            body: `Someone signed up for new-drop emails on mopclothing.com (${source}).\nList size: ${count}.\nExport the list on the box: node scripts/export-subscribers.mjs`,
            html: "",
          },
          { env: process.env, fetch: (u, i) => fetch(u, i), log: (m) => console.log(m) }
        ).then((r) => {
          if (!r.ok) throw new Error(r.error ?? "send failed");
        }),
    }
  );
  // John's email goes out after the response, so it never slows or fails the signup.
  if (result.after) after(result.after);
  return NextResponse.json(result.body, { status: result.status });
}
