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
  // rabbit-crop-top-classic (White/Black, AS Colour 4062) merged into
  // rabbit-crop-top (now White/Black/Washed Black) as a colour pick (2026-10-30).
  "rabbit-crop-top-classic": { redirectTo: "/rabbit-crop-top?color=White" },
};

export const isRetiredCatalog = (slug: string) =>
  Object.prototype.hasOwnProperty.call(retiredCatalog, slug);

// Retired option VALUES of a product still on sale: gone from its picker, its
// card swatches, the feeds and the bag, and refused at checkout (410), while the
// generated files keep them so a checkout started before still maps to Printful
// (getShopProductIncludingRetired). A link to one opens the product's default.
// Delete a value to put it back on sale.
export const retiredOptions: Record<string, Record<string, string[]>> = {
  // Ten skies were too many that looked alike: kept one of each look (John, 2026-10-20).
  // Sunset Glow ~ Golden Hour, Mackerel Sky and Above the Clouds ~ the other dappled
  // blues, Cloud Study ~ Roman Sunset (and muddy). Later the same day John cut the two
  // weakest of the six too: Golden Hour (the Dusk alpaca keeps that sky) and Roman Sunset
  // (a painting, on a "Real skies" site). Four left: Daydream, Midnight, Aurora, Orbital Sunset.
  // That evening John swapped Midnight (its stars barely showed) for two real night skies,
  // Milky Way and Cosmic Cliffs ("Yep I like 80% too. I like all this.", 2026-10-20).
  // Five left: Daydream, Milky Way, Cosmic Cliffs, Aurora, Orbital Sunset.
  // A sixth, Last Light (the wrap-around sunset), went on after Orbital Sunset (John 2026-10-21: "let's do one").
  // John hates the Blue Jean colour on the alpaca; True Navy is its default now (2026-10-26).
  // The Printful sync variants stay (harmless), so this only takes it off sale.
  "alpaca-tee": { color: ["Blue Jean"] },
  "sky-tee": {
    sky: ["sunset-glow", "mackerel-sky", "above-the-clouds", "cloud-study", "golden-hour", "roman-sunset", "midnight"],
  },
};

export const isRetiredOption = (slug: string, name: string, value: string | undefined) =>
  value !== undefined && (retiredOptions[slug]?.[name] ?? []).some((v) => v.toLowerCase() === value.toLowerCase());
