// POST /api/bag-checkout {lines: [{id, qty}]} -> {url} of one Stripe Checkout session (lib/orders/bag-checkout.ts).
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { bagCheckout } from "@/lib/orders/bag-checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let client: Stripe | null = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key);
  return client;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  try {
    const r = await bagCheckout(body, { stripe: getStripe });
    console.log(`[bag-checkout] ${r.log}`);
    return NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    console.error(`[bag-checkout] checkout failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "Checkout didn't open. Please try again in a minute." }, { status: 502 });
  }
}
