// Artist credits: who drew what.
//
// `artists` is the registry of people (plus MOP itself). `designs` lists each
// piece of artwork with an ordered list of credits; the ArtistCredit component
// renders them as "<role> by <name> · <role> by <name>".
//
// A product points at a design (public/products.ts `design`), either one for
// the whole product or one per value of an option (e.g. a "style" option:
// pelican "Classic" vs "Beanie"), so the credit follows what the
// customer has selected. A design with no credits renders nothing: never
// credit art whose artist we don't know.

export type ArtistLink = {
  /** Shown as the link text, e.g. "Instagram". */
  label: string;
  href: string;
};

export type Artist = {
  name: string;
  /** Path under /public. Without one the avatar shows the artist's initials. */
  photo?: string;
  /** Only rendered when present. */
  links?: ArtistLink[];
  /** Optional short line shown under the credit. */
  line?: string;
  /** MOP itself: credited in the text, never given an avatar. */
  house?: boolean;
};

export const artists = {
  "austin-maxwell": { name: "Austin Maxwell" },
  "sunshine-austina": { name: "Sunshine Austina" },
  "janette-garcia": { name: "Janette Garcia" },
  mop: { name: "MOP", house: true },
} satisfies Record<string, Artist>;

export type ArtistId = keyof typeof artists;

export type Credit = {
  artist: ArtistId;
  /** "Original drawing", "Colour & design", "Beanie", ... */
  role: string;
};

export type Design = {
  /** The style name, e.g. "Beanie". */
  title: string;
  /** In display order. Empty = no credit line. */
  credits: Credit[];
};

export const designs = {
  "smoking-alpaca": {
    title: "Smoking Alpaca",
    credits: [
      { artist: "austin-maxwell", role: "Original drawing" },
      { artist: "mop", role: "Colour & design" },
    ],
  },
  "original-star": {
    title: "The Original Star",
    credits: [
      { artist: "sunshine-austina", role: "Original star" },
      { artist: "mop", role: "Colour & design" },
    ],
  },
  // The pelican's own artist isn't known, so only the beanie is credited.
  "pelican-beanie": {
    title: "Beanie",
    credits: [{ artist: "janette-garcia", role: "Beanie" }],
  },
  "pelican-classic": {
    title: "Classic",
    credits: [],
  },
} satisfies Record<string, Design>;

export type DesignId = keyof typeof designs;

export const getArtist = (id: ArtistId): Artist => artists[id];

export const getDesign = (id: DesignId | undefined): Design | undefined =>
  id ? designs[id] : undefined;

/** "Original drawing by Austin Maxwell · Colour & design by MOP" */
export const creditText = (design: Design) =>
  design.credits
    .map(({ artist, role }) => `${role} by ${getArtist(artist).name}`)
    .join(" · ");

/** The people to show avatars (and links) for: every credited non-house artist, once. */
export const creditedArtists = (design: Design): Artist[] => {
  const ids = design.credits
    .map((c) => c.artist)
    .filter((id, i, all) => all.indexOf(id) === i);
  return ids.map(getArtist).filter((a) => !a.house);
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
