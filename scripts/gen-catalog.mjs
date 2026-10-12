#!/usr/bin/env node
// Generates the Printful line-up from catalog.json (written by the Printful
// product agent; schema in the Phase-1 spec). Re-run it whenever catalog.json
// changes:
//
//   node scripts/gen-catalog.mjs /path/to/catalog.json
//
// It writes
//   lib/catalog/products.generated.ts    options, prices, images, credits (pages + checkout)
//   lib/catalog/fulfilment.generated.ts  Printful sync variant ids + royalty rules (server only)
// and copies every image the catalog references (paths relative to catalog.json)
// into public/images/catalog/<slug>/, replacing that folder. File names carry a
// short content hash (model.1a2b3c4d.webp), so refreshed mockups (e.g. a new
// colour grade) get new URLs and no cache keeps serving the old ones.
// Extra files it makes:
//   *-checkout.jpg  a small JPEG of each photo set's first photo, for Stripe Checkout;
//   *-card.webp     the home-grid card, cropped to head-to-hips when the hero is a
//                   full-body shot (scripts/card-crop.mjs).
//
// Costs (cost_item, cost_ship_*) are NOT copied: the repo is public.
// Flags: --dry-run (validate + report, write nothing).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp"; // ships with next (next/image uses it)
import { cardCrop, writeCard } from "./card-crop.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "lib/catalog");
const PUBLIC_DIR = path.join(ROOT, "public/images/catalog");
const OPTION_ORDER = ["version", "style", "emblem", "color", "size"];
// Top-level routes a slug must not shadow.
const RESERVED = ["api", "preview", "redeem", "banana-suit-42", "images", "videos", "_next"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const catalogPath = args.find((a) => !a.startsWith("--"));
if (!catalogPath) {
  console.error("usage: node scripts/gen-catalog.mjs <catalog.json> [--dry-run]");
  process.exit(2);
}
const CATALOG_DIR = path.dirname(path.resolve(catalogPath));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);

const orderIndex = (n) => (OPTION_ORDER.includes(n) ? OPTION_ORDER.indexOf(n) : OPTION_ORDER.length);
const sortNames = (names) => [...names].sort((a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const nonEmpty = (o) => !!o && typeof o === "object" && Object.keys(o).length > 0;

// Legacy product ids (public/products.ts) can't be reused as slugs, except by
// the catalog product that superseded one (`superseded: true` there).
// (Imports the TypeScript file directly: needs Node >= 22.18.)
const legacy = (await import(pathToFileURL(path.join(ROOT, "public/products.ts")).href)).default.products;
const legacyIds = legacy.filter((p) => !p.superseded).map((p) => p.id);
for (const p of legacy.filter((q) => q.superseded))
  if (!(catalog.products ?? []).some((c) => c.slug === p.id))
    warnings.push(`legacy ${p.id} is marked superseded but catalog.json has no product with that slug`);

const hash8 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);

const products = [];
const fulfilment = {};
const imageCopies = []; // { from, to }
const proposed = [];

for (const p of catalog.products ?? []) {
  const where = `product ${p.slug ?? "(no slug)"}`;
  if (!p.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) fail(`${where}: slug must be kebab-case`);
  if (RESERVED.includes(p.slug) || legacyIds.includes(p.slug)) fail(`${where}: slug collides with an existing route/product`);
  if (products.some((q) => q.slug === p.slug)) fail(`${where}: duplicate slug`);
  if (!p.title) fail(`${where}: no title`);
  if ((p.supplier ?? "printful") !== "printful") fail(`${where}: supplier must be printful (got ${p.supplier})`);

  // Options, in picker order. Drop empty ones.
  const options = {};
  for (const name of sortNames(Object.keys(p.options ?? {}))) {
    const values = (p.options[name] ?? []).map(String);
    if (values.length === 0) continue;
    if (new Set(values.map((v) => v.toLowerCase())).size !== values.length) fail(`${where}: duplicate values in ${name}`);
    options[name] = values;
  }
  const names = Object.keys(options);
  const visual = names.filter((n) => n !== "size");
  if (names.filter((n) => n !== "size").length > 3)
    warnings.push(`${where}: ${names.length} pickers (${names.join(", ")}) — the spec says at most 3 + style`);

  // Variants.
  const variants = [];
  const fVariants = {};
  for (const v of p.variants ?? []) {
    const opts = {};
    for (const n of names) {
      const val = options[n].find((x) => eq(x, v[n]));
      if (val === undefined) fail(`${where}: variant ${JSON.stringify(v)} has no valid ${n}`);
      opts[n] = val;
    }
    const key = names.map((n) => opts[n]).join("|");
    if (fVariants[key]) fail(`${where}: duplicate variant ${key}`);
    if (!Number.isInteger(v.sync_variant_id)) fail(`${where}: variant ${key} has no sync_variant_id`);
    const price = Number(v.retail_price);
    if (!(price > 0)) fail(`${where}: variant ${key} has no retail_price`);
    const status = String(v.retail_status ?? "PROPOSED").toUpperCase();
    if (status !== "DECIDED") proposed.push(`${p.slug} ${key} $${price}`);
    variants.push({ opts, price, status });
    fVariants[key] = {
      syncVariantId: v.sync_variant_id,
      ...(Number.isInteger(v.catalog_variant_id) ? { catalogVariantId: v.catalog_variant_id } : {}),
    };
  }
  if (variants.length === 0) fail(`${where}: no variants`);

  // Images: "<v>|<s>|<colour>" keys -> { model, flat, ... }.
  const images = [];
  const usedNames = new Map(); // safe name -> source file
  const parseKey = (key) => {
    const segs = key.split("|").map((s) => s.trim());
    // Positional first (same count as the visual options, in picker order) ...
    if (segs.length === visual.length &&
        segs.every((s, i) => s === "*" || options[visual[i]].some((x) => eq(x, s)))) {
      return Object.fromEntries(segs.map((s, i) => [visual[i], s === "*" ? "*" : options[visual[i]].find((x) => eq(x, s))]));
    }
    // ... else by membership (each segment belongs to exactly one option).
    const when = {};
    for (const s of segs) {
      if (s === "*") {
        if (segs.length === 1) return {}; // "*" alone = every selection
        return null; // ambiguous wildcard
      }
      const owners = visual.filter((n) => options[n].some((x) => eq(x, s)) && !(n in when));
      if (owners.length !== 1) return null;
      when[owners[0]] = options[owners[0]].find((x) => eq(x, s));
    }
    return when;
  };
  for (const [key, val] of Object.entries(p.images ?? {})) {
    const when = parseKey(key);
    if (!when) { fail(`${where}: can't read image key "${key}"`); continue; }
    let files;
    if (typeof val === "string") files = [val];
    else if (Array.isArray(val)) files = val;
    else {
      const order = ["model", "model2", "flat"];
      files = [...order.filter((k) => val[k]).map((k) => val[k]),
               ...Object.entries(val).filter(([k]) => !order.includes(k)).map(([, f]) => f)];
    }
    const srcs = [];
    let checkout;
    for (const rel of files.filter(Boolean)) {
      const from = path.resolve(CATALOG_DIR, rel);
      if (!fs.existsSync(from)) { fail(`${where}: image missing: ${rel}`); continue; }
      const size = fs.statSync(from).size;
      if (size > 700 * 1024) warnings.push(`${where}: ${rel} is ${Math.round(size / 1024)} KB`);
      // Keep the path under images/<slug>/, made URL-safe, plus a content hash.
      const prefix = `images/${p.slug}/`;
      const sub = rel.startsWith(prefix) ? rel.slice(prefix.length) : path.basename(rel);
      const ext = path.extname(sub);
      const safe = `${sub.slice(0, sub.length - ext.length)}.${hash8(from)}${ext}`
        .toLowerCase()
        .replace(/[^a-z0-9._/-]+/g, "-");
      if (usedNames.has(safe) && usedNames.get(safe) !== from) fail(`${where}: two images map to ${safe}`);
      if (!usedNames.has(safe)) imageCopies.push({ from, to: path.join(PUBLIC_DIR, p.slug, safe) });
      usedNames.set(safe, from);
      srcs.push(`/images/catalog/${p.slug}/${safe}`);
      // Stripe Checkout gets a small JPEG of the first (on-model) photo: WebP and
      // transparency aren't safe bets there.
      if (!checkout) {
        const jpg = safe.replace(/\.[a-z0-9]+$/, "") + "-checkout.jpg";
        imageCopies.push({ from, to: path.join(PUBLIC_DIR, p.slug, jpg), jpeg: true });
        checkout = `/images/catalog/${p.slug}/${jpg}`;
      }
    }
    if (srcs.length) images.push({ when, images: srcs, checkout, firstFrom: files.filter(Boolean)[0] });
  }
  if (images.length === 0) fail(`${where}: no images`);

  // Home-grid card: the first photo of what the page shows by default (first
  // value of every picker), cropped to head-to-hips if it's a full-body shot.
  let card;
  const defaults = Object.fromEntries(visual.map((n) => [n, options[n][0]]));
  const scored = images
    .filter((s) => Object.entries(s.when).every(([k, v]) => v === "*" || eq(v, defaults[k])))
    .sort((a, b) =>
      Object.values(b.when).filter((v) => v !== "*").length - Object.values(a.when).filter((v) => v !== "*").length);
  const hero = (scored[0] ?? images[0])?.firstFrom;
  if (hero) {
    const from = path.resolve(CATALOG_DIR, hero);
    const crop = fs.existsSync(from) ? await cardCrop(from) : null;
    if (crop) {
      const name = `${path.basename(hero, path.extname(hero))}.${hash8(from)}-card.webp`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      imageCopies.push({ from, to: path.join(PUBLIC_DIR, p.slug, name), crop });
      card = `/images/catalog/${p.slug}/${name}`;
    }
  }
  for (const s of images) delete s.firstFrom;
  // Every colour (and version/style) someone can pick should have its own photos.
  const missing = new Set();
  for (const v of variants) {
    const covered = images.some((s) =>
      Object.entries(s.when).every(([k, val]) => val === "*" || eq(val, v.opts[k])));
    if (!covered) missing.add(visual.map((n) => v.opts[n]).join("|"));
  }
  if (missing.size) warnings.push(`${where}: no photos for ${[...missing].join(", ")} (shows the first set)`);

  // Credits: string[] + credit_when, or [{ text|lines, when }].
  const credits = [];
  const rawCredit = p.credit;
  if (Array.isArray(rawCredit) && rawCredit.length && typeof rawCredit[0] === "object") {
    for (const c of rawCredit) {
      const lines = [c.lines ?? c.text ?? []].flat().map(String).filter(Boolean);
      if (lines.length) credits.push(nonEmpty(c.when) ? { lines, when: c.when } : { lines });
    }
  } else if (rawCredit) {
    const lines = [rawCredit].flat().map(String).filter(Boolean);
    if (lines.length) credits.push(nonEmpty(p.credit_when) ? { lines, when: p.credit_when } : { lines });
  }
  for (const c of credits) {
    for (const [k, v] of Object.entries(c.when ?? {}))
      if (!options[k] || (v !== "*" && !options[k].some((x) => eq(x, v)))) fail(`${where}: credit_when ${k}=${v} matches nothing`);
    for (const l of c.lines)
      if (!/ by /.test(l)) console.log(`note: ${where}: credit "${l}" shows as written, without an avatar`);
  }

  // Royalties.
  const royalties = [];
  for (const r of p.royalties ?? []) {
    const perItem = Number(r.per_item);
    if (!r.artist || !(perItem >= 0)) { fail(`${where}: bad royalty ${JSON.stringify(r)}`); continue; }
    for (const [k, v] of Object.entries(r.when ?? {}))
      if (!options[k] || (v !== "*" && !options[k].some((x) => eq(x, v)))) fail(`${where}: royalty when ${k}=${v} matches nothing`);
    royalties.push(nonEmpty(r.when) ? { artist: String(r.artist), perItem, when: r.when } : { artist: String(r.artist), perItem });
  }

  products.push({
    slug: p.slug,
    title: p.title,
    supplier: "printful",
    delivery: "printful",
    ...(p.printful_catalog_product_id ? { printfulCatalogProductId: p.printful_catalog_product_id } : {}),
    options,
    variants,
    images,
    ...(card ? { card } : {}),
    credits,
  });
  fulfilment[p.slug] = { variants: fVariants, royalties };
}

for (const w of warnings) console.warn(`warn: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`\n${errors.length} error(s); nothing written.`);
  process.exit(1);
}

const header = (what) =>
  `// GENERATED by scripts/gen-catalog.mjs from catalog.json (generated_at ${catalog.generated_at ?? "?"}).\n` +
  `// Do not edit by hand: change catalog.json and re-run the script.\n// ${what}\n`;

const productsTs =
  header("Options, prices, images and credits for the pages and checkout.") +
  `import type { CatalogProduct } from "./types.ts";\n\n` +
  `export const catalogGeneratedAt = ${JSON.stringify(catalog.generated_at ?? null)};\n` +
  `/** True for a hand-made test catalog: never commit or deploy one. */\n` +
  `export const catalogIsSample = ${catalog.SAMPLE === true};\n\n` +
  `export const catalogProducts: CatalogProduct[] = ${JSON.stringify(products, null, 2)};\n`;

const fulfilmentTs =
  header("Server only: Printful sync variant ids (by variant key, see variantKey()) and royalty rules.") +
  `import type { FulfilmentEntry } from "./types.ts";\n\n` +
  `export const printfulStoreId = ${JSON.stringify(catalog.store_id ?? null)};\n\n` +
  `export const catalogFulfilment: Record<string, FulfilmentEntry> = ${JSON.stringify(fulfilment, null, 2)};\n`;

const totalVariants = products.reduce((n, p) => n + p.variants.length, 0);
const count = (f) => imageCopies.filter(f).length;
console.log(`${products.length} products, ${totalVariants} variants, ${count((c) => !c.jpeg && !c.crop)} images (+ ${count((c) => c.jpeg)} checkout JPEGs, ${count((c) => c.crop)} cropped cards)`);
for (const p of products)
  console.log(`  /${p.slug}  pickers: ${Object.keys(p.options).join(", ") || "none"}  variants: ${p.variants.length}${p.card ? "  card: cropped" : ""}`);
if (proposed.length) console.log(`${proposed.length} PROPOSED price(s), e.g. ${proposed.slice(0, 3).join("; ")}`);
if (dryRun) {
  console.log("dry run: nothing written");
  process.exit(0);
}

fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
for (const { from, to, jpeg, crop } of imageCopies) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (crop) {
    await writeCard(from, crop, to);
  } else if (jpeg) {
    await sharp(from)
      .resize({ width: 600, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(to);
  } else {
    fs.copyFileSync(from, to);
  }
}
fs.writeFileSync(path.join(OUT_DIR, "products.generated.ts"), productsTs);
fs.writeFileSync(path.join(OUT_DIR, "fulfilment.generated.ts"), fulfilmentTs);
console.log(`wrote lib/catalog/{products,fulfilment}.generated.ts and public/images/catalog/`);
