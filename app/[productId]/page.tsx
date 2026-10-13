import { notFound } from "next/navigation";
import type { Metadata } from "next";
import products, { getProductImages } from "@/public/products";
import { getShopProduct } from "@/lib/catalog";
import { normalizeSelection } from "@/lib/catalog/select";
import ProductClientView from "./ProductClientView";
import ComingSoonView from "./ComingSoonView";
import CatalogProductView from "./CatalogProductView";
import { approvedReviews, reviewStore } from "@/lib/reviews";
import { dataDir } from "@/lib/orders/store";
import { SITE_DESCRIPTION, productShareMeta, shareMeta } from "@/lib/share-meta";

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
  const legacy = findLegacy(productId);
  if (legacy)
    return {
      title: `${legacy.title} | Modern Orange Pineapple`,
      ...shareMeta({ title: legacy.title, description: SITE_DESCRIPTION, path: `/${legacy.id}` }),
    };
  const product = getShopProduct(productId);
  if (!product) return {};
  // Link preview: the product photo, "<name> · $<price>", the copy's first sentence.
  const share = productShareMeta(product);
  return {
    title: `${product.title} | Modern Orange Pineapple`,
    description: share.openGraph?.description,
    ...share,
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: ProductPageProps) {
  const { productId } = await params;

  const product = findLegacy(productId);
  if (product?.comingSoon) return <ComingSoonView product={product} />;
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
  // Approved reviews, read at request time (no rebuild when John approves one).
  const reviews = await reviewStore(dataDir())
    .readAll()
    .then((all) => approvedReviews(all, shopProduct.slug))
    .catch(() => null);
  return (
    <CatalogProductView
      product={shopProduct}
      initialSelection={normalizeSelection(shopProduct, query)}
      reviews={reviews}
    />
  );
}
