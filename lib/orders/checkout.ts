// The Stripe Checkout Session for one priced item (app/api/checkout/route.ts).
import type Stripe from "stripe";
import type { PricedItem } from "./build-items.ts";
import { lineItemMetadata, sessionMetadata } from "./metadata.ts";

export const SITE_ORIGIN = "https://mopclothing.com";

export const SHIPPING_COUNTRIES: Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] =
  ["US", "CA", "GB", "AU", "NZ", "DE", "FR", "NL", "SE", "NO"];

export function checkoutSessionParams(
  priced: PricedItem,
  origin = SITE_ORIGIN
): Stripe.Checkout.SessionCreateParams {
  const { item, delivery } = priced;
  return {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.title,
            description: priced.description || undefined,
            images: [`${origin}${encodeURI(priced.image)}`],
            metadata: lineItemMetadata(item),
          },
          // Free shipping: the item carries the whole total. Otherwise the item is the price alone and shipping
          // is charged once, below (it used to be in both — charged twice; 2026-10-11).
          unit_amount: item.unitAmount,
        },
        quantity: item.qty,
      },
    ],
    // Everything fulfilment needs (supplier, sync variant / Yoycol design + SKU, options, qty).
    metadata: sessionMetadata([item]),
    shipping_address_collection: { allowed_countries: SHIPPING_COUNTRIES },
    // Printful and Yoycol both want the recipient's phone (Yoycol requires it).
    phone_number_collection: { enabled: true },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: priced.shippingCents, currency: "usd" },
          display_name: priced.shippingName,
          // Same window the card and product page show (production + shipping), in business days.
          delivery_estimate: {
            minimum: { unit: "business_day", value: delivery.minBusinessDays },
            maximum: { unit: "business_day", value: delivery.maxBusinessDays },
          },
        },
      },
    ],
    success_url: `${origin}/${item.slug}?status=success`,
    cancel_url: `${origin}/${item.slug}?status=cancel`,
  };
}
