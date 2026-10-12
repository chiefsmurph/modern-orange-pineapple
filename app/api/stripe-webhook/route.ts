// Stripe webhook: https://mopclothing.com/api/stripe-webhook
// Event: checkout.session.completed (+ checkout.session.async_payment_succeeded).
// Verifies the signature on the raw body, then records the order, creates the
// Printful draft / Yoycol unpaid order, logs royalties and emails John
// (lib/orders/process.ts). Idempotent per Checkout Session.
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyStripeEvent } from "@/lib/orders/stripe-verify";
import { handleStripeEvent } from "@/lib/orders/process";
import { dataDir, orderStore } from "@/lib/orders/store";
import type { LineItemLike } from "@/lib/orders/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only for sessions created before the mop_* metadata existed. Needs the
// restricted key's "Checkout Sessions: Read" + "Products: Read".
async function listLineItems(sessionId: string): Promise<LineItemLike[]> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await new Stripe(key).checkout.sessions.listLineItems(sessionId, {
    limit: 100,
    expand: ["data.price.product"],
  });
  return res.data as unknown as LineItemLike[];
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  let event: ReturnType<typeof verifyStripeEvent>;
  try {
    event = verifyStripeEvent(
      body,
      req.headers.get("stripe-signature"),
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[stripe-webhook] rejected: ${message.split("\n")[0]}`);
    // Missing secret is our problem (500: Stripe keeps retrying until it's set); a bad signature is the caller's.
    const status = /not set/.test(message) ? 500 : 400;
    return NextResponse.json({ error: "invalid webhook" }, { status });
  }

  const result = await handleStripeEvent(event, {
    env: process.env,
    store: orderStore(dataDir()),
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
    log: (msg) => console.log(msg),
    listLineItems,
  });
  return NextResponse.json(result.body, { status: result.status });
}
