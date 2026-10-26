// The `link` plan: clone the website's Printful design onto each Etsy listing's
// unsynced Printful variants, so Etsy orders fulfil on their own. No network here.
//
// Printful imports an Etsy listing into the Etsy store as a sync product whose
// external_id is the listing_id. An unsynced variant has no colour, size, catalog
// variant, files or options; only its name, "<Etsy title> / Lagoon Blue / 2X"
// (or "<title> / XS" for a size-only listing). For each one we find the website
// product's variant with the same catalog colour + size and copy its catalog
// variant_id, print files (by file id: Printful's file library is account-wide, so
// the website's ids work in the Etsy store) and options. No exact match, no link:
// a variant is never guessed.
import { ONE_SIZE, SIZE_ORDER } from "./listing-md.mjs";

/** "2X" (Etsy's label) → "2XL" (Printful's); "s" → "S"; "One size" → "One size"; anything else that isn't a size → null. */
export function normSize(s) {
  if (s == null) return null;
  if (/^one[\s-]*size$/i.test(String(s).trim())) return ONE_SIZE;
  let v = String(s).trim().toUpperCase();
  const etsy = /^([2-5])X$/.exec(v);
  if (etsy) v = `${etsy[1]}XL`;
  return SIZE_ORDER.includes(v) ? v : null;
}

/** Case, runs of spaces and spaces around "/" don't count: Printful's "Natural/ Black" is Etsy's "Natural/Black". */
export const normColor = (c) => String(c).trim().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").toLowerCase();

/**
 * A sync variant's colour and size: its own `color`/`size` when Printful filled them
 * (synced variants), else parsed from its name. `productName` (the Etsy title) is
 * stripped from the front so a "/" in a title can't shift the parts. A name with one
 * part that isn't a size is a colour-only (one-size) Etsy listing: "<title> / Navy".
 * → { color: "Lagoon Blue" | null, size: "2XL" | "One size" } ; throws when it can't tell.
 */
export function variantColorSize(v, productName) {
  if (v.size && normSize(v.size)) return { color: v.color || null, size: normSize(v.size) };
  const name = String(v.name ?? "");
  let rest;
  if (productName && name.startsWith(`${productName} / `)) rest = name.slice(productName.length + 3);
  else if (name.includes(" / ")) rest = name.slice(name.indexOf(" / ") + 3);
  else throw new Error(`can't read colour/size from variant name "${name}"`);
  const parts = rest.split(" / ").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1 && !normSize(parts[0])) return { color: parts[0], size: ONE_SIZE };
  const sizes = parts.filter((p) => normSize(p));
  if (sizes.length !== 1 || parts.length > 2) throw new Error(`can't read colour/size from variant name "${name}"`);
  const color = parts.find((p) => !normSize(p)) ?? null;
  return { color, size: normSize(sizes[0]) };
}

/**
 * The print files to copy: everything but Printful's generated mockups, by id, with type and position.
 * With more than one placement Printful rejects "default" (the website store's name for the
 * front print), so it goes out as "front" (listings 7 and 99 had to be linked by hand, 10/25).
 */
export function printFiles(files) {
  const prints = (files ?? []).filter((f) => f.type !== "preview");
  const multi = prints.length > 1;
  return prints
    .map((f) => {
      if (!f.id && !f.url) throw new Error(`print file "${f.filename}" (${f.type}) has neither id nor url`);
      const out = { type: multi && f.type === "default" ? "front" : f.type };
      if (f.id) out.id = f.id;
      else out.url = f.url;
      if (f.position) out.position = f.position;
      if (f.options?.length) out.options = f.options;
      return out;
    });
}

const cents = (c) => (c / 100).toFixed(2);

/** PUT /sync/variant/{id} body for one Etsy variant, cloned from website variant `src`. */
export function variantUpdate(src, priceCents) {
  const body = {
    variant_id: src.variant_id,
    files: printFiles(src.files),
    options: (src.options ?? []).map((o) => ({ id: o.id, value: o.value })),
  };
  if (priceCents != null) body.retail_price = cents(priceCents);
  return body;
}

const fileNames = (files) => (files ?? []).filter((f) => f.type !== "preview").map((f) => f.filename);
const fileIds = (files) => (files ?? []).filter((f) => f.type !== "preview").map((f) => `${f.type}:${f.id}`).sort().join(",");

/**
 * The website variant for (color, size). A size-only Etsy listing (color null) matches
 * on size alone, and only when the website product comes in exactly one colour. A
 * colour-only listing (size "One size") matches only website variants sized "One size".
 * → { src } | { problem }
 */
export function findWebsiteVariant(website, color, size) {
  const vars = website.sync_variants.filter((w) => w.synced && w.variant_id && !w.is_ignored);
  const sized = vars.filter((w) => normSize(w.size) === size);
  let hits;
  if (color == null) {
    const colors = [...new Set(vars.map((w) => w.color ?? ""))];
    if (colors.length !== 1) return { problem: `no colour on Etsy, and the website product comes in ${colors.length} colours (${colors.join(", ")})` };
    hits = sized;
  } else {
    hits = sized.filter((w) => w.color && normColor(w.color) === normColor(color));
  }
  if (hits.length === 1) {
    if (!printFiles(hits[0].files).length) return { problem: `website variant ${hits[0].id} has no print file` };
    return { src: hits[0] };
  }
  const label = color == null ? size : `${color} / ${size}`;
  if (!hits.length) return { problem: `no website variant ${label}` };
  return { problem: `${hits.length} website variants are ${label} (${hits.map((h) => h.id).join(", ")})` };
}

/**
 * The plan for one Etsy-store sync product.
 *   etsy        { sync_product, sync_variants } from the Etsy store
 *   website     { sync_product, sync_variants } from the website store
 *   pricesBySize  { S: 3827, … } from the listing file (sets retail_price; optional)
 * → { rows: [{ id, name, color, size, action, … }], toLink: [{ id, label, body, src }], problems: [...], counts }
 *   action: "link" | "synced" | "ignored" | "problem"
 * When `problems` isn't empty, nothing for this listing may be written.
 */
export function planLink(etsy, website, pricesBySize = null) {
  const productName = etsy.sync_product?.name;
  const rows = [];
  const problems = [];
  const toLink = [];
  for (const v of etsy.sync_variants) {
    const row = { id: v.id, name: v.name };
    rows.push(row);
    let cs;
    try {
      cs = variantColorSize(v, productName);
    } catch (e) {
      row.action = "problem";
      row.problem = e.message;
      problems.push(`variant ${v.id}: ${e.message}`);
      continue;
    }
    Object.assign(row, cs);
    row.label = cs.color ? `${cs.color} / ${cs.size}` : cs.size;
    const match = findWebsiteVariant(website, cs.color, cs.size);
    if (v.is_ignored) {
      row.action = "ignored";
      continue;
    }
    if (v.synced) {
      row.action = "synced";
      row.variant_id = v.variant_id;
      row.files = fileNames(v.files);
      // A synced variant is left alone; just say whether it carries the website's design.
      if (match.src && (match.src.variant_id !== v.variant_id || fileIds(match.src.files) !== fileIds(v.files))) {
        row.differs = `website has variant ${match.src.variant_id} with ${fileNames(match.src.files).join(", ")}`;
      } else if (!match.src) {
        row.differs = match.problem;
      }
      continue;
    }
    if (match.problem) {
      row.action = "problem";
      row.problem = match.problem;
      problems.push(`${row.label} (variant ${v.id}): ${match.problem}`);
      continue;
    }
    const price = pricesBySize?.[cs.size] ?? null;
    if (pricesBySize && price == null) row.note = `no ${cs.size} price in the listing file; retail_price left unset`;
    const body = variantUpdate(match.src, price);
    Object.assign(row, { action: "link", variant_id: body.variant_id, files: fileNames(match.src.files), retail_price: body.retail_price ?? null });
    toLink.push({ id: v.id, label: row.label, body, src: match.src.id });
  }
  const count = (a) => rows.filter((r) => r.action === a).length;
  return {
    rows,
    toLink,
    problems,
    counts: { total: rows.length, synced: count("synced"), link: count("link"), ignored: count("ignored"), problem: count("problem"), differs: rows.filter((r) => r.differs).length },
  };
}

// ---- orders-check ----

// Printful order statuses that wait on a person: draft (not submitted: an Etsy order
// that isn't auto-confirmed, or one with an unsynced item), failed (returned with an
// error), onhold (a problem Printful support has to clear), inreview.
export const ATTENTION_STATUSES = ["draft", "failed", "onhold", "inreview"];
const DONE_STATUSES = ["fulfilled", "canceled", "archived"];

/** Why an order needs a look ([] = it doesn't). An item with no catalog variant (and no warehouse product) is unsynced. */
export function orderAttention(o) {
  const reasons = [];
  if (ATTENTION_STATUSES.includes(o.status)) reasons.push(o.status === "onhold" ? "on hold" : o.status);
  if (!DONE_STATUSES.includes(o.status)) {
    const unsynced = (o.items ?? []).filter((i) => !i.is_ignored && !i.variant_id && !i.warehouse_product_variant_id);
    if (unsynced.length) reasons.push(`unsynced: ${unsynced.map((i) => i.name ?? i.external_variant_id ?? i.id).join("; ")}`);
  }
  return reasons;
}
