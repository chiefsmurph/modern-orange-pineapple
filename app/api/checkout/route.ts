import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { buildItem, checkoutBlock, CheckoutError } from "@/lib/orders/build-items";
import { checkoutSessionParams } from "@/lib/orders/checkout";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }

  return new Stripe(key);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const { productId, ...options } = body;
  if (typeof productId !== "string")
    return NextResponse.json({ error: "invalid product" }, { status: 400 });
  // Retired / coming-back-soon products can't be bought now; orders from
  // checkouts started before still go through the webhook as usual.
  const blocked = checkoutBlock(productId, options);
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status });

  // Price, options and the supplier mapping all come from the server's own
  // product data; the client only names a product and its picks.
  let priced: ReturnType<typeof buildItem>;
  try {
    priced = buildItem(productId, options);
  } catch (err) {
    if (err instanceof CheckoutError) {
      if (err.status >= 500) console.error(`[checkout] ${productId}: ${err.message}`, options);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const sessionParams = checkoutSessionParams(priced);
  console.log(`[checkout] ${sessionParams.metadata?.mop_summary}`);

  const session = await getStripe().checkout.sessions.create(sessionParams);

  return NextResponse.json({ url: session.url });
}
