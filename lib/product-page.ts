// What the product page (app/[productId]/CatalogProductView.tsx) shows: a product
// from the generated line-up (lib/catalog), or one of the older hand-written ones
// (public/products.ts, e.g. the Yoycol Blue Sky Cotton Shorts) in the same layout.
//
// A hand-written product keeps its own checkout: "Buy now" posts to
// /api/checkout, where buildItem() prices it and maps it to Yoycol exactly as
// before. It can't go in the bag yet (lib/bag.ts and the bag checkout only know
// the line-up), so its page has "Buy now" and no "Add to bag".
import type { ShopProduct } from "./catalog/index.ts";
import { getTotalPrice, type Product } from "../public/products.ts";

export type PageProduct = Pick<
  ShopProduct,
  | "slug"
  | "title"
  | "description"
  | "fabricNote"
  | "sizeNote"
  | "printfulCatalogProductId"
  | "optionLabels"
  | "options"
  | "variants"
  | "images"
  | "credits"
> & {
  /** Key into vendorDelivery (public/products.ts). */
  delivery: Product["vendor"]["platform"];
  /** Not in the bag: the page offers "Buy now" (its own Stripe checkout) only. */
  buyNowOnly?: boolean;
};

/**
 * A hand-written product as a page product, or null when this page can't show
 * it faithfully and it keeps the older template (ProductClientView): the page
 * says "Free US shipping" (so free-shipping products only) and credits artists
 * from the line-up's credit lines (so no `design`).
 */
export function legacyPageProduct(p: Product): PageProduct | null {
  if (!p.freeShippingMode || p.design) return null;
  const options = Object.fromEntries(
    Object.entries(p.options).filter((e): e is [string, string[]] => !!e[1]?.length)
  );
  // every combination of the options, e.g. each size
  const combos = Object.keys(options).reduce<Record<string, string>[]>(
    (acc, name) => acc.flatMap((o) => options[name].map((v) => ({ ...o, [name]: v }))),
    [{}]
  );
  return {
    slug: p.id,
    title: p.title,
    description: p.description,
    fabricNote: p.fabricNote,
    sizeNote: p.sizeNote,
    options,
    // what the customer pays, as on the old page and in buildItem (free shipping: price + shipping)
    variants: combos.map((opts) => ({ opts, price: getTotalPrice(p, opts.size), status: "DECIDED" })),
    images: Array.isArray(p.images)
      ? [{ when: {}, images: p.images }]
      : Object.entries(p.images).map(([color, images]) => ({ when: { color }, images })),
    credits: [],
    delivery: p.vendor.platform,
    buyNowOnly: true,
  };
}
