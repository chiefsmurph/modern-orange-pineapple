// Hand-written words for the generated Printful line-up: descriptions, option
// labels, fabric notes and home-page order. catalog.json carries none of this,
// so it lives here and survives re-running scripts/gen-catalog.mjs.
//
// A description is the design's intro line (matched on the slug) followed by
// the garment's details (matched on the Printful catalog product).

type Garment = {
  details: string;
  /** Pill under the price (the site flags anything that isn't 100% cotton). */
  fabricNote?: string;
  /** One line under the size picker. */
  sizeNote?: string;
};

/** Garment details per Printful catalog product id (from Printful's catalog). */
const garments: Record<number, Garment> = {
  // Comfort Colors 1717
  586: {
    details:
      "- Comfort Colors 1717 heavyweight tee\n- Fabric: 100% ring-spun cotton, garment-dyed\n- Fabric weight: 6.1 oz/yd² (206.8 g/m²)\n- Relaxed fit\n- Twill-taped neck and shoulders",
  },
  // AS Colour 4062
  636: {
    details:
      "- Fabric: 100% combed cotton\n- Fabric weight: 5.3 oz/yd² (180 g/m²)\n- Relaxed fit, cropped length, dropped shoulders\n- Ribbed crew neck",
  },
  // SOL'S 11362 Premium Piqué
  810: {
    details:
      "- Embroidered on the left chest\n- Fabric: 100% combed ring-spun cotton piqué\n- Fabric weight: 6.2 oz/yd² (210 g/m²)\n- Classic fit, ribbed collar, 3-button placket\n- Straight hem with side slits",
  },
  // All-Over Print Men's Cotton Crew Neck T-Shirt (the Premium all-over line)
  1414: {
    details:
      "- Printed edge to edge: front, back and both sleeves\n- Fabric: 96% cotton, 4% elastane\n- Midweight: 5.6 oz/yd² (189 g/m²)\n- Slight stretch, keeps its shape",
    sizeNote: "96% cotton, 4% elastane · runs slim — size up",
  },
  // All-Over Print Unisex Cotton Shorts (the Sky Shorts)
  1481: {
    details:
      "- Printed edge to edge, front and back\n- Fabric: 95% cotton, 5% elastane\n- Heavyweight: 8.85 oz/yd² (300 g/m²), medium-soft with a little stretch\n- Elastic waistband, side pockets\n- Short 2⅝″ inseam, unisex fit",
    sizeNote: "95% cotton, 5% elastane · short 2⅝″ inseam",
  },
  // All-Over Print Skater Dress (US fulfilment)
  315: {
    details:
      "- 78% polyester, 22% elastane\n- Fabric weight: 8.56 oz/yd² (290 g/m²)\n- Smooth, elastic fabric\n- Mid-thigh flared skirt with elastic waistline\n- Overlock seams & cover-stitch hem",
    fabricNote: "Not cotton: 78% polyester",
  },
  // Yupoong 6089M
  99: {
    details:
      "- Embroidered on the front\n- 80% acrylic, 20% wool\n- Structured 6-panel, high profile, flat brim\n- Adjustable snap closure: one size fits most (21⅝″–23⅝″)",
    fabricNote: "Not cotton: 80% acrylic / 20% wool",
  },
};

/** Intro line per design, matched against the slug (first match wins). */
const intros: { match: RegExp; text: (slug: string) => string; rank: number }[] = [
  // Premium all-over (their own home section, in catalog order)
  {
    match: /^day-all-over/,
    text: () => "The pelican on a bright day sky, printed edge to edge. Pick the Classic or the Grind Beanie.",
    rank: 1,
  },
  { match: /^dusk-all-over/, text: () => "The smoking alpaca at dusk, printed edge to edge.", rank: 1 },
  { match: /^night-all-over/, text: () => "The rabbit under a night sky, printed edge to edge.", rank: 1 },
  { match: /^sky-tee/, text: () => "Pick your sky. Every one is printed edge to edge.", rank: 1 },
  { match: /stripes/, text: () => "Gold stripes, printed edge to edge.", rank: 1 },
  {
    match: /^sky-shorts/,
    text: () => "Big summer clouds on a bright day sky, printed edge to edge, with a little MOP rabbit by the left hem.",
    rank: 2,
  },
  {
    match: /dress/,
    text: () => "Dress to impress with this all-over cloud print skater dress!",
    rank: 85,
  },
  {
    match: /^star-crop/,
    text: () => "The painted star that started MOP, on a soft cotton crop top.",
    rank: 61,
  },
  {
    match: /crop/,
    text: () => "The pelican on a soft cotton crop top. Pick the Classic, or the one in the Grind Beanie.",
    rank: 60,
  },
  {
    match: /polo/,
    text: (slug) => {
      const emblem = slug.split("-")[0];
      return `The ${emblem === "star" ? "original star" : emblem}, embroidered on the left chest of a heavyweight piqué polo.`;
    },
    rank: 70,
  },
  {
    match: /snapback|hat/,
    text: () => "The original star, embroidered on a classic snapback.",
    rank: 80,
  },
  {
    match: /pelican/,
    text: () =>
      "Yes, this really is the coolest pelican you have ever met. Pick the Classic, or the Grind Beanie with a sly, devilish grin.",
    rank: 10,
  },
  {
    match: /alpaca/,
    text: () => "The smoking alpaca in his sunglasses, coloured in by MOP.",
    rank: 20,
  },
  { match: /rabbit/, text: () => "The MOP rabbit, printed big or small.", rank: 30 },
  {
    match: /star/,
    text: () => "The painted star that started MOP, back on a heavyweight tee.",
    rank: 40,
  },
  { match: /nolli/, text: () => "Mr. Buckley's Nolli, Extra Fancy.", rank: 50 },
];

const introFor = (slug: string) => intros.find((i) => i.match.test(slug));

export const catalogDescription = (slug: string, printfulCatalogProductId?: number) =>
  [introFor(slug)?.text(slug), garments[printfulCatalogProductId ?? -1]?.details]
    .filter(Boolean)
    .join("\n\n");

export const catalogFabricNote = (printfulCatalogProductId?: number) =>
  garments[printfulCatalogProductId ?? -1]?.fabricNote;

export const catalogSizeNote = (printfulCatalogProductId?: number) =>
  garments[printfulCatalogProductId ?? -1]?.sizeNote;

/**
 * Short card names for phones, where the home page shows two cards per row
 * (John, 10/13). By product slug; a product not listed shows its full name.
 * Only the phone cards use these: the product page, alt text, feeds, Stripe and
 * the share cards keep the full names.
 */
export const shortNames: Record<string, string> = {
  "day-all-over": "Day All-Over",
  "dusk-all-over": "Dusk All-Over",
  "night-all-over": "Night All-Over",
  "gold-stripes": "Gold Stripes",
  "original-star-tee": "Original Star Tee",
  "nolli-extra-fancy-tee": "Nolli Extra Fancy Tee",
  "pelican-polo": "Pelican Polo",
  "rabbit-polo": "Rabbit Polo",
  "alpaca-polo": "Alpaca Polo",
  "star-polo": "Star Polo",
};

/** The phone card's name for a product: its short name, else the full one. */
export const shortName = (slug: string, title: string) => shortNames[slug] ?? title;

/**
 * The first cards on the home grid, in this order (John, 10/16): the Sky Tee
 * first, then Day, the Blue Sky Cotton Shorts, Dusk, the Rabbit, Pelican and
 * Original Star tees. Everything else follows (catalogRank order) without
 * repeating these. Reorder freely here. (Until 10/16 these were a separate
 * "Featured" section above the grid, in John's 10/13 order.)
 *   slug   a generated product, or an older one from public/products.ts (the
 *          shorts), which shows its own first photo and takes no pick or photo
 *   pick   the card opens the product with these picks (and shows that photo)
 *   photo  "womens" / "mens": the card shows that model's photo for the pick;
 *          "flat": the flat shot (e.g. so an all-over isn't the Day model again)
 * A new pick or photo needs `npm run catalog` (it makes the card's crop);
 * reordering or removing doesn't.
 */
export type FeaturedItem = { slug: string; pick?: Record<string, string>; photo?: "womens" | "mens" | "flat" };
export const featured: { items: FeaturedItem[] } = {
  items: [
    { slug: "sky-tee", pick: { sky: "orbital-sunset" }, photo: "flat" },
    { slug: "day-all-over", pick: { style: "beanie" } },
    { slug: "blue-sky-cotton-shorts" },
    { slug: "dusk-all-over" },
    { slug: "rabbit-tee", pick: { version: "large", color: "Blossom" }, photo: "mens" },
    { slug: "pelican-tee", pick: { version: "large", style: "beanie" }, photo: "womens" },
    { slug: "original-star-tee" },
  ],
};

/**
 * "Also as an all-over" links between a character tee and its all-over. `carry`
 * passes the visitor's pick across when both have that option (the pelican's style).
 */
export const crossLinks: Record<string, { to: string; text: string; carry?: string[] }> = {
  "pelican-tee": { to: "day-all-over", text: "Also as an all-over: Day", carry: ["style"] },
  "alpaca-tee": { to: "dusk-all-over", text: "Also as an all-over: Dusk" },
  "rabbit-tee": { to: "night-all-over", text: "Also as an all-over: Night" },
};

/**
 * Home-page order: lower first. Generated products come before the older ones
 * (public/products.ts), unless an older one has its own `rank` on this scale.
 */
export const catalogRank = (slug: string) => introFor(slug)?.rank ?? 90;

/** Picker headings. The option keys (version: large/small) stay as they are in catalog.json. */
export const optionTitles: Record<string, string> = {
  version: "Print",
  style: "Style",
  emblem: "Emblem",
  sky: "Sky",
  color: "Color",
  size: "Size",
};

/** Display labels for coded option values (colours and sizes show as they are). */
const valueLabels: Record<string, Record<string, string>> = {
  version: { large: "Big", small: "Small" },
  style: { classic: "Classic", beanie: "Grind Beanie" },
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const optionTitle = (name: string) => optionTitles[name] ?? capitalize(name);

/** `labels`: the product's own labels from catalog.json (option_labels), which win. */
export const valueLabel = (
  name: string,
  value: string,
  labels?: Record<string, Record<string, string>>
) =>
  labels?.[name]?.[value] ??
  valueLabels[name]?.[value.toLowerCase()] ??
  (name === "color" || name === "size" ? value : capitalize(value));
