import type { DesignId } from "@/lib/artists";

export type ProductOptions = Partial<Record<"color" | "back" | "size", string[]>>;

/**
 * Which artwork (lib/artists.ts `designs`) a product shows, for its artist
 * credit. Either one design for the whole product, or one per value of an
 * option so the credit follows the customer's pick, e.g.
 * `{ option: "style", designs: { Classic: "pelican-classic", Beanie: "pelican-beanie" } }`.
 */
export type ProductDesign =
  | DesignId
  | {
      option: string;
      designs: Record<string, DesignId>;
      /** Used before anything is selected; defaults to the option's first value. */
      fallback?: DesignId;
    };

export type Product = {
  id: string;
  title: string;
  description: string;
  options: ProductOptions;
  /** The item price in dollars, before shipping (free-shipping items show and charge price + shipping). */
  price: number;
  /**
   * Item prices (like `price`, before shipping) for the sizes that cost more;
   * a size not listed costs `price`. The page, the card ("From $…"), the
   * checkout's unitAmount and the Stripe line all follow the picked size.
   */
  sizePrices?: Partial<Record<string, number>>;
  /**
   * Home-grid position among the generated products (lib/catalog/copy.ts
   * catalogRank: lower first; a tie goes after the generated ones). Unset: after
   * all of them, in this file's order.
   */
  rank?: number;
  vendor:
    | {
        platform: "yoycol";
        productId: string;
      }
    | {
        platform: "printful";
        productTemplate: string;
      };
  images: string[] | Record<string, string[]>;
  /**
   * Per-color image set to show instead of `images` when a "back" option is
   * set to "Plain" (lib/product-page.ts): same shape as `images`, just with
   * the back-print photo(s) swapped for a plain-back mockup. A color missing
   * here keeps the regular `images` (no plain-back mockup yet).
   */
  plainBackImages?: Record<string, string[]>;
  shipping: {
    name: string;
    cost: number;
  };
  freeShippingMode?: boolean;
  /** Shown as a label on the card and product page when the item isn't 100% cotton. */
  fabricNote?: string;
  /** One line under the size picker (fabric and fit), as on the line-up's pages. */
  sizeNote?: string;
  /**
   * Retired: off the home grid, its URL redirects (next.config.ts) and new
   * checkouts are refused. It stays here so orders from checkouts started
   * before it was retired still map to a supplier and royalty.
   */
  retired?: { redirectTo: string };
  /**
   * Replaced by the generated catalog product with the SAME id (lib/catalog):
   * that one gets the page, the card and new checkouts. This entry is kept only
   * so checkouts started before the switch still map to their old supplier.
   */
  superseded?: true;
  /**
   * Temporarily off sale: off the home grid, its page says it's coming back
   * soon (no price, no buy button) and new checkouts are refused. Orders from
   * checkouts started before still go to the supplier. Delete the line to bring
   * the product back.
   */
  comingSoon?: { message: string };
  /** The artwork, for the artist credit. Leave unset when the artist isn't known. */
  design?: ProductDesign;
  /**
   * Desktop-only faint left/right ghost copies behind the page
   * (app/[productId]/CatalogProductView.tsx `Ghost`), normally the same URL
   * as the big photo (images[0]/[1]) - looks right when that's already a
   * background-removed cutout (the site's usual erasebg-transformed*.png
   * convention).
   *   - unset / true: the default above (images[0]/[1]).
   *   - false: off (a product whose own photos are a full scene/backdrop,
   *     e.g. a Yoycol mockup, where reusing them as a ghost looks wrong).
   *   - { [color]: path }: a dedicated cutout per color/images-key, used
   *     instead of images[0] (e.g. supersize-alpaca-tee's model cutouts -
   *     the gallery photo itself keeps its studio backdrop, only the ghost
   *     uses the cutout).
   */
  pageBackground?: boolean | Record<string, string>;
};

export type Delivery = {
  /** Total time to the customer (production + shipping), shown on the card and product page. */
  text: string;
  /** The same window in business days, for Stripe Checkout's delivery_estimate. */
  minBusinessDays: number;
  maxBusinessDays: number;
  /** How long making and packing takes, before it ships (the order confirmation email's timeline). */
  production: string;
};

// Per supplier: Yoycol makes each piece to order (~10–12 days) before ~8–15 days of shipping;
// Printful prints and ships from the US in about 1–2 weeks.
export const vendorDelivery: Record<Product["vendor"]["platform"], Delivery> = {
  yoycol: {
    text: "Made to order · arrives in about 3–4 weeks",
    minBusinessDays: 18,
    maxBusinessDays: 27,
    production: "about 10–12 days",
  },
  printful: {
    text: "Made to order · arrives in about 1–2 weeks",
    minBusinessDays: 5,
    maxBusinessDays: 13,
    production: "2–5 business days",
  },
};

export const getDelivery = (product: Product) =>
  vendorDelivery[product.vendor.platform];

export const getProductImages = (
  { images, options: { color: colorOptions = [] } }: Product,
  color: string | undefined = colorOptions[0]
) => (Array.isArray(images) ? images : images[color]);

/**
 * Every combination of a product's options (e.g. each size, or each
 * color x size for a multi-colour one like the Supersize Alpaca Tee), in
 * option-declaration order. Shared by the product page (lib/product-page.ts),
 * the feeds (lib/google-feed.ts) and Meta Shops checkout (lib/orders/meta-checkout.ts)
 * so a product with more than one option (not just `size`) is covered everywhere.
 */
export const legacyVariantCombos = (p: Product): Record<string, string>[] => {
  const options = Object.fromEntries(
    Object.entries(p.options).filter((e): e is [string, string[]] => !!e[1]?.length)
  );
  return Object.keys(options).reduce<Record<string, string>[]>(
    (acc, name) => acc.flatMap((o) => options[name].map((v) => ({ ...o, [name]: v }))),
    [{}]
  );
};

/** The design for the current selection (option name → chosen value). */
export const getProductDesignId = (
  product: Product,
  selected: Record<string, string | undefined> = {}
): DesignId | undefined => {
  const { design } = product;
  if (!design) return undefined;
  if (typeof design === "string") return design;
  const values = (product.options as Record<string, string[] | undefined>)[
    design.option
  ];
  const value = selected[design.option] ?? values?.[0];
  return (value && design.designs[value]) || design.fallback;
};

/** The item price for a size (before shipping): its `sizePrices` entry, else `price`. */
export const getItemPrice = ({ price, sizePrices }: Product, size?: string) =>
  (size ? sizePrices?.[size] : undefined) ?? price;

/** Price + shipping, for a size when the price depends on it (no size: the base `price`). */
export const getTotalPrice = (product: Product, size?: string) =>
  parseFloat((product.shipping.cost / 100 + getItemPrice(product, size)).toFixed(2));

/** "$45" for a picked size or a one-price product, else "From $45" (as the catalog's priceLabel). */
export const getPriceLabel = (product: Product, size?: string) => {
  if (size || !product.sizePrices) return `$${getTotalPrice(product, size)}`;
  const totals = (product.options.size ?? []).map((s) => getTotalPrice(product, s));
  const min = Math.min(getTotalPrice(product), ...totals);
  const max = Math.max(getTotalPrice(product), ...totals);
  return min === max ? `$${min}` : `From $${min}`;
};

const products: { products: Product[] } = {
  products: [
    {
      id: "clouds-in-sky-shirt",
      // Old stock sky: back when John re-saves the new design in Yoycol (2026-10-12).
      comingSoon: { message: "Coming back soon with a new sky" },
      title: "Clouds In Sky Shirt",
      description:
        "Bring the sky everywhere you go with this all‑over cloud print T‑shirt!\n\n- Fabric: 100% cotton\n- Regular fit with classic O‑neck\n- Fabric weight: 190 g/m²",
      options: {
        size: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"],
      },
      price: 28.48,
      vendor: {
        platform: "yoycol",
        productId: "ID LRVV1",
      },
      images: [
        "/images/clouds-in-sky-shirt/erasebg-transformed(3).png",
        "/images/clouds-in-sky-shirt/erasebg-transformed (2).png",

        // "/images/clouds-in-sky-shirt/erasebg-transformed.png",
        // "/images/clouds-in-sky-shirt/erasebg-transformed (5).png",

        // "/images/clouds-in-sky-shirt/0.jpeg",
        // "/images/clouds-in-sky-shirt/1.jpeg",
        // "/images/clouds-in-sky-shirt/2.jpeg",
        // "/images/clouds-in-sky-shirt/3.jpeg",
        // "/images/clouds-in-sky-shirt/4.jpeg",
        // "/images/clouds-in-sky-shirt/5.jpeg",
        // "/images/clouds-in-sky-shirt/6.jpeg",
        // "/images/clouds-in-sky-shirt/7.jpeg",
      ],
      shipping: {
        name: "Standard Shipping",
        cost: 752,
      },
      freeShippingMode: true,
    },
    {
      id: "supersize-alpaca-tee",
      // Big alpaca, collar to hem, front; rabbit logo + wordmark on the back
      // (lib/orders/yoycol-config.ts yoycolColorProducts). 3 colourways, one
      // all-over print design per colour, all on the same White AOP O-neck
      // blank (3MTXVYM32). John art-directed; original alpaca drawing by
      // Austin Maxwell (lib/artists.ts "smoking-alpaca").
      title: "Supersize Alpaca Tee",
      description:
        "The big alpaca, collar to hem. Rabbit logo and MODERN ORANGE PINEAPPLE on the back.\n\n- All-over print, 100% cotton\n- Regular fit with classic O-neck\n- Fabric weight: 190 g/m²\n- Made to order, ships in about 3-4 weeks",
      // Item price set so the displayed total (item + $7.52 shipping,
      // freeShippingMode) equals $44.76 - the same displayed price as the
      // other all-overs (John, approved launch 11/08).
      price: 37.24,
      options: {
        color: ["White", "Sky", "Black"],
        // Back print (John, approved 11/08): "Logo" (rabbit + wordmark, the
        // design pictured) or "Plain" (no back print), same price. Yoycol
        // design codes per (color, back) in lib/orders/yoycol-config.ts.
        back: ["Logo", "Plain"],
        size: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"],
      },
      vendor: {
        platform: "yoycol",
        // 3 colourways / designCodes on one SPU - see yoycolColorProducts
        // (lib/orders/yoycol-config.ts) for White/Sky/Black -> PY8DV/PY7X7/PY8EN.
        productId: "SPU 3MTXVYM32 (3 colourways)",
      },
      design: "smoking-alpaca",
      // Order: model-wearing (front, back), then the flat-lay (front, back) -
      // Yoycol regenerated the model shots 11/08 after John set them as each
      // template's default mockup (still not exposed by the Open API itself;
      // pulled via the website template endpoint instead - see
      // ~/code/_handoff/2026-11-07-big-alpaca-allover/mockups-model/).
      images: {
        White: [
          "/images/supersize-alpaca-tee/white-model-front.webp",
          "/images/supersize-alpaca-tee/white-model-back.webp",
          "/images/supersize-alpaca-tee/white-front.webp",
          "/images/supersize-alpaca-tee/white-back.webp",
        ],
        Sky: [
          "/images/supersize-alpaca-tee/sky-model-front.webp",
          "/images/supersize-alpaca-tee/sky-model-back.webp",
          "/images/supersize-alpaca-tee/sky-front.webp",
          "/images/supersize-alpaca-tee/sky-back.webp",
        ],
        Black: [
          "/images/supersize-alpaca-tee/black-model-front.webp",
          "/images/supersize-alpaca-tee/black-model-back.webp",
          "/images/supersize-alpaca-tee/black-front.webp",
          "/images/supersize-alpaca-tee/black-back.webp",
        ],
      },
      // Same 4 photos per color, but the model-back photo is the plain-back
      // mockup (Yoycol, pulled 11/08 via the website template endpoint - see
      // ~/code/_handoff/2026-11-07-big-alpaca-allover/mockups-model/). No
      // plain-back flat-lay yet, so that photo stays the Logo one.
      plainBackImages: {
        White: [
          "/images/supersize-alpaca-tee/white-model-front.webp",
          "/images/supersize-alpaca-tee/white-model-back-plain.webp",
          "/images/supersize-alpaca-tee/white-front.webp",
          "/images/supersize-alpaca-tee/white-back.webp",
        ],
        Sky: [
          "/images/supersize-alpaca-tee/sky-model-front.webp",
          "/images/supersize-alpaca-tee/sky-model-back-plain.webp",
          "/images/supersize-alpaca-tee/sky-front.webp",
          "/images/supersize-alpaca-tee/sky-back.webp",
        ],
        Black: [
          "/images/supersize-alpaca-tee/black-model-front.webp",
          "/images/supersize-alpaca-tee/black-model-back-plain.webp",
          "/images/supersize-alpaca-tee/black-front.webp",
          "/images/supersize-alpaca-tee/black-back.webp",
        ],
      },
      shipping: {
        name: "Standard Shipping",
        cost: 752,
      },
      freeShippingMode: true,
      sizeNote: "Runs small: we ship one size up from what you pick (so order your normal size).",
      // Back on (John, 11/08), per color: a transparent cut-out of the model
      // shot's FRONT photo (rembg/bria-rmbg, background removed locally; same
      // erasebg-transformed*.png convention as the rest of the site), since
      // the model photos themselves keep their studio backdrop and reusing
      // them as-is for the ghost (the default behavior) would fade in a grey
      // rectangle, not a silhouette.
      pageBackground: {
        White: "/images/supersize-alpaca-tee/white-erasebg-transformed.png",
        Sky: "/images/supersize-alpaca-tee/sky-erasebg-transformed.png",
        Black: "/images/supersize-alpaca-tee/black-erasebg-transformed.png",
      },
    },
    {
      id: "clouds-skater-dress",
      title: "All‑Over Clouds Skater Dress",
      description:
        "Dress to impress with this all‑over cloud print skater dress!\n\n- 78% polyester / 22% elastane\n- Fabric weight: 6.78 oz/yd² (230 g/m²) — may vary ±5%\n- Smooth, elastic fabric\n- Mid‑thigh flared skirt with elastic waistline\n- Overlock seams & cover‑stitch hem",
      options: {
        size: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
      },
      price: 51.01,
      vendor: {
        platform: "printful",
        productTemplate: "73677360",
      },
      images: [
        "/images/clouds-skater-dress/all-over-print-skater-dress-white-front.png",
        "/images/clouds-skater-dress/all-over-print-skater-dress-white-back.png",
        // "/images/clouds-skater-dress/erasebg-transformed(8).png",
        // "/images/clouds-skater-dress/erasebg-transformed.png",
        // "/images/clouds-skater-dress/erasebg-transformed (6).png",
        // "/images/clouds-skater-dress/erasebg-transformed (4).png",
        // "/images/clouds-skater-dress/erasebg-transformed (7).png",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-back-6817d7c9a62ed.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-back-6817d7c9a643a.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-back-6817d7c9a6395.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-back-6817d7c9a6759.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a5cd6.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a5e53.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a5f8a.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a60b4.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a656f.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-front-6817d7c9a6612.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-left-6817d7c9a64da.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-right-6817d7c9a61ef.jpg",
        // "/images/clouds-skater-dress/all-over-print-skater-dress-white-right-6817d7c9a66b8.jpg",
      ],
      shipping: {
        name: "Flat Rate",
        cost: 399,
      },
      freeShippingMode: true,
      fabricNote: "Not cotton: 78% polyester",
      // Now a real Printful sync product in catalog.json (480725889), same URL and $55 (2026-10-12).
      superseded: true,
    },
    {
      id: "pelican-beanie-t-shirt",
      title: "Pelican With Beanie T Shirt",
      description:
        "Yes, this really is the coolest Pelican you have ever met.  Wearing a beanie and with a sly, devilish grin this shirt will surely have heads turning!\n\n- Fabric: 100% cotton\n-  Taped neck and shoulders\n- Fabric weight: 170-180 g/m²",
      options: {
        size: ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"],
        color: ["Yellow", "Light Blue", "White"],
      },
      price: 22.31,
      vendor: {
        platform: "printful",
        productTemplate: "85446338",
      },
      // Every colour of this tee is the beanie pelican.
      design: "pelican-beanie",
      // Replaced by the Pelican Tee's Grind Beanie style (John, 2026-10-12).
      retired: { redirectTo: "/pelican-tee?style=beanie" },
      images: {
        Yellow: [
          "/images/pelican-beanie-t-shirt/erasebg-transformed(11).png",
          // "/images/pelican-beanie-t-shirt/daisy/il_1588xN.6686801694_cpd5.webp",
          // "/images/pelican-beanie-t-shirt/daisy/il_1588xN.6686801682_bqee.webp",
        ],
        "Light Blue": [
          "/images/pelican-beanie-t-shirt/erasebg-transformed(10).png",
          // "/images/pelican-beanie-t-shirt/light-blue/il_1588xN.6734837877_7y1l.webp",
          // "/images/pelican-beanie-t-shirt/light-blue/il_1588xN.6734837865_ht7s.webp",
        ],
        White: [
          "/images/pelican-beanie-t-shirt/erasebg-transformed(9).png",
          // "/images/pelican-beanie-t-shirt/white/il_1588xN.6686801766_2ahp.webp",
          // "/images/pelican-beanie-t-shirt/white/il_1588xN.6686801752_4apr.webp",
        ],
      },
      shipping: {
        name: "Flat Rate",
        cost: 469,
      },
      freeShippingMode: true,
    },
    {
      id: "blue-sky-cotton-shorts",
      // The original sky shorts, back on sale through Yoycol (template "Clouds Cotton
      // Shorts", lib/orders/yoycol-config.ts). John kept these over the Printful Sky
      // Shorts, which are retired in lib/catalog/retired.ts and redirect here (2026-10-16).
      title: "Blue Sky Cotton Shorts",
      description:
        "The blue sky, on soft cotton shorts.\n\n- Fabric: 100% cotton\n- Regular fit\n- Side pocket, back pocket, elastic waist\n- Fabric weight: 245 g/m²",
      // No measurements from Yoycol yet, so no Size guide: fabric and fit only.
      sizeNote: "100% cotton · true to size, size up for a longer, below-the-knee fit",
      options: {
        size: ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"],
      },
      // $45 with the 14.53 shipping (free-shipping model); 4XL $47 and 5XL $49 (John, 2026-10-20;
      // were $40 / $42 / $44 from 2026-10-16).
      // 2026-10-24 (John, "Go"): non-round, mixed endings site-wide; the shorts end in .43 →
      // $44.43 total (29.90 + 14.53 shipping), 4XL $46.43, 5XL $48.43.
      price: 29.9,
      sizePrices: { "4XL": 31.9, "5XL": 33.9 },
      // Where the Printful Sky Shorts sat in the full card list (catalog rank 2). On the
      // home page they're 3rd, among the first cards (lib/catalog/copy.ts `featured`).
      rank: 2,
      vendor: {
        platform: "yoycol",
        productId: "ID LRWGN",
      },
      images: [
        // John wearing his own pair (real photos, 2025-12-27; background cut out with Apple Vision, no generated pixels)
        // lead: cropped to the shorts (chest to knees) so cards and email thumbnails show the shorts, not a tiny figure (John 10/17)
        "/images/blue-sky-cotton-shorts/worn-front-shorts-crop-v2.webp",
        "/images/blue-sky-cotton-shorts/worn-front-v2.webp",
        "/images/blue-sky-cotton-shorts/worn-hands-in-pockets-crop.webp",
        "/images/blue-sky-cotton-shorts/worn-side-crop.webp",
        "/images/blue-sky-cotton-shorts/worn-back-crop.webp",
        "/images/blue-sky-cotton-shorts/flat-back.webp",
        "/images/blue-sky-cotton-shorts/erasebg-transformed(3).webp",
        "/images/blue-sky-cotton-shorts/erasebg-transformed (1).webp",
        "/images/blue-sky-cotton-shorts/erasebg-transformed.webp",
        "/images/blue-sky-cotton-shorts/erasebg-transformed (2).webp",

        // "/images/blue-sky-cotton-shorts/267961-7c8b62ac-0a77-4665-b3ba-88f31ad038e4.webp",
        // "/images/blue-sky-cotton-shorts/267961-044d27a7-62d2-47a2-abd2-2939d8963afe.webp",
        // "/images/blue-sky-cotton-shorts/267961-18563b72-bc8a-4dce-a9d3-ce81e047be97.webp",
        // "/images/blue-sky-cotton-shorts/267961-d3ce8cb8-61cc-40c5-bac2-d8274f65c48b.webp"
      ],
      shipping: {
        name: "Standard Shipping",
        cost: 1453,
      },
      freeShippingMode: true,
    },
  ],
};

export default products;
