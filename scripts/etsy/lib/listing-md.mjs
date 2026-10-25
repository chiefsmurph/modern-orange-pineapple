// Parses one Etsy listing file (listings/NN-*.md in the marketplace handoff) into
// plain data. The format is the one the handoff writes:
//   # NN · Name
//   **Shop section:** …
//   ## Title / ## Tags (13) / ## Description   each with a ``` fenced block
//   ## Materials / ## Price (by size) / ## Variations   one line each
//   ## Photos (upload in this order)   "Folder: `…`" then "- `file.jpg`: Colour, what"
// Prices are kept in integer cents so nothing is rounded on the way to Etsy.

export const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

const DASH = /\s*[–—-]\s*/; // en dash in the files; accept a hyphen too

/** "## Heading" → the text up to the next "## " heading (heading line excluded). */
function sections(md) {
  const out = new Map();
  let current = null;
  for (const line of md.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1];
      out.set(current, []);
    } else if (current) {
      out.get(current).push(line);
    }
  }
  return new Map([...out].map(([k, v]) => [k, v.join("\n").trim()]));
}

function section(secs, prefix) {
  for (const [k, v] of secs) if (k.toLowerCase().startsWith(prefix.toLowerCase())) return v;
  return null;
}

/** The first ``` fenced block of a section, without the fences. */
function fenced(text) {
  if (text == null) return null;
  const m = /```[^\n]*\n([\s\S]*?)\n```/.exec(text);
  return m ? m[1] : null;
}

/** "$38.27" → 3827. Throws on anything that isn't dollars and two-digit cents. */
export function parseDollars(s) {
  const m = /^\$(\d+)\.(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`price "${s}" is not like $38.27`);
  return Number(m[1]) * 100 + Number(m[2]);
}

/** "S–4XL" → ["S","M","L","XL","2XL","3XL","4XL"]; "2XL" → ["2XL"]. */
export function expandSizeRange(s) {
  const parts = s.trim().split(DASH).filter(Boolean);
  const idx = (x) => {
    const i = SIZE_ORDER.indexOf(x.toUpperCase());
    if (i < 0) throw new Error(`unknown size "${x}"`);
    return i;
  };
  if (parts.length === 1) return [SIZE_ORDER[idx(parts[0])]];
  if (parts.length !== 2) throw new Error(`bad size range "${s}"`);
  const [a, b] = [idx(parts[0]), idx(parts[1])];
  if (b < a) throw new Error(`size range "${s}" runs backwards`);
  return SIZE_ORDER.slice(a, b + 1);
}

/**
 * "S–XL $38.27 · 2XL $40.27 · 3XL $42.27 · 4XL $44.27" → { S: 3827, M: 3827, L: 3827, XL: 3827, 2XL: 4027, … }
 * Every size must appear once; every price must be non-round (last cent digit not 0).
 */
export function parsePriceBySize(line) {
  const out = {};
  for (const chunk of line.split("·").map((c) => c.trim()).filter(Boolean)) {
    const m = /^(.+?)\s+(\$\S+)$/.exec(chunk);
    if (!m) throw new Error(`price chunk "${chunk}" is not like "S–XL $38.27"`);
    const cents = parseDollars(m[2]);
    if (cents % 10 === 0) throw new Error(`price ${m[2]} ends in 0; MOP prices never do`);
    for (const size of expandSizeRange(m[1])) {
      if (size in out) throw new Error(`size ${size} priced twice in "${line}"`);
      out[size] = cents;
    }
  }
  if (!Object.keys(out).length) throw new Error(`no prices in "${line}"`);
  return out;
}

/**
 * "Primary colour: Lagoon Blue, Ivory · Size: S–4XL (price varies by size)" → { colors: [...], sizes: [...] }
 * "Size: XS, S, M, L, XL, 2XL (one price)" → { colors: [], sizes: [...] }
 */
export function parseVariations(line) {
  let colors = [];
  let sizes = null;
  for (const part of line.split("·").map((p) => p.trim()).filter(Boolean)) {
    const m = /^([^:]+):\s*(.+)$/.exec(part);
    if (!m) throw new Error(`variation "${part}" is not like "Size: S–4XL"`);
    const name = m[1].trim().toLowerCase();
    const value = m[2].replace(/\([^)]*\)/g, "").trim();
    if (/colou?r/.test(name)) {
      colors = value.split(",").map((c) => c.trim()).filter(Boolean);
    } else if (name === "size") {
      sizes = value.includes(",")
        ? value.split(",").flatMap((s) => expandSizeRange(s))
        : expandSizeRange(value);
    } else {
      throw new Error(`unsupported variation "${m[1]}"`);
    }
  }
  if (!sizes) throw new Error(`no Size in variations "${line}"`);
  return { colors, sizes };
}

/** "- `07-large-classic-black-flat.jpg`: Black, flat (1600×1600)" lines → [{ file, desc, color }] */
export function parsePhotos(text, colors) {
  const folder = /Folder:\s*`([^`]+)`/.exec(text ?? "")?.[1] ?? null;
  const photos = [];
  for (const line of (text ?? "").split("\n")) {
    const m = /^\s*-\s*`([^`]+)`\s*:\s*(.+)$/.exec(line);
    if (!m) continue;
    const desc = m[2].replace(/\s*\(\d+×\d+\)\s*$/, "").trim();
    const first = desc.split(",")[0].trim().toLowerCase();
    const color = colors.find((c) => c.toLowerCase() === first) ?? null;
    photos.push({ file: m[1], desc, color });
  }
  return { folder, photos };
}

export function parseListingMd(md) {
  const h1 = /^#\s+(\d+)\s*·\s*(.+?)\s*$/m.exec(md);
  if (!h1) throw new Error('no "# NN · Name" heading');
  const secs = sections(md);
  const field = (label) => new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`).exec(md)?.[1].trim() ?? null;

  const title = fenced(section(secs, "Title"))?.trim();
  if (!title) throw new Error("no ## Title block");
  const tagsBlock = fenced(section(secs, "Tags"));
  if (!tagsBlock) throw new Error("no ## Tags block");
  const tags = tagsBlock.split(",").map((t) => t.trim()).filter(Boolean);
  const description = fenced(section(secs, "Description"));
  if (!description) throw new Error("no ## Description block");
  const materialsLine = section(secs, "Materials");
  const materials = (materialsLine ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const priceLine = section(secs, "Price");
  if (!priceLine) throw new Error("no ## Price line");
  const variationsLine = section(secs, "Variations");
  if (!variationsLine) throw new Error("no ## Variations line");

  const pricesBySize = parsePriceBySize(priceLine.split("\n")[0]);
  const { colors, sizes } = parseVariations(variationsLine.split("\n")[0]);
  for (const s of sizes) if (!(s in pricesBySize)) throw new Error(`size ${s} has no price`);
  for (const s of Object.keys(pricesBySize)) if (!sizes.includes(s)) throw new Error(`priced size ${s} is not a variation`);
  const { folder, photos } = parsePhotos(section(secs, "Photos"), colors);

  return {
    number: Number(h1[1]),
    name: h1[2],
    status: field("Status"),
    section: field("Shop section"),
    title,
    tags,
    materials,
    description,
    pricesBySize,
    colors,
    sizes,
    photoFolder: folder,
    photos,
  };
}
