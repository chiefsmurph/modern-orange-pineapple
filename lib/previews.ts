// Private preview pages (/preview/<slug>), one per artist, sent by link only.
// The slugs carry random hex so they can't be guessed; the pages are noindex,
// in no sitemap, and linked from nowhere on the site. Images live in
// public/preview/<slug>/ (WebP, ≤300 KB each).
import type { DesignId } from "./artists";
import type { SketchStep } from "@/components/SketchToShirt";

export type PreviewImage = {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  /** Spans the full gallery width. */
  wide?: boolean;
};

export type Preview = {
  slug: string;
  /** The credited design; store previews have none. */
  design?: DesignId;
  headline: string;
  line: string;
  sketch?: SketchStep[];
  gallery: PreviewImage[];
};

const img = (
  slug: string,
  name: string,
  width: number,
  height: number,
  alt: string,
  caption: string,
  wide = false
): PreviewImage => ({
  src: `/preview/${slug}/${name}.webp`,
  width,
  height,
  alt,
  caption,
  wide,
});

const step = (
  slug: string,
  name: string,
  width: number,
  height: number,
  alt: string,
  caption: string
): SketchStep => ({ src: `/preview/${slug}/${name}.webp`, width, height, alt, caption });

const ALPACA = "alpaca-79015f8f";
const STAR = "star-95c35cbf";
const BEANIE = "beanie-ad578892";
const MORRO = "morro-bay-0b7d6793";

export const previews: Preview[] = [
  {
    slug: ALPACA,
    design: "smoking-alpaca",
    headline: "Your alpaca is back",
    line: "Your drawing, coloured in and back on a shirt. Here's how it turned out.",
    sketch: [
      step(ALPACA, "sketch", 530, 830, "The original pen drawing of the alpaca in sunglasses", "The original drawing"),
      step(ALPACA, "coloured", 585, 1200, "The alpaca coloured in, with an orange jacket", "Coloured by MOP"),
    ],
    gallery: [
      img(ALPACA, "dusk-tee", 1200, 1129, "All-over tee: the alpaca on a dusk sky", "Dusk all-over tee", true),
      img(ALPACA, "tee-on-model", 1000, 1000, "Classic tee with the alpaca, worn", "Classic tee"),
      img(ALPACA, "tee-flat", 1000, 1000, "Classic tee with the alpaca, laid flat", "Classic tee, flat"),
      img(ALPACA, "navy-polo", 1000, 1000, "Navy polo with an embroidered alpaca on the chest", "Embroidered navy polo"),
      img(ALPACA, "tee-closeup", 560, 560, "Close-up of the alpaca print", "Close-up"),
    ],
  },
  {
    slug: STAR,
    design: "original-star",
    headline: "Your star is back",
    line: "The star that started MOP, coloured in and back on shirts.",
    sketch: [
      step(STAR, "sketch", 640, 640, "The original ink drawing of the star", "The original star"),
      step(STAR, "coloured", 1094, 1200, "The star coloured in yellow with turquoise stars", "Coloured by MOP"),
    ],
    gallery: [
      img(STAR, "original-2016-tee", 1000, 1000, "Red tee with the coloured star, as it first sold in 2016", "Original 2016 red tee"),
      img(STAR, "small-white-tee", 1000, 1000, "White tee with a smaller star on the chest", "Small print tee"),
      img(STAR, "midnight-tee", 1200, 1129, "All-over tee: the star on a starry night sky", "Midnight all-over tee"),
      img(STAR, "golden-hour-tee", 1200, 1129, "All-over tee: the star on a golden-hour sky", "Golden Hour all-over tee"),
      img(STAR, "phone-cases", 1400, 849, "Three phone cases with the star: black, navy and sky blue", "Phone cases", true),
      img(STAR, "art-print", 1300, 890, "Two framed prints of the star, on cream and on navy", "Framed art print"),
      img(STAR, "snapback-navy", 1000, 1000, "Navy snapback with the embroidered star", "Embroidered snapback"),
      img(STAR, "snapback-natural", 1000, 1000, "Cream and black snapback with the embroidered star", "Snapback, natural"),
      img(STAR, "snapback-closeup", 440, 440, "Close-up of the star embroidery on the navy snapback", "Embroidery close-up"),
    ],
  },
  {
    slug: BEANIE,
    design: "pelican-beanie",
    headline: "The Beanie",
    line: "The pelican, wearing your beanie.",
    gallery: [
      img(BEANIE, "day-tee", 1200, 1100, "All-over tee: the beanie pelican on a blue sky", "Day all-over tee", true),
      img(BEANIE, "tee-on-model", 1000, 1000, "Classic tee with the beanie pelican, worn", "Classic tee"),
      img(BEANIE, "crop-top", 1000, 1000, "White crop top with the beanie pelican, worn", "Crop top"),
      img(BEANIE, "tee-closeup", 560, 560, "Close-up of the pelican in the beanie", "Close-up"),
      img(BEANIE, "tee-flat", 1000, 1000, "Classic tee with the beanie pelican, laid flat", "Classic tee, flat"),
    ],
  },
  {
    slug: MORRO,
    headline: "Morro Bay exclusives",
    line: "Two shirts made just for your shop, not sold online. Printed edge to edge on soft cotton, with \u201cMorro Bay, CA\u201d on the front.",
    gallery: [
      img(MORRO, "set", 1400, 650, "The Morro Rock shirt and the sea otter shirt side by side", "The pair", true),
      img(MORRO, "morro-rock-front", 1000, 941, "All-over tee with Morro Rock at sunrise and Morro Bay, CA script", "Morro Rock \u00b7 front \u00b7 photo: Vanessa Kay (CC BY 3.0)"),
      img(MORRO, "morro-rock-back", 1000, 941, "Back of the Morro Rock tee with a round sea otter badge", "Morro Rock \u00b7 back (otter badge)"),
      img(MORRO, "otter-front", 1000, 941, "All-over tee with a sea otter floating on its back and Morro Bay, CA script", "Sea Otter \u00b7 front"),
      img(MORRO, "otter-back", 1000, 941, "Back of the sea otter tee with a round Morro Rock badge", "Sea Otter \u00b7 back (Morro Rock badge)"),
    ],
  },
];

export const getPreview = (slug: string) =>
  previews.find((p) => p.slug === slug);
