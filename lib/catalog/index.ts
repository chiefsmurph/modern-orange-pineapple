// The generated Printful line-up plus its hand-written copy (copy.ts).
import { catalogProducts } from "./products.generated.ts";
import { catalogDescription, catalogFabricNote, catalogRank, catalogSizeNote, crossLinks } from "./copy.ts";
import { isRetiredCatalog, isRetiredOption, retiredOptions } from "./retired.ts";
import { catalogProductIdsFor } from "./select.ts";
import type { CatalogProduct, Selection } from "./types.ts";

export type ShopProduct = CatalogProduct & {
  description: string;
  fabricNote?: string;
  /** One line under the size picker, e.g. fabric and fit. */
  sizeNote?: string;
  /** Home-page order, lower first. */
  rank: number;
};

/**
 * Every generated product, retired ones (retired.ts) included. Only for things
 * already sold: mapping a paid order from a checkout started before a product
 * was retired, its order email and its registration. Pages, cards, feeds, the
 * bag and new checkouts use `shopProducts`.
 */
export const allShopProducts: ShopProduct[] = catalogProducts
  .map((p) => ({
    ...p,
    description: catalogDescription(p.slug, catalogProductIdsFor(p)),
    fabricNote: catalogFabricNote(p.printfulCatalogProductId),
    sizeNote: p.sizeNote ?? catalogSizeNote(p.printfulCatalogProductId),
    rank: catalogRank(p.slug),
  }))
  .sort((a, b) => a.rank - b.rank);

/** A product without its retired option values (retired.ts) or the variants that use them. */
const withoutRetiredOptions = (p: ShopProduct): ShopProduct => {
  if (!retiredOptions[p.slug]) return p;
  const options = Object.fromEntries(
    Object.entries(p.options).map(([name, values]) => [name, values?.filter((v) => !isRetiredOption(p.slug, name, v))])
  ) as ShopProduct["options"];
  const variants = p.variants.filter((v) => !Object.entries(v.opts).some(([name, value]) => isRetiredOption(p.slug, name, value)));
  return { ...p, options, variants };
};

/** What's on sale: the generated line-up minus the retired products and retired option values. */
export const shopProducts: ShopProduct[] = allShopProducts.filter((p) => !isRetiredCatalog(p.slug)).map(withoutRetiredOptions);

export const getShopProduct = (slug: string) =>
  shopProducts.find((p) => p.slug === slug);

/** A generated product even if it's retired (see allShopProducts): for orders already paid. */
export const getShopProductIncludingRetired = (slug: string) =>
  allShopProducts.find((p) => p.slug === slug);

/**
 * The "Also as an all-over: Day" link for a product page, carrying the picks the
 * other product shares (the pelican's style), or null when there's none or the
 * other product isn't on sale.
 */
export function crossLinkFor(slug: string, sel: Selection): { text: string; href: string } | null {
  const link = crossLinks[slug];
  const target = link && getShopProduct(link.to);
  if (!target) return null;
  const qs = new URLSearchParams();
  for (const k of link.carry ?? []) {
    const v = sel[k];
    if (v && target.options[k]?.includes(v)) qs.set(k, v);
  }
  const q = qs.toString();
  return { text: link.text, href: `/${target.slug}${q ? `?${q}` : ""}` };
}
