// The generated Printful line-up plus its hand-written copy (copy.ts).
import { catalogProducts } from "./products.generated.ts";
import { catalogDescription, catalogFabricNote, catalogRank } from "./copy.ts";
import type { CatalogProduct } from "./types.ts";

export type ShopProduct = CatalogProduct & {
  description: string;
  fabricNote?: string;
  /** Home-page order, lower first. */
  rank: number;
};

export const shopProducts: ShopProduct[] = catalogProducts
  .map((p) => ({
    ...p,
    description: catalogDescription(p.slug, p.printfulCatalogProductId),
    fabricNote: catalogFabricNote(p.printfulCatalogProductId),
    rank: catalogRank(p.slug),
  }))
  .sort((a, b) => a.rank - b.rank);

export const getShopProduct = (slug: string) =>
  shopProducts.find((p) => p.slug === slug);
