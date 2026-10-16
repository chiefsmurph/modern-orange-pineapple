// Retired products of the generated Printful line-up: the catalog's version of
// public/products.ts `retired`. A retired product is off the home grid, the
// feeds and the bag, its URL moves permanently to `redirectTo` (next.config.ts)
// and new checkouts are refused (410). It stays in catalog.json and the
// generated files (Printful product, images, prices), so a checkout started
// before it was retired still maps to its Printful sync variant.
//
// Hand-written, so it survives re-running scripts/gen-catalog.mjs. Delete the
// line to put the product back on sale. No imports: next.config.ts reads it.
export const retiredCatalog: Record<string, { redirectTo: string }> = {
  // The Printful Sky Shorts: John went back to the original Yoycol Blue Sky
  // Cotton Shorts instead (2026-10-16).
  "sky-shorts": { redirectTo: "/blue-sky-cotton-shorts" },
};

export const isRetiredCatalog = (slug: string) =>
  Object.prototype.hasOwnProperty.call(retiredCatalog, slug);
