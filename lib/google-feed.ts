// Product feeds: RSS 2.0 with the g: namespace, one <item> per purchasable
// variant of the Printful line-up, grouped by product (item_group_id = slug).
//   /feeds/google.xml  Google Merchant Center (free listings)
//   /feeds/meta.xml    Meta Commerce Manager (Instagram / Facebook Shop): the same
//                      feed in Meta's spelling ("in stock") and with JPEG images
//                      only (Meta's catalog takes JPG/PNG/GIF; our extra photos are WebP).
import { shopProducts, type ShopProduct } from "./catalog/index.ts";
import { imageSetFor, imagesFor, optionNames, syncedQuery } from "./catalog/select.ts";
import { valueLabel } from "./catalog/copy.ts";
import { withoutAddedDefaults } from "./catalog/added.ts";
import legacy, { getTotalPrice } from "../public/products.ts";
import { onSaleLegacy } from "./shop-cards.ts";

/**
 * Pre-generated checkout JPEGs (scripts/gen-catalog.mjs makes these for every
 * generated product; these hand-written products get one by hand, the same
 * way: 600px wide, white-flattened, quality 80 mozjpeg) for the older
 * products (public/products.ts) that aren't covered by a generated catalog
 * product under the same slug. Only one of the three older on-sale products
 * needs this: clouds-skater-dress and pelican-beanie-t-shirt already have a
 * generated catalog product at their slug (resp. a direct replacement and the
 * Pelican Tee's beanie style), so they're already in shopProducts and this
 * file's main loop below.
 */
const LEGACY_CHECKOUT_JPEG: Record<string, string> = {
  "blue-sky-cotton-shorts": "/images/blue-sky-cotton-shorts/worn-front-shorts-crop-v2-checkout.jpg",
};

export const SITE = "https://mopclothing.com";
export const BRAND = "Modern Orange Pineapple";

const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // control characters aren't allowed in XML 1.0
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const abs = (p: string) => `${SITE}${encodeURI(p)}`;

/** Google's product taxonomy, by Printful catalog product. */
export const categoryFor = (p: Pick<ShopProduct, "printfulCatalogProductId" | "slug">) =>
  p.printfulCatalogProductId === 99
    ? "Apparel & Accessories > Clothing Accessories > Hats"
    : p.printfulCatalogProductId === 315 || /dress/.test(p.slug)
      ? "Apparel & Accessories > Clothing > Dresses"
      : p.printfulCatalogProductId === 1481 || /shorts/.test(p.slug)
        ? "Apparel & Accessories > Clothing > Shorts"
        : "Apparel & Accessories > Clothing > Shirts & Tops";

/** Crop top and dress are cut for women; everything else is unisex. */
export const genderFor = (p: Pick<ShopProduct, "printfulCatalogProductId" | "slug">) =>
  p.printfulCatalogProductId === 636 || p.printfulCatalogProductId === 315 || /crop|dress/.test(p.slug) ? "female" : "unisex";

/**
 * A stable id per variant (Google allows 50 characters). An option added to a
 * product later (lib/catalog/added.ts) is left out at its old value, so the ids
 * that existed before it (bags, Meta carts, the listings) stay the same.
 */
export const feedId = (slug: string, opts: Record<string, string>) => {
  const id = [slug, ...Object.values(withoutAddedDefaults(slug, opts))].join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (id.length <= 50) return id;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${id.slice(0, 41)}-${h.toString(36)}`.slice(0, 50);
};

const plain = (s: string) =>
  s
    .replace(/^- /gm, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\.+/g, ".")
    .replace(/:\./g, ":")
    .trim();

export type FeedFlavor = "google" | "meta";

/**
 * Campaign tags on every feed link, after the variant's picks (John, 2026-10-12), so
 * Umami shows which visits came from a listing. The product page keeps them through
 * its URL rewrite (syncedQuery). Meta can't say Facebook or Instagram in the link:
 * /meta-checkout's cart_origin and the referrer tell those apart.
 */
export const FEED_UTM: Record<FeedFlavor, string> = {
  google: "utm_source=google&utm_medium=shopping&utm_campaign=free_listings",
  meta: "utm_source=meta&utm_medium=shop&utm_campaign=catalog",
};

export function googleFeedXml(products: ShopProduct[], now = new Date(), flavor: FeedFlavor = "google"): string {
  const items: string[] = [];
  for (const p of products) {
    const names = optionNames(p);
    for (const v of p.variants) {
      const sel = { ...v.opts };
      const set = imageSetFor(p, sel);
      const images = imagesFor(p, sel);
      const hero = set?.checkout ?? images[0];
      if (!hero) continue;
      const summary = names
        .filter((n) => n !== "size")
        .map((n) => valueLabel(n, v.opts[n], p.optionLabels) + (n === "version" ? " print" : ""))
        .join(", ");
      const title = `${p.title}${summary ? ` - ${summary}` : ""}${v.opts.size ? `, size ${v.opts.size}` : ""}`.slice(0, 150);
      const query = syncedQuery("", names, sel);
      const color = v.opts.color ?? (p.group === "allover" || /dress|shorts/.test(p.slug) ? "Multicolor" : undefined);
      const extra = flavor === "meta" ? [] : images.filter((src) => src !== images[0]).slice(0, 3);
      items.push(
        [
          "<item>",
          `<g:id>${xml(feedId(p.slug, v.opts))}</g:id>`,
          `<g:item_group_id>${xml(p.slug)}</g:item_group_id>`,
          `<g:title>${xml(title)}</g:title>`,
          `<g:description>${xml(plain(p.description).slice(0, 4900))}</g:description>`,
          `<g:link>${xml(`${SITE}/${p.slug}?${[query, FEED_UTM[flavor]].filter(Boolean).join("&")}`)}</g:link>`,
          `<g:image_link>${xml(abs(hero))}</g:image_link>`,
          ...extra.map((src) => `<g:additional_image_link>${xml(abs(src))}</g:additional_image_link>`),
          `<g:price>${v.price.toFixed(2)} USD</g:price>`,
          `<g:availability>${flavor === "meta" ? "in stock" : "in_stock"}</g:availability>`,
          "<g:condition>new</g:condition>",
          `<g:brand>${xml(BRAND)}</g:brand>`,
          "<g:identifier_exists>no</g:identifier_exists>",
          `<g:google_product_category>${xml(categoryFor(p))}</g:google_product_category>`,
          color ? `<g:color>${xml(color)}</g:color>` : "",
          v.opts.size ? `<g:size>${xml(v.opts.size)}</g:size>` : "",
          `<g:gender>${genderFor(p)}</g:gender>`,
          "<g:age_group>adult</g:age_group>",
          "<g:shipping><g:country>US</g:country><g:service>Standard</g:service><g:price>0.00 USD</g:price></g:shipping>",
          "</item>",
        ]
          .filter(Boolean)
          .join("\n    ")
      );
    }
  }

  // Older hand-written products (public/products.ts) still on sale and not
  // already covered above under a generated catalog product at the same slug
  // (lib/shop-cards.ts onSaleLegacy): one size-only variant per size, or a
  // single item for a one-size product. comingSoon / retired / superseded
  // (replaced) products are left out by onSaleLegacy. Only for the real,
  // whole-site feed (products === shopProducts): a caller passing a subset,
  // like a single product for a test, gets only that product's own items.
  for (const p of products === shopProducts ? legacy.products.filter(onSaleLegacy) : []) {
    const sizes = p.options.size ?? [undefined];
    const heroPath = LEGACY_CHECKOUT_JPEG[p.id];
    const images = Array.isArray(p.images) ? p.images : Object.values(p.images)[0];
    const hero = heroPath ?? images[0];
    if (!hero) continue;
    const extra = flavor === "meta" ? [] : images.filter((src) => src !== images[0]).slice(0, 3);
    const category = /dress/.test(p.id)
      ? "Apparel & Accessories > Clothing > Dresses"
      : /shorts/.test(p.id)
        ? "Apparel & Accessories > Clothing > Shorts"
        : "Apparel & Accessories > Clothing > Shirts & Tops";
    const gender = /crop|dress/.test(p.id) ? "female" : "unisex";
    for (const size of sizes) {
      // The catalog's v.price above already includes US shipping (freeShippingMode);
      // getTotalPrice is the same all-in total for an older product.
      const price = getTotalPrice(p, size);
      const title = `${p.title}${size ? `, size ${size}` : ""}`.slice(0, 150);
      const query = size ? `size=${encodeURIComponent(size)}` : "";
      items.push(
        [
          "<item>",
          `<g:id>${xml(feedId(p.id, size ? { size } : {}))}</g:id>`,
          `<g:item_group_id>${xml(p.id)}</g:item_group_id>`,
          `<g:title>${xml(title)}</g:title>`,
          `<g:description>${xml(plain(p.description).slice(0, 4900))}</g:description>`,
          `<g:link>${xml(`${SITE}/${p.id}?${[query, FEED_UTM[flavor]].filter(Boolean).join("&")}`)}</g:link>`,
          `<g:image_link>${xml(abs(hero))}</g:image_link>`,
          ...extra.map((src) => `<g:additional_image_link>${xml(abs(src))}</g:additional_image_link>`),
          `<g:price>${price.toFixed(2)} USD</g:price>`,
          `<g:availability>${flavor === "meta" ? "in stock" : "in_stock"}</g:availability>`,
          "<g:condition>new</g:condition>",
          `<g:brand>${xml(BRAND)}</g:brand>`,
          "<g:identifier_exists>no</g:identifier_exists>",
          `<g:google_product_category>${xml(category)}</g:google_product_category>`,
          size ? `<g:size>${xml(size)}</g:size>` : "",
          `<g:gender>${gender}</g:gender>`,
          "<g:age_group>adult</g:age_group>",
          "<g:shipping><g:country>US</g:country><g:service>Standard</g:service><g:price>0.00 USD</g:price></g:shipping>",
          "</item>",
        ]
          .filter(Boolean)
          .join("\n    ")
      );
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n` +
    `<channel>\n` +
    `<title>${xml(BRAND)}</title>\n` +
    `<link>${SITE}</link>\n` +
    `<description>${xml("Art on clothing, made to order: the MOP shop.")}</description>\n` +
    `<lastBuildDate>${now.toUTCString()}</lastBuildDate>\n` +
    items.map((i) => `  ${i}`).join("\n") +
    `\n</channel>\n</rss>\n`
  );
}
