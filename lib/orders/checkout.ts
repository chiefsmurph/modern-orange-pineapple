// The Stripe Checkout Session for a cart of priced items: one item from the
// product page (app/api/checkout/route.ts) or several from a Meta Shops cart
// (app/meta-checkout/route.ts). Both build the same session, so metadata,
// royalties, item codes, shipping and the webhook work the same way for either.
import type Stripe from "stripe";
import type { PricedItem } from "./build-items.ts";
import { lineItemMetadata, sessionMetadata } from "./metadata.ts";

export const SITE_ORIGIN = "https://mopclothing.com";

// US only (John, 2026-10-12): the free-shipping prices are built on Printful's US rates.
export const SHIPPING_COUNTRIES: Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] =
  ["US"];

export type CartOptions = {
  origin?: string;
  /** A promotion code id (promo_...) to apply up front. Without one, Checkout shows "Add promotion code". */
  promotionCode?: string;
  /** Extra session metadata (e.g. where a Meta cart came from); never the mop_* keys. */
  metadata?: Record<string, string>;
  /** Site paths to come back to (default: the first item's page, ?status=success / cancel). */
  successPath?: string;
  cancelPath?: string;
};

const lineItem = (priced: PricedItem, origin: string): Stripe.Checkout.SessionCreateParams.LineItem => ({
  price_data: {
    currency: "usd",
    product_data: {
      name: priced.item.title,
      description: priced.description || undefined,
      images: [`${origin}${encodeURI(priced.image)}`],
      metadata: lineItemMetadata(priced.item),
    },
    // Free shipping: the item carries the whole total. Otherwise the item is the price alone and shipping
    // is charged once, below (it used to be in both — charged twice; 2026-10-11).
    unit_amount: priced.item.unitAmount,
  },
  quantity: priced.item.qty,
});

export function cartSessionParams(
  cart: PricedItem[],
  { origin = SITE_ORIGIN, promotionCode, metadata, successPath, cancelPath }: CartOptions = {}
): Stripe.Checkout.SessionCreateParams {
  if (!cart.length) throw new Error("empty cart");
  const first = cart[0];
  // Shipping is charged once per order: the dearest of the items' rates (the
  // catalog is all free shipping), and the slowest item sets the delivery window.
  const ship = cart.reduce((a, b) => (b.shippingCents > a.shippingCents ? b : a));
  const minDays = Math.max(...cart.map((p) => p.delivery.minBusinessDays));
  const maxDays = Math.max(...cart.map((p) => p.delivery.maxBusinessDays));
  for (const k of Object.keys(metadata ?? {}))
    if (k.startsWith("mop_item_") || ["mop_v", "mop_n", "mop_summary"].includes(k)) throw new Error(`reserved metadata key ${k}`);
  return {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: cart.map((p) => lineItem(p, origin)),
    // Everything fulfilment needs (supplier, sync variant / Yoycol design + SKU, options, qty).
    metadata: { ...sessionMetadata(cart.map((p) => p.item)), ...metadata },
    // A code from the link is applied up front; otherwise "Add promotion code" in Checkout (e.g. WELCOME10 for
    // new subscribers; the codes are made in the Stripe dashboard). Stripe allows one or the other, not both.
    ...(promotionCode ? { discounts: [{ promotion_code: promotionCode }] } : { allow_promotion_codes: true }),
    shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
    // Printful and Yoycol both want the recipient's phone (Yoycol requires it).
    phone_number_collection: { enabled: true },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: ship.shippingCents, currency: "usd" },
          display_name: ship.shippingName,
          // Same window the card and product page show (production + shipping), in business days.
          delivery_estimate: {
            minimum: { unit: "business_day", value: minDays },
            maximum: { unit: "business_day", value: maxDays },
          },
        },
      },
    ],
    success_url: `${origin}${successPath ?? `/${first.item.slug}?status=success`}`,
    cancel_url: `${origin}${cancelPath ?? `/${first.item.slug}?status=cancel`}`,
  };
}

/** The session for one item from the product page. */
export function checkoutSessionParams(priced: PricedItem, origin = SITE_ORIGIN): Stripe.Checkout.SessionCreateParams {
  return cartSessionParams([priced], { origin });
}
