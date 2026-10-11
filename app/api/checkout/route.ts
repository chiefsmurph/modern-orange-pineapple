import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import products, {
  getTotalPrice,
  getProductImages,
} from "../../../public/products";
import { p } from "framer-motion/client";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }

  return new Stripe(key);
}

const origin = "https://mopclothing.com";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const { productId, ...options } = await req.json();
  const product = products.products.find((p) => p.id === productId);
  if (!product)
    return NextResponse.json({ error: "invalid product" }, { status: 400 });

  const descriptionParts: string[] = [];
  if (options.color) descriptionParts.push(`Color: ${options.color}`);
  if (options.size) descriptionParts.push(`Size: ${options.size}`);
  const description = descriptionParts.join(", ");

  // Build absolute image URL
  const imageUrl = `${origin}${getProductImages(product, options["color"])[0]}`;

  const [min, max] = product.shipping.estDelivery.split("-").map(Number);
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: product.title,
            description,
            images: [imageUrl],
            metadata: {
              productId,
              ...options,
            },
          },
          // getTotalPrice = price + shipping. With free shipping the item carries the whole total; otherwise the item is
          // the price alone and shipping is charged once, below (it used to be in both — charged twice; 2026-10-11).
          unit_amount: Math.round(
            Number((product.freeShippingMode ? getTotalPrice(product) : product.price) * 100)
          ),
        },
        quantity: 1,
      },
    ],
    shipping_address_collection: {
      allowed_countries: [
        "US",
        "CA",
        "GB",
        "AU",
        "NZ",
        "DE",
        "FR",
        "NL",
        "SE",
        "NO",
      ],
    },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: product.freeShippingMode ? 0 : product.shipping.cost,
            currency: "usd",
          },
          display_name: product.shipping.name,
          delivery_estimate: {
            minimum: {
              unit: "business_day",
              value: min,
            },
            maximum: {
              unit: "business_day",
              value: max,
            },
          },
        },
      },
    ],
    success_url: `${origin}/${product.id}?status=success`,
    cancel_url: `${origin}/${product.id}?status=cancel`,
  };

  console.log(JSON.stringify(sessionParams, null, 2));

  const session = await stripe.checkout.sessions.create(sessionParams);

  return NextResponse.json({ url: session.url });
}
