// Product + picked options -> a priced, fulfilment-ready OrderItem. The checkout
// route uses it to build the Stripe session (price, metadata) and the webhook's
// fallback uses it to rebuild items from older sessions. Never trusts the
// client: every option is checked against the product, prices come from here.
import legacyProducts, {
  getDelivery,
  getProductImages,
  getTotalPrice,
  vendorDelivery,
  type Delivery,
} from "../../public/products.ts";
import { getShopProduct } from "../catalog/index.ts";
import { catalogFulfilment } from "../catalog/fulfilment.generated.ts";
import {
  findVariant,
  imageSetFor,
  imagesFor,
  normalizeSelection,
  optionNames,
  variantKey,
} from "../catalog/select.ts";
import { optionTitle, valueLabel } from "../catalog/copy.ts";
import { yoycolFor, yoycolSku } from "./yoycol-config.ts";
import type { OrderItem } from "./types.ts";

export class CheckoutError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Why a NEW checkout for this product isn't allowed (retired or coming back
 * soon), or null. The webhook never asks: orders already paid always go through.
 */
export const checkoutBlock = (productId: string): { status: number; error: string } | null => {
  const p = legacyProducts.products.find((x) => x.id === productId);
  if (p?.retired) return { status: 410, error: "no longer available" };
  if (p?.comingSoon) return { status: 409, error: p.comingSoon.message.toLowerCase() };
  return null;
};

export type PricedItem = {
  item: OrderItem;
  /** Shipping charged once on top, in cents (0 for free-shipping items). */
  shippingCents: number;
  shippingName: string;
  delivery: Delivery;
  /** Site path of the photo for this pick (a JPEG for the Printful line-up), shown in Stripe Checkout. */
  image: string;
  /** "Print: Big, Style: Grind Beanie, Color: Ivory, Size: M" */
  description: string;
};

const cents = (dollars: number) => Math.round(dollars * 100);

/** "Big · Grind Beanie · Ivory · M" */
export const itemSummary = (item: Pick<OrderItem, "opts">) =>
  Object.entries(item.opts)
    .map(([k, v]) => valueLabel(k, v))
    .join(" · ");

const describe = (opts: Record<string, string>) =>
  Object.entries(opts)
    .map(([k, v]) => `${optionTitle(k)}: ${valueLabel(k, v)}`)
    .join(", ");

export function buildItem(
  productId: string,
  rawOptions: Record<string, unknown>,
  qty = 1,
  env: Record<string, string | undefined> = process.env,
  /**
   * inFlight: the item comes from a checkout started before a legacy product was
   * superseded by a catalog product (webhook line-item fallback), so map it the
   * old way. New checkouts always get the catalog product.
   */
  { inFlight = false }: { inFlight?: boolean } = {}
): PricedItem {
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new CheckoutError("invalid quantity");

  // The older hand-written products (public/products.ts).
  const legacy = legacyProducts.products.find(
    (p) => p.id === productId && (!p.superseded || inFlight || !getShopProduct(productId))
  );
  if (legacy) {
    const opts: Record<string, string> = {};
    for (const [name, values] of Object.entries(legacy.options)) {
      const raw = rawOptions[name];
      const value = typeof raw === "string" ? values.find((v) => v === raw) : undefined;
      if (!value) throw new CheckoutError(`invalid ${name}`);
      opts[name] = value;
    }
    const item: OrderItem = {
      slug: legacy.id,
      title: legacy.title,
      supplier: "manual",
      qty,
      opts,
      // Free shipping: the item carries the whole total. Otherwise the item is the
      // price alone and shipping is charged once (shippingCents).
      unitAmount: cents(legacy.freeShippingMode ? getTotalPrice(legacy) : legacy.price),
    };
    if (legacy.vendor.platform === "yoycol") {
      const y = yoycolFor(legacy.id, env);
      if (!y || !opts.size) {
        item.manual = `Yoycol product ${legacy.vendor.productId}: no design code configured`;
      } else {
        item.supplier = "yoycol";
        item.yoycol = { designCode: y.designCode, skuCode: yoycolSku(y, opts.size) };
      }
    } else {
      item.manual = `Printful product template ${legacy.vendor.productTemplate} (no sync variant: place it by hand)`;
    }
    return {
      item,
      shippingCents: legacy.freeShippingMode ? 0 : legacy.shipping.cost,
      shippingName: legacy.shipping.name,
      delivery: getDelivery(legacy),
      image: getProductImages(legacy, opts.color)[0],
      description: describe(opts),
    };
  }

  // The generated Printful line-up (lib/catalog).
  const product = getShopProduct(productId);
  if (!product) throw new CheckoutError("invalid product");
  const sel = normalizeSelection(product, rawOptions, { fillDefaults: false });
  for (const name of optionNames(product)) {
    if (!sel[name] && product.options[name].length === 1) sel[name] = product.options[name][0];
    if (!sel[name]) throw new CheckoutError(`invalid ${name}`);
  }
  const variant = findVariant(product, sel);
  if (!variant) throw new CheckoutError("that combination isn't available");
  const ids = catalogFulfilment[product.slug]?.variants[variantKey(variant.opts)];
  // Never sell something we can't send to Printful.
  if (!ids?.syncVariantId) throw new CheckoutError("not available right now", 500);

  return {
    item: {
      slug: product.slug,
      title: product.title,
      supplier: "printful",
      qty,
      opts: { ...variant.opts },
      unitAmount: cents(variant.price),
      printful: { syncVariantId: ids.syncVariantId },
    },
    // The catalog prices include US shipping.
    shippingCents: 0,
    shippingName: "Free shipping",
    delivery: vendorDelivery[product.delivery],
    image: imageSetFor(product, sel)?.checkout ?? imagesFor(product, sel)[0],
    description: describe(variant.opts),
  };
}
