// Pure helpers over a CatalogProduct: picker order, the variant for a selection,
// which images and credits a selection shows, and price ranges.
// No framework imports, relative imports with extensions: the unit tests run
// these files directly under `node --test`.
import { OPTION_ORDER } from "./types.ts";
import type {
  CatalogImageSet,
  CatalogProduct,
  CatalogVariant,
  Selection,
  When,
} from "./types.ts";

const orderIndex = (name: string) => {
  const i = (OPTION_ORDER as readonly string[]).indexOf(name);
  return i === -1 ? OPTION_ORDER.length : i;
};

/** Option names in picker order (design, version, style, emblem, sky, colour, size, then any others). */
export const sortOptionNames = (names: string[]) =>
  [...names].sort((a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));

export const optionNames = (product: Pick<CatalogProduct, "options">) =>
  sortOptionNames(Object.keys(product.options));

/** Canonical key for a variant: its option values in picker order, joined by "|". */
export const variantKey = (opts: Record<string, string | undefined>) =>
  sortOptionNames(Object.keys(opts).filter((k) => opts[k] !== undefined))
    .map((k) => opts[k])
    .join("|");

/** Options that change what the garment looks like (everything except size). */
export const visualOptionNames = (product: Pick<CatalogProduct, "options">) =>
  optionNames(product).filter((n) => n !== "size");

const eq = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

/** The product's own spelling of a value (case-insensitive match), or undefined. */
export const canonicalValue = (
  product: Pick<CatalogProduct, "options">,
  name: string,
  value: string | undefined
) => product.options[name]?.find((v) => eq(v, value));

/**
 * A clean selection from untrusted input (query string, request body): only the
 * product's options, only valid values. Visual options default to their first
 * value so there is always something to show; size is left empty until picked
 * (unless there's only one).
 */
export const normalizeSelection = (
  product: Pick<CatalogProduct, "options">,
  input: Record<string, unknown> = {},
  { fillDefaults = true } = {}
): Selection => {
  const out: Selection = {};
  for (const name of optionNames(product)) {
    const raw = input[name];
    const v = typeof raw === "string" ? canonicalValue(product, name, raw) : undefined;
    const values = product.options[name];
    out[name] =
      v ??
      (fillDefaults && (name !== "size" || values.length === 1) ? values[0] : undefined);
  }
  return out;
};

export const matchesWhen = (when: When | undefined, sel: Selection) =>
  !when ||
  Object.entries(when).every(
    ([k, v]) => v === "*" || eq(sel[k], v)
  );

/** The variant for a full selection, or undefined if anything is missing or the combination doesn't exist. */
export const findVariant = (
  product: Pick<CatalogProduct, "options" | "variants">,
  sel: Selection
): CatalogVariant | undefined => {
  const names = optionNames(product);
  if (names.some((n) => !sel[n])) return undefined;
  return product.variants.find((v) => names.every((n) => eq(v.opts[n], sel[n])));
};

/** Variants compatible with a partial selection (unset options match anything). */
export const variantsMatching = (
  product: Pick<CatalogProduct, "variants">,
  sel: Selection
) =>
  product.variants.filter((v) =>
    Object.entries(sel).every(([k, val]) => val === undefined || eq(v.opts[k], val))
  );

/**
 * The Printful catalog product id for a (partial) selection: a variant's own
 * override (CatalogVariant.printfulCatalogProductId), when matching variants
 * carry one, else the product-level id. Lets one product span more than one
 * Printful catalog product (e.g. the Rabbit Crop Top's White/Black vs Washed
 * Black blanks) while most callers that pass a full variant selection still
 * get the single, unambiguous answer.
 */
export const catalogProductIdFor = (
  product: Pick<CatalogProduct, "variants" | "printfulCatalogProductId">,
  sel: Selection
): number | undefined => {
  const withOverride = variantsMatching(product, sel).find(
    (v) => v.printfulCatalogProductId !== undefined
  );
  return withOverride?.printfulCatalogProductId ?? product.printfulCatalogProductId;
};

/** Every distinct Printful catalog product id a product's variants use (product-level id when none override it). */
export const catalogProductIdsFor = (
  product: Pick<CatalogProduct, "variants" | "printfulCatalogProductId">
): number[] => {
  const ids = product.variants
    .map((v) => v.printfulCatalogProductId ?? product.printfulCatalogProductId)
    .filter((id): id is number => id !== undefined);
  return Array.from(new Set(ids));
};

/** Whether picking `name = value` (keeping the other picks) leads to a real variant. */
export const isAvailable = (
  product: Pick<CatalogProduct, "variants">,
  sel: Selection,
  name: string,
  value: string
) => variantsMatching(product, { ...sel, [name]: value }).length > 0;

export const priceRange = (
  product: Pick<CatalogProduct, "variants">,
  sel: Selection = {}
) => {
  const prices = variantsMatching(product, sel).map((v) => v.price);
  if (prices.length === 0) return undefined;
  return { min: Math.min(...prices), max: Math.max(...prices) };
};

export const formatPrice = (n: number) =>
  Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;

/** "$35", or "From $35" when sizes/styles differ. */
export const priceLabel = (
  product: Pick<CatalogProduct, "variants">,
  sel: Selection = {}
) => {
  const r = priceRange(product, sel);
  if (!r) return "";
  return r.min === r.max ? formatPrice(r.min) : `From ${formatPrice(r.min)}`;
};

/**
 * Images for a selection: the most specific image set whose `when` matches
 * (exact values beat "*"), else the first set.
 */
export const imageSetFor = (
  product: Pick<CatalogProduct, "images">,
  sel: Selection
): CatalogImageSet | undefined => {
  let best: { score: number; set: CatalogImageSet } | undefined;
  for (const set of product.images) {
    if (!matchesWhen(set.when, sel)) continue;
    const score = Object.values(set.when).filter((v) => v !== "*").length;
    if (!best || score > best.score) best = { score, set };
  }
  return best?.set ?? product.images[0];
};

export const imagesFor = (
  product: Pick<CatalogProduct, "images">,
  sel: Selection
): string[] => imageSetFor(product, sel)?.images ?? [];

/** Credit lines for a selection, in order, without duplicates. */
export const creditLinesFor = (
  product: Pick<CatalogProduct, "credits">,
  sel: Selection
) => {
  const lines: string[] = [];
  for (const c of product.credits) {
    if (!matchesWhen(c.when, sel)) continue;
    for (const l of c.lines) if (!lines.includes(l)) lines.push(l);
  }
  return lines;
};

/**
 * The photo to show after the photo set changes (another colour, print or
 * style): the same position (model, model2, flat...) if the new set has it,
 * else the first. A size change doesn't change the set, so it keeps the photo.
 */
export const keepPhotoPosition = (index: number, nextLength: number) =>
  index >= 0 && index < nextLength ? index : 0;

/**
 * The page's query string after a pick: our option keys follow the selection,
 * everything else (?ref=ig, utm_*, ...) is kept as it came, so campaign
 * attribution survives the picker rewriting the URL.
 */
export const syncedQuery = (
  search: string,
  names: string[],
  sel: Selection
): string => {
  const qs = new URLSearchParams(search);
  for (const n of names) {
    const v = sel[n];
    if (v) qs.set(n, v);
    else qs.delete(n);
  }
  return qs.toString();
};
