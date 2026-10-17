// What the shipped email shows for each item in a box: the product name, the
// picked options ("Big · Grind Beanie · Ivory · M") and a thumbnail on
// mopclothing.com. Items come from our order record when there is one, else
// from the Printful order (its sync variant id, else the name we gave the item
// when the order was created: "Pelican Tee (Big · Grind Beanie · Ivory · M)").
import legacyProducts, { getProductImages } from "../../public/products.ts";
import { allShopProducts, getShopProductIncludingRetired } from "../catalog/index.ts";
import { catalogFulfilment } from "../catalog/fulfilment.generated.ts";
import { imageSetFor, optionNames, variantKey } from "../catalog/select.ts";
import { valueLabel } from "../catalog/copy.ts";
import { itemSummary } from "./build-items.ts";
import type { OrderItem } from "./types.ts";

export const SITE = "https://mopclothing.com";

/** The email's header logo (public/images/email/mop-logo.png, 600×361). */
export const LOGO_URL = `${SITE}/images/email/mop-logo.png`;

export type DisplayItem = {
  title: string;
  /** "Big · Grind Beanie · Ivory · M" ("" when there are none). */
  options: string;
  qty: number;
  /** Absolute https://mopclothing.com URL, when we know the product. */
  image?: string;
};

export const absoluteUrl = (p: string) => (/^https:\/\//.test(p) ? p : `${SITE}${encodeURI(p)}`);

/** The photo for a pick: the catalog's small checkout JPEG (email clients all show JPEG), else the first photo. */
export function imageFor(slug: string, opts: Record<string, string>): string | undefined {
  const product = getShopProductIncludingRetired(slug);
  if (product) {
    const set = imageSetFor(product, opts);
    const p = set?.checkout ?? set?.images[0];
    return p ? absoluteUrl(p) : undefined;
  }
  const legacy = legacyProducts.products.find((p) => p.id === slug);
  const p = legacy ? getProductImages(legacy, opts.color)?.[0] : undefined;
  return p ? absoluteUrl(p) : undefined;
}

export const displayFromRecordItem = (item: OrderItem, qty = item.qty): DisplayItem => ({
  title: item.title,
  options: itemSummary(item),
  qty,
  image: imageFor(item.slug, item.opts),
});

let bySyncVariant: Map<number, { slug: string; opts: Record<string, string> }> | undefined;

/** Printful sync variant id -> the catalog product and options (lib/catalog/fulfilment.generated.ts). */
export function catalogItemForSyncVariant(id: number) {
  if (!bySyncVariant) {
    bySyncVariant = new Map();
    for (const p of allShopProducts) {
      const ids = catalogFulfilment[p.slug]?.variants ?? {};
      for (const v of p.variants) {
        const sv = ids[variantKey(v.opts)]?.syncVariantId;
        if (sv) bySyncVariant.set(sv, { slug: p.slug, opts: { ...v.opts } });
      }
    }
  }
  return bySyncVariant.get(id);
}

/**
 * "Pelican Tee (Big · Grind Beanie · Ivory · M)" -> the product and options, when
 * the title is one of ours and every part is one of its option labels. Orders
 * placed by hand in the Printful dashboard keep whatever name they were given,
 * so the parts that don't match are simply shown as written.
 */
export function parseItemName(name: string): { title: string; options: string; slug?: string; opts?: Record<string, string> } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name.trim());
  const title = (m ? m[1] : name).trim();
  const parts = m ? m[2].split(/\s*·\s*/).filter(Boolean) : [];
  const options = parts.join(" · ");
  const product = allShopProducts.find((p) => p.title.toLowerCase() === title.toLowerCase());
  if (product) {
    const opts: Record<string, string> = {};
    for (const n of optionNames(product)) {
      const hit = product.options[n].find((v) => parts.some((part) => valueLabel(n, v, product.optionLabels).toLowerCase() === part.toLowerCase()));
      if (hit) opts[n] = hit;
    }
    return { title: product.title, options, slug: product.slug, opts };
  }
  const legacy = legacyProducts.products.find((p) => p.title.toLowerCase() === title.toLowerCase());
  if (legacy) {
    const opts: Record<string, string> = {};
    for (const [n, values] of Object.entries(legacy.options)) {
      const hit = (values ?? []).find((v) => parts.some((part) => part.toLowerCase() === v.toLowerCase()));
      if (hit) opts[n] = hit;
    }
    return { title: legacy.title, options, slug: legacy.id, opts };
  }
  return { title, options };
}

/** The subset of a Printful order line item we read (GET /orders/{id} -> result.items[]). */
export type PrintfulItemLike = {
  id?: number;
  sync_variant_id?: number | null;
  quantity?: number;
  name?: string | null;
  product?: { name?: string | null } | null;
};

/** A Printful line item for the email: our record's item if it matches, else the catalog, else its name. */
export function displayFromPrintfulItem(item: PrintfulItemLike, qty: number, recordItems: OrderItem[] = []): DisplayItem {
  const sv = Number(item.sync_variant_id);
  const mine = Number.isInteger(sv) ? recordItems.find((i) => i.printful?.syncVariantId === sv) : undefined;
  if (mine) return displayFromRecordItem(mine, qty);
  const known = Number.isInteger(sv) ? catalogItemForSyncVariant(sv) : undefined;
  if (known) {
    const product = getShopProductIncludingRetired(known.slug)!;
    return {
      title: product.title,
      options: itemSummary({ slug: known.slug, opts: known.opts }),
      qty,
      image: imageFor(known.slug, known.opts),
    };
  }
  const parsed = parseItemName(item.name || item.product?.name || "Item");
  return {
    title: parsed.title || "Item",
    options: parsed.options,
    qty,
    image: parsed.slug ? imageFor(parsed.slug, parsed.opts ?? {}) : undefined,
  };
}
