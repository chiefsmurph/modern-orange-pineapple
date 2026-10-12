// What a product page preloads in the background, most useful first:
//   1. the current pick's other gallery photos;
//   2. the same version/style in the other colours (or the other skies): the
//      photo a click would show first (same position), then their thumbnails,
//      then their other photos;
//   3. everything else (other versions/styles), in the same order.
// With Save-Data on, only tier 1.
import { imagesFor, matchesWhen, optionNames } from "./select.ts";
import type { CatalogProduct, Selection } from "./types.ts";

export type PreloadKind = "main" | "thumb";
export type PreloadItem = { kind: PreloadKind; src: string };

export const preloadKey = ({ kind, src }: PreloadItem) => `${kind}|${src}`;

/** The option whose other values are "tier 2": colour, else sky. */
const swapOption = (product: Pick<CatalogProduct, "options">) =>
  product.options.color && product.options.color.length > 1
    ? "color"
    : product.options.sky && product.options.sky.length > 1
      ? "sky"
      : undefined;

export function preloadPlan(
  product: Pick<CatalogProduct, "options" | "images">,
  sel: Selection,
  photoIndex: number,
  { saveData = false }: { saveData?: boolean } = {}
): PreloadItem[] {
  const out: PreloadItem[] = [];
  const seen = new Set<string>();
  const add = (kind: PreloadKind, src: string | undefined) => {
    if (!src) return;
    const item = { kind, src };
    const key = preloadKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  };
  /** One photo set: the photo at the visitor's position, its thumbnails, the rest. */
  const addSet = (images: string[]) => {
    add("main", images[photoIndex] ?? images[0]);
    images.forEach((src) => add("thumb", src));
    images.forEach((src) => add("main", src));
  };

  // 1. the current pick's gallery
  const current = imagesFor(product, sel);
  current.forEach((src) => add("main", src));
  if (saveData) return out;

  // 2. the other colours / skies, same version and style
  const swap = swapOption(product);
  if (swap) {
    const values = product.options[swap];
    const at = Math.max(0, values.indexOf(sel[swap] ?? values[0]));
    const others = [...values.slice(at + 1), ...values.slice(0, at)];
    const sets = others.map((v) => imagesFor(product, { ...sel, [swap]: v }));
    sets.forEach((images) => add("main", images[photoIndex] ?? images[0]));
    sets.forEach(addSet);
  }

  // 3. everything else
  const visual = optionNames(product).filter((n) => n !== "size");
  const rest = product.images
    .filter((set) => !matchesWhen(
      Object.fromEntries(Object.entries(set.when).filter(([k]) => k !== swap)),
      Object.fromEntries(visual.map((n) => [n, sel[n]]))
    ))
    .map((set) => set.images);
  rest.forEach((images) => add("main", images[photoIndex] ?? images[0]));
  rest.forEach(addSet);
  // anything still missing (e.g. sets matched only by wildcards)
  product.images.forEach((set) => addSet(set.images));
  return out;
}
