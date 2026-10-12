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
  /** A registry id, or (for a catalog credit naming someone not in the registry) the name itself. */
  artist: ArtistId | (string & {});
  /** "Original drawing", "Colour & design", "Beanie", ... */
  role: string;
};

export type Design = {
  /** The style name, e.g. "Beanie". */
  title: string;
  /** In display order. Empty = no credit line. */
  credits: Credit[];
  /** Plain credit lines shown as written, with no avatar, e.g. a CC0 photo source. */
  notes?: string[];
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

export const getArtist = (id: Credit["artist"]): Artist =>
  (artists as Record<string, Artist>)[id] ?? { name: id };

export const getDesign = (
  design: DesignId | Design | undefined
): Design | undefined =>
  !design ? undefined : typeof design === "string" ? designs[design] : design;

/**
 * A design from free-text credit lines (the Printful catalog's `credit`), e.g.
 * ["Beanie by Janette Garcia"]. "<role> by <name>" lines become credits: names
 * in the registry get their avatar and links, anyone else their initials. Any
 * other line (e.g. "Sky photo: John Robert McPherson (CC0, Wikimedia Commons)")
 * is shown exactly as written, with no avatar.
 */
export const designFromCreditLines = (lines: string[]): Design | undefined => {
  if (lines.length === 0) return undefined;
  const byName = new Map(
    Object.entries(artists as Record<string, Artist>).map(([id, a]) => [
      a.name.toLowerCase(),
      id,
    ])
  );
  const credits: Credit[] = [];
  const notes: string[] = [];
  for (const line of lines) {
    const m = /^(.*?)\s+by\s+(.+)$/i.exec(line.trim());
    if (!m) {
      notes.push(line.trim());
      continue;
    }
    const name = m[2].trim();
    credits.push({ role: m[1], artist: byName.get(name.toLowerCase()) ?? name });
  }
  return { title: "", credits, ...(notes.length ? { notes } : {}) };
};

/** "Original drawing by Austin Maxwell · Colour & design by MOP" */
export const creditText = (design: Design) =>
  [
    ...design.credits.map(({ artist, role }) =>
      role ? `${role} by ${getArtist(artist).name}` : getArtist(artist).name
    ),
    ...(design.notes ?? []),
  ].join(" · ");

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
