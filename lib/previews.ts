// Private preview pages (/preview/<slug>), one per artist, store or town, sent by link only.
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
// Town exclusives for local-shop outreach (concept mockups; print after a shop says yes).
// Never print or caption "Flower Fields", "Carlsbad Ranch", "O'side", "Ruby's" (test/previews.test.ts).
// Every town design comes two ways (10/13): all-over, and a lower-priced BASIC tee (the same art as a
// chest print on a Comfort Colors 1717). No prices on these pages: the basic's wholesale isn't set yet.
const OCEANSIDE = "oceanside-9636b198";
const CARLSBAD = "carlsbad-8d9b6e95";

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
      img(MORRO, "morro-rock-back", 1000, 941, "Back of the Morro Rock tee: MOP logo and a small sea otter badge", "Morro Rock \u00b7 back"),
      img(MORRO, "otter-front", 1000, 941, "All-over tee with a sea otter floating on its back and Morro Bay, CA script", "Sea Otter \u00b7 front"),
      img(MORRO, "otter-back", 1000, 941, "Back of the sea otter tee: MOP logo and a small Morro Rock badge", "Sea Otter \u00b7 back"),
    ],
  },
  {
    slug: OCEANSIDE,
    headline: "Oceanside exclusives",
    line: "Two shirts made just for your shop, not sold online. Every design comes as an all-over, printed edge to edge on soft cotton, or a lower-priced basic tee: the same art as a chest print on a heavyweight Comfort Colors tee. Both have \u201cOceanside, CA\u201d on the front. Each all-over back has a small glimpse of the other shirt and our bunny. Early concepts.",
    gallery: [
      img(OCEANSIDE, "set", 1408, 697, "The Pelican on the Pier shirt and the Oceanside Harbor shirt side by side", "The pair", true),
      img(OCEANSIDE, "pier-versions", 1408, 697, "The Pelican on the Pier design two ways: the all-over tee and the basic Ivory tee with the same art as a round chest print, side by side", "Pelican on the Pier, two ways: all-over and basic tee", true),
      img(OCEANSIDE, "pier-front", 1000, 991, "All-over tee: the MOP pelican on a piling in front of the Oceanside Pier at sunset, with Oceanside, CA script", "Pelican on the Pier \u00b7 all-over \u00b7 front \u00b7 concept \u00b7 pier photo: Bill Newman (public domain)"),
      img(OCEANSIDE, "pier-back", 1000, 991, "Back of the pier tee: a small harbor badge at the shoulder and the MOP bunny at the lower right", "Pelican on the Pier \u00b7 all-over \u00b7 back"),
      img(OCEANSIDE, "pier-basic-ivory", 1000, 991, "Ivory basic tee with a round chest print: the MOP pelican on its piling in front of the Oceanside Pier at sunset, with Oceanside, CA script", "Pelican on the Pier \u00b7 basic tee \u00b7 Ivory \u00b7 concept \u00b7 pier photo: Bill Newman (public domain)"),
      img(OCEANSIDE, "pier-basic-washed-denim", 1000, 991, "Washed Denim basic tee with the same round pelican-and-pier chest print", "Pelican on the Pier \u00b7 basic tee \u00b7 Washed Denim \u00b7 concept \u00b7 pier photo: Bill Newman (public domain)"),
      img(OCEANSIDE, "harbor-front", 1000, 991, "All-over tee: sailboats in Oceanside Harbor at golden hour, with Oceanside, CA script", "Harbor Sunset \u00b7 all-over \u00b7 front \u00b7 photo: U.S. Marine Corps (public domain)"),
      img(OCEANSIDE, "harbor-back", 1000, 991, "Back of the harbor tee: a small pelican badge at the shoulder and the MOP bunny at the lower right", "Harbor Sunset \u00b7 all-over \u00b7 back"),
      img(OCEANSIDE, "harbor-basic-blue-jean", 1000, 991, "Blue Jean basic tee with a round chest print: sailboats in Oceanside Harbor at golden hour, with Oceanside, CA script", "Harbor Sunset \u00b7 basic tee \u00b7 Blue Jean \u00b7 photo: U.S. Marine Corps (public domain)"),
      img(OCEANSIDE, "harbor-basic-butter", 1000, 991, "Butter basic tee with the same round harbor chest print", "Harbor Sunset \u00b7 basic tee \u00b7 Butter \u00b7 photo: U.S. Marine Corps (public domain)"),
      img(OCEANSIDE, "pier-basic-ivory-worn", 1000, 991, "The Ivory basic pier tee, worn: the round pelican-and-pier print on the chest", "Pelican on the Pier \u00b7 basic tee \u00b7 Ivory, worn \u00b7 concept \u00b7 pier photo: Bill Newman (public domain)"),
      img(OCEANSIDE, "bunny-closeup", 560, 560, "Close-up of the small MOP bunny logo, its ears rising out of the circle", "The MOP bunny, lower right on every all-over back"),
    ],
  },
  {
    slug: CARLSBAD,
    headline: "Carlsbad exclusives",
    line: "Two shirts made just for your shop, not sold online. Every design comes as an all-over, printed edge to edge on soft cotton, or a lower-priced basic tee: the same art as a chest print on a heavyweight Comfort Colors tee. Both have \u201cCarlsbad, CA\u201d on the front. Each all-over back has a small glimpse of the other shirt and our bunny. Early concepts: the egret is still being drawn.",
    gallery: [
      img(CARLSBAD, "set", 1408, 697, "The Lagoon Life shirt and the Ranunculus Hills shirt side by side", "The pair \u00b7 concept", true),
      img(CARLSBAD, "ranunculus-versions", 1408, 697, "The Ranunculus Hills design two ways: the all-over tee and the basic Butter tee with the same art as a round chest print, side by side", "Ranunculus Hills, two ways: all-over and basic tee", true),
      img(CARLSBAD, "lagoon-front", 1000, 991, "All-over tee: Agua Hedionda Lagoon at sunset with Carlsbad, CA script; a dashed outline marks where the egret will go", "Lagoon Life \u00b7 all-over \u00b7 front \u00b7 concept, egret artwork in progress \u00b7 lagoon photo: Bovlb (public domain)"),
      img(CARLSBAD, "lagoon-back", 1000, 991, "Back of the lagoon tee: a small flower-field badge at the shoulder and the MOP bunny at the lower right", "Lagoon Life \u00b7 all-over \u00b7 back"),
      img(CARLSBAD, "lagoon-basic-lagoon-blue", 1000, 991, "Lagoon Blue basic tee with a round chest print: Agua Hedionda Lagoon at sunset with Carlsbad, CA script; a dashed outline marks where the egret will go", "Lagoon Life \u00b7 basic tee \u00b7 Lagoon Blue \u00b7 concept, egret artwork in progress \u00b7 lagoon photo: Bovlb (public domain)"),
      img(CARLSBAD, "lagoon-basic-ivory", 1000, 991, "Ivory basic tee with the same round lagoon chest print and the dashed egret outline", "Lagoon Life \u00b7 basic tee \u00b7 Ivory \u00b7 concept, egret artwork in progress \u00b7 lagoon photo: Bovlb (public domain)"),
      img(CARLSBAD, "ranunculus-front", 1000, 991, "All-over tee: rows of yellow and pink ranunculus under a spring sky, with Carlsbad, CA script", "Ranunculus Hills \u00b7 all-over \u00b7 front \u00b7 photo: Stickpen (public domain)"),
      img(CARLSBAD, "ranunculus-back", 1000, 991, "Back of the ranunculus tee: a small lagoon badge at the shoulder and the MOP bunny at the lower right", "Ranunculus Hills \u00b7 all-over \u00b7 back"),
      img(CARLSBAD, "ranunculus-basic-butter", 1000, 991, "Butter basic tee with a round chest print: rows of yellow and pink ranunculus under a spring sky, with Carlsbad, CA script", "Ranunculus Hills \u00b7 basic tee \u00b7 Butter \u00b7 photo: Stickpen (public domain)"),
      img(CARLSBAD, "ranunculus-basic-blossom", 1000, 991, "Blossom pink basic tee with the same round ranunculus chest print", "Ranunculus Hills \u00b7 basic tee \u00b7 Blossom \u00b7 photo: Stickpen (public domain)"),
      img(CARLSBAD, "arch-front", 1000, 991, "All-over tee: the MOP pelican under an arched Carlsbad, CA sign at sunset over the water", "Also possible: Pelican under the Arch \u00b7 all-over \u00b7 concept"),
      img(CARLSBAD, "arch-back", 1000, 991, "Back of the arch tee: a small flower-field badge at the shoulder and the MOP bunny at the lower right", "Pelican under the Arch \u00b7 all-over \u00b7 back"),
      img(CARLSBAD, "arch-basic-washed-denim", 1000, 991, "Washed Denim basic tee with a round chest print: the MOP pelican on a piling at sunset over the water, under an arched Carlsbad, CA banner", "Pelican under the Arch \u00b7 basic tee \u00b7 Washed Denim \u00b7 concept"),
      img(CARLSBAD, "arch-basic-butter", 1000, 991, "Butter basic tee with the same round pelican-under-the-arch chest print", "Pelican under the Arch \u00b7 basic tee \u00b7 Butter \u00b7 concept"),
      img(CARLSBAD, "ranunculus-basic-butter-worn", 1000, 991, "The Butter basic ranunculus tee, worn: the round flower-row print on the chest", "Ranunculus Hills \u00b7 basic tee \u00b7 Butter, worn \u00b7 photo: Stickpen (public domain)"),
      img(CARLSBAD, "bunny-closeup", 560, 560, "Close-up of the small MOP bunny logo, its ears rising out of the circle", "The MOP bunny, lower right on every all-over back"),
    ],
  },
];

export const getPreview = (slug: string) =>
  previews.find((p) => p.slug === slug);
