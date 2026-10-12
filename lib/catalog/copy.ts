// Hand-written words for the generated Printful line-up: descriptions, option
// labels, fabric notes and home-page order. catalog.json carries none of this,
// so it lives here and survives re-running scripts/gen-catalog.mjs.
//
// A description is the design's intro line (matched on the slug) followed by
// the garment's details (matched on the Printful catalog product).

type Garment = { details: string; fabricNote?: string };

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
  {
    match: /dress/,
    text: () => "Dress to impress with this all-over cloud print skater dress!",
    rank: 85,
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

/** Home-page order: lower first. Generated products come before the older ones. */
export const catalogRank = (slug: string) => introFor(slug)?.rank ?? 90;

/** Picker headings. The option keys (version: large/small) stay as they are in catalog.json. */
export const optionTitles: Record<string, string> = {
  version: "Print",
  style: "Style",
  emblem: "Emblem",
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

export const valueLabel = (name: string, value: string) =>
  valueLabels[name]?.[value.toLowerCase()] ??
  (name === "color" || name === "size" ? value : capitalize(value));
