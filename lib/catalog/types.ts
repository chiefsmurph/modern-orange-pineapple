// Types for the Printful line-up generated from catalog.json (scripts/gen-catalog.mjs).
//
// Two generated files, both rebuilt by the script whenever catalog.json changes:
//   products.generated.ts   — what the pages and checkout need (options, prices, images, credits).
//   fulfilment.generated.ts — server-only: Printful sync variant ids and royalty rules.
// Costs from catalog.json are never copied into the repo (it's public).

/**
 * Picker order on the page. Unknown option names sort after these. `design` (the
 * Original Star Tee's Star / Bolt, John 10/21) comes first: which picture, then
 * how big it's printed, then the shirt.
 */
export const OPTION_ORDER = ["design", "version", "style", "emblem", "sky", "color", "size"] as const;

/** Option name -> chosen value. */
export type Selection = Record<string, string | undefined>;

/** A condition on the selection. A value of "*" matches anything. */
export type When = Record<string, string>;

export type CatalogVariant = {
  /** One value per option the product has, e.g. { version: "large", color: "Ivory", size: "M" }. */
  opts: Record<string, string>;
  /** Retail price the customer pays, in dollars (free-shipping model: shipping is included). */
  price: number;
  /** DECIDED, or PROPOSED until John approves it. */
  status: string;
};

export type CatalogImageSet = {
  /** Which selections these images show (missing option = any value). */
  when: When;
  /** In display order: on-model first, then flat, then anything else. */
  images: string[];
  /** A small JPEG of the first photo, for Stripe Checkout. */
  checkout?: string;
  /** Products with a "sky" picker: a small square of this sky (picker thumbnail, home card row). */
  swatch?: string;
};

export type CatalogCredit = {
  /** Shown exactly, e.g. "Beanie by Janette Garcia". */
  lines: string[];
  /** Only shown when the selection matches; always shown when absent. */
  when?: When;
};

export type CatalogProduct = {
  slug: string;
  title: string;
  supplier: "printful";
  /** Key into vendorDelivery (public/products.ts). */
  delivery: "printful";
  printfulCatalogProductId?: number;
  /** A home-page section, e.g. "allover" (Premium all-over). Unset = the main grid. */
  group?: string;
  /** Display labels for coded option values, e.g. { sky: { "golden-hour": "Golden Hour" } }. */
  optionLabels?: Record<string, Record<string, string>>;
  /** catalog.json `fabric_note`: one line under the size picker (fabric and fit). */
  sizeNote?: string;
  /** Option name -> values, in OPTION_ORDER. */
  options: Record<string, string[]>;
  variants: CatalogVariant[];
  images: CatalogImageSet[];
  /** Home-grid card image, when the hero needed cropping (a full-body shot); else the hero itself is used. */
  card?: string;
  credits: CatalogCredit[];
};

export type RoyaltyRule = {
  /** Artist key as in catalog.json (e.g. "janette"). */
  artist: string;
  /** Dollars per item sold. */
  perItem: number;
  when?: When;
};

export type FulfilmentEntry = {
  /** Canonical variant key (variantKey()) -> Printful ids. */
  variants: Record<string, { syncVariantId: number; catalogVariantId?: number }>;
  royalties: RoyaltyRule[];
};
