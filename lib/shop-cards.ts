// Home-page cards for both kinds of product: the generated Printful line-up
// (lib/catalog) first, then the older hand-written products (public/products.ts).
import legacy, {
  getDelivery,
  getProductImages,
  getTotalPrice,
  vendorDelivery,
  type Product,
} from "../public/products.ts";
import { shopProducts, type ShopProduct } from "./catalog/index.ts";
import { imageSetFor, imagesFor, normalizeSelection, priceLabel } from "./catalog/select.ts";
import { valueLabel } from "./catalog/copy.ts";

export type ShopCard = {
  href: string;
  title: string;
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
  image: getProductImages(product)[0],
  price: `$${getTotalPrice(product)}`,
  freeShipping: !!product.freeShippingMode,
  delivery: getDelivery(product).text,
  fabricNote: product.fabricNote,
});

export const catalogCard = (product: ShopProduct): ShopCard => ({
  href: `/${product.slug}`,
  title: product.title,
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

export const shopCards = (): ShopCard[] => [
  ...shopProducts.map(catalogCard),
  ...legacy.products
    .filter((p) => !p.retired && !p.comingSoon && !(p.superseded && shopProducts.some((s) => s.slug === p.id)))
    .map(legacyCard),
];
