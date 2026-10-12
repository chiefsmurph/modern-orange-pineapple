// Home-page cards for both kinds of product: the generated Printful line-up
// (lib/catalog) first, then the older hand-written products (public/products.ts).
import legacy, {
  getDelivery,
  getProductImages,
  getTotalPrice,
  vendorDelivery,
  type Product,
} from "@/public/products";
import { shopProducts, type ShopProduct } from "@/lib/catalog";
import { imagesFor, normalizeSelection, priceLabel } from "@/lib/catalog/select";

export type ShopCard = {
  href: string;
  title: string;
  image: string;
  price: string;
  freeShipping: boolean;
  delivery: string;
  fabricNote?: string;
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
  image: imagesFor(product, normalizeSelection(product))[0],
  price: priceLabel(product),
  // The catalog prices include US shipping.
  freeShipping: true,
  delivery: vendorDelivery[product.delivery].text,
  fabricNote: product.fabricNote,
});

export const shopCards = (): ShopCard[] => [
  ...shopProducts.map(catalogCard),
  ...legacy.products.map(legacyCard),
];
