// GET /meta-checkout — Meta Shops "checkout on another website" (lib/orders/meta-checkout.ts).
// A cart from Instagram / Facebook -> one Stripe Checkout session -> 303 to Stripe.
// Nothing left to buy -> 303 to /meta-checkout/unavailable (links to the shop).
import { NextRequest, after } from "next/server";
import Stripe from "stripe";
import { metaCheckout, metaSource } from "@/lib/orders/meta-checkout";
import { clientIp } from "@/lib/subscribers";
import { sendUmamiEvent } from "@/lib/umami-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let client: Stripe | null = null;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key);
  return client;
}

// A relative Location: right behind any proxy, whatever host the app thinks it has.
const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });

const unavailable = (slugs: string[], reason?: "error") => {
  const q = new URLSearchParams();
  if (reason) q.set("reason", reason);
  if (slugs.length) q.set("p", slugs.slice(0, 10).join(","));
  const s = q.toString();
  return seeOther(`/meta-checkout/unavailable${s ? `?${s}` : ""}`);
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const visitor = {
    userAgent: req.headers.get("user-agent"),
    ip: clientIp(req.headers),
    language: req.headers.get("accept-language"),
    referrer: req.headers.get("referer"),
  };
  // The event's page: where the cart came from (Umami reads utm_* off the URL), never the cart or the coupon.
  const src = metaSource(params);
  const eventQuery = new URLSearchParams({ cart_origin: src.origin, ...src.utm }).toString();
  const track = (name: string, data: Record<string, string | number>) =>
    after(() => sendUmamiEvent(name, data, `/meta-checkout?${eventQuery}`, visitor).then(() => undefined));

  try {
    const result = await metaCheckout(params, { stripe: getStripe });
    console.log(`[meta-checkout] ${result.log}`);
    track(result.event.name, result.event.data);
    return result.kind === "redirect" ? seeOther(result.url) : unavailable(result.slugs);
  } catch (err) {
    console.error(`[meta-checkout] checkout failed: ${err instanceof Error ? err.message : String(err)}`);
    track("meta-checkout-error", { origin: src.origin });
    return unavailable([], "error");
  }
}

// A HEAD (link checkers, previews) never makes a Checkout session.
export function HEAD() {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
