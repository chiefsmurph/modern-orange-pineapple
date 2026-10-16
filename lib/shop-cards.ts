// Home-page cards for both kinds of product: the generated Printful line-up
// (lib/catalog) first, then the older hand-written products (public/products.ts),
// except an older one with a `rank`, which sits among the generated ones.
import legacy, {
  getDelivery,
  getPriceLabel,
  getProductImages,
  vendorDelivery,
  type Product,
} from "../public/products.ts";
import { shopProducts, type ShopProduct } from "./catalog/index.ts";
import { imageSetFor, imagesFor, normalizeSelection, optionNames, priceLabel, syncedQuery } from "./catalog/select.ts";
import { featured, shortName, valueLabel } from "./catalog/copy.ts";
import { featuredCardImages } from "./catalog/featured.generated.ts";
import { getShopProduct } from "./catalog/index.ts";

export type ShopCard = {
  href: string;
  title: string;
  /** The name on phones (two cards per row): lib/catalog/copy.ts shortNames, else the title. */
  shortTitle: string;
  image: string;
  price: string;
  freeShipping: boolean;
  delivery: string;
  fabricNote?: string;
  /** Home-page section (catalog `group`); unset = the main grid. */
  group?: string;
  /** A small row of choices to show on the card (the Sky Tee's skies). */
  swatches?: { src: string; label: string }[];
};

export const legacyCard = (product: Product): ShopCard => ({
  href: `/${product.id}`,
  title: product.title,
  shortTitle: shortName(product.id, product.title),
  image: getProductImages(product)[0],
  price: getPriceLabel(product),
  freeShipping: !!product.freeShippingMode,
  delivery: getDelivery(product).text,
  fabricNote: product.fabricNote,
});

export const catalogCard = (product: ShopProduct): ShopCard => ({
  href: `/${product.slug}`,
  title: product.title,
  shortTitle: shortName(product.slug, product.title),
  image: product.card ?? imagesFor(product, normalizeSelection(product))[0],
  price: priceLabel(product),
  // The catalog prices include US shipping.
  freeShipping: true,
  delivery: vendorDelivery[product.delivery].text,
  fabricNote: product.fabricNote,
  ...(product.group ? { group: product.group } : {}),
  ...(skySwatches(product).length ? { swatches: skySwatches(product) } : {}),
});

/** One swatch per sky, in picker order (products with a "sky" picker). */
export const skySwatches = (product: ShopProduct) =>
  (product.options.sky ?? []).flatMap((sky) => {
    const set = imageSetFor(product, { ...normalizeSelection(product), sky });
    return set?.swatch ? [{ src: set.swatch, label: valueLabel("sky", sky, product.optionLabels) }] : [];
  });

/**
 * Every card on sale, in home-grid order: the generated products by catalogRank,
 * with an older product that has a `rank` slotted in among them (after the
 * generated ones of the same rank); the rest of the older products last.
 */
export const shopCards = (): ShopCard[] =>
  [
    ...shopProducts.map((p) => ({ rank: p.rank, card: catalogCard(p) })),
    ...legacy.products
      .filter((p) => !p.retired && !p.comingSoon && !(p.superseded && shopProducts.some((s) => s.slug === p.id)))
      .map((p) => ({ rank: p.rank ?? Infinity, card: legacyCard(p) })),
  ]
    // a stable sort: same-rank cards keep their order, generated ones first
    .sort((a, b) => a.rank - b.rank)
    .map((c) => c.card);

/**
 * The home page's Featured cards, in lib/catalog/copy.ts `featured` order: each
 * opens its product with the featured picks and shows that photo
 * (scripts/gen-featured.mjs). Products not on sale are left out.
 */
export const featuredCards = (): ShopCard[] =>
  featured.items.flatMap((f) => {
    const p = getShopProduct(f.slug);
    if (!p) return [];
    const card = catalogCard(p);
    const query = f.pick ? syncedQuery("", optionNames(p), f.pick) : "";
    return [
      {
        ...card,
        href: `/${p.slug}${query ? `?${query}` : ""}`,
        image: featuredCardImages[f.slug] ?? card.image,
        price: priceLabel(p, f.pick ?? {}),
      },
    ];
  });

/** Everything else, in the usual order, below Featured (no repeats). */
export const restCards = (): ShopCard[] => {
  const shown = new Set(featuredCards().map((c) => c.href.split("?")[0]));
  return shopCards().filter((c) => !shown.has(c.href));
};
