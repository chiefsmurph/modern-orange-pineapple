// The generated Printful line-up plus its hand-written copy (copy.ts).
import { catalogProducts } from "./products.generated.ts";
import { catalogDescription, catalogFabricNote, catalogRank, catalogSizeNote, crossLinks } from "./copy.ts";
import { isRetiredCatalog } from "./retired.ts";
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
    description: catalogDescription(p.slug, p.printfulCatalogProductId),
    fabricNote: catalogFabricNote(p.printfulCatalogProductId),
    sizeNote: p.sizeNote ?? catalogSizeNote(p.printfulCatalogProductId),
    rank: catalogRank(p.slug),
  }))
  .sort((a, b) => a.rank - b.rank);

/** What's on sale: the generated line-up minus the retired products. */
export const shopProducts: ShopProduct[] = allShopProducts.filter((p) => !isRetiredCatalog(p.slug));

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
