import { notFound } from "next/navigation";
import type { Metadata } from "next";
import products, { getProductImages } from "@/public/products";
import { getShopProduct } from "@/lib/catalog";
import { normalizeSelection } from "@/lib/catalog/select";
import ProductClientView from "./ProductClientView";
import CatalogProductView from "./CatalogProductView";

type ProductPageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Superseded legacy entries are only kept for old checkouts; the catalog product
// with the same id owns the page.
const findLegacy = (id: string) =>
  products.products.find((p) => p.id === id && (!p.superseded || !getShopProduct(id)));

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { productId } = await params;
  const title = findLegacy(productId)?.title ?? getShopProduct(productId)?.title;
  return title ? { title: `${title} | Modern Orange Pineapple` } : {};
}

export default async function ProductPage({
  params,
  searchParams,
}: ProductPageProps) {
  const { productId } = await params;

  const product = findLegacy(productId);
  if (product) {
    const defaultColor = product.options.color?.[0];
    const images = getProductImages(product, defaultColor);
    return <ProductClientView product={product} defaultImages={images} />;
  }

  // The generated Printful line-up (lib/catalog). The query string can preselect
  // options (?version=small&style=beanie&color=Ivory); anything invalid is ignored.
  const shopProduct = getShopProduct(productId);
  if (!shopProduct) notFound();
  const query = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  );
  return (
    <CatalogProductView
      product={shopProduct}
      initialSelection={normalizeSelection(shopProduct, query)}
    />
  );
}
