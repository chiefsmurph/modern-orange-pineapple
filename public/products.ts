import type { DesignId } from "@/lib/artists";

export type ProductOptions = Partial<Record<"color" | "size", string[]>>;

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

/** "$40" for a picked size or a one-price product, else "From $40" (as the catalog's priceLabel). */
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
      // $40 with the 14.53 shipping (free-shipping model); 4XL $42 and 5XL $44 (John, 2026-10-16).
      price: 25.47,
      sizePrices: { "4XL": 27.47, "5XL": 29.47 },
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
