#!/usr/bin/env node
// Link previews (Open Graph / Twitter cards): 1200×630 JPEGs for sharing.
//
//   home      the MOP wordmark (Orbitron, as on the site) on the site's sky
//             backdrop, four all-over shirts (Day, Dusk, Night, a Sky Tee) and
//             the line "Art-inspired designs on real cotton".
//   <slug>    each product's photo (its home-card photo: the hero, or the hero's
//             head-to-hips crop for full-body shots), letterboxed on the light
//             photo-tile grey. Centred, so a square crop (some apps) is the photo.
//
// Writes public/images/share/<name>.<hash>.jpg (content-hashed: Facebook and
// Instagram cache a preview by URL) and lib/share-images.generated.ts, which the
// page metadata reads. Re-run after the catalog changes (gen-catalog.mjs runs it
// at the end):  node scripts/gen-share-images.mjs   (Node >= 22.18)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Text is set by Pango through fontconfig: point it at a config that knows only the
// bundled Orbitron, before sharp (libvips) loads, so every machine draws the same text.
// (macOS: Pango would use CoreText, which never sees the file, unless told to use fontconfig.)
process.env.FONTCONFIG_FILE = path.join(ROOT, "scripts", "share", "fonts.conf");
process.env.PANGOCAIRO_BACKEND = "fc";
const { default: sharp } = await import("sharp");
const OUT_DIR = path.join(ROOT, "public", "images", "share");
const TS_OUT = path.join(ROOT, "lib", "share-images.generated.ts");
const FONT = path.join(ROOT, "scripts", "share", "Orbitron.ttf"); // SIL OFL 1.1, scripts/share/OFL.txt
const W = 1200;
const H = 630;
/** --photo-tile in app/globals.css: the grey behind every product photo. */
const TILE = "#ecedee";
const ORANGE = "#ff8c00";

/** The home image's shirts: product slug + the flat (cut-out) photo to use. */
export const HOME_SHIRTS = [
  { slug: "day-all-over", when: { style: "beanie" } },
  { slug: "dusk-all-over", when: {} },
  { slug: "night-all-over", when: {} },
  { slug: "sky-tee", when: { sky: "orbital-sunset" } },
];
export const HOME_LINE = "Art-inspired designs on real cotton";

const pub = (src) => path.join(ROOT, "public", decodeURI(src));

/** A text layer in Orbitron (Pango markup), as a PNG buffer with its size. Orbitron has no "·": use "•". */
async function text(markup, { size, weight = "Bold", dpi = 72 }) {
  const { data, info } = await sharp({
    text: { text: markup, font: `Orbitron ${weight} ${size}`, fontfile: FONT, rgba: true, dpi },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

/** Text with the site's orange glow (app/styles.css .glitch): blurred orange copies under white. */
async function glowText(str, size, weight = "Bold", italic = false) {
  const esc = str.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const wrap = (color) => `<span foreground="${color}">${italic ? `<i>${esc}</i>` : esc}</span>`;
  const white = await text(wrap("white"), { size, weight });
  const pad = Math.round(size * 0.8);
  const orange = await text(wrap(ORANGE), { size, weight });
  const canvas = { width: white.width + pad * 2, height: white.height + pad * 2 };
  const glow = await sharp({ create: { ...canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: orange.input, left: pad, top: pad }])
    .png()
    .toBuffer();
  const blurred = (sigma) => sharp(glow).blur(sigma).png().toBuffer();
  const input = await sharp({ create: { ...canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await blurred(size * 0.35) },
      { input: await blurred(size * 0.18) },
      { input: await blurred(size * 0.08) },
      { input: white.input, left: pad, top: pad },
    ])
    .png()
    .toBuffer();
  return { input, width: canvas.width, height: canvas.height, pad };
}

/** A transparent cut-out, rotated, with a soft shadow under it. */
async function shirt(file, size, angle) {
  const cut = await sharp(file).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const rotated = await sharp(cut).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  const { width, height } = rotated.info;
  // the shirt's silhouette in dark blue at 45%
  const alpha = await sharp(rotated.data).extractChannel("alpha").raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 10;
    rgba[i * 4 + 1] = 30;
    rgba[i * 4 + 2] = 50;
    rgba[i * 4 + 3] = Math.round(alpha[i] * 0.45);
  }
  const shadow = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const blurredShadow = await sharp(shadow).blur(14).png().toBuffer();
  return { shirt: rotated.data, shadow: blurredShadow, width, height };
}

export async function homeImage(shopProducts, imagesFor) {
  // The site's backdrop (globals.css .site-bg): the sea-and-sky still under its darkening gradient.
  const bg = await sharp(pub("/images/bg/sea-light.webp")).resize(W, H, { fit: "cover", position: "bottom" }).png().toBuffer();
  const shade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="rgb(0,0,30)" stop-opacity="0.10"/><stop offset="1" stop-color="rgb(0,30,60)" stop-opacity="0.28"/>` +
      `</linearGradient><linearGradient id="l" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="rgb(0,20,40)" stop-opacity="0.30"/><stop offset="0.55" stop-color="rgb(0,20,40)" stop-opacity="0"/>` +
      `</linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#l)"/></svg>`
  );
  const layers = [{ input: shade }];

  // Four shirts, two rows, slightly fanned, on the right.
  const spots = [
    { x: 642, y: 14, size: 288, angle: -7 },
    { x: 892, y: 30, size: 288, angle: 6 },
    { x: 616, y: 296, size: 288, angle: 5 },
    { x: 874, y: 306, size: 288, angle: -6 },
  ];
  for (const [i, { slug, when }] of HOME_SHIRTS.entries()) {
    const p = shopProducts.find((x) => x.slug === slug);
    if (!p) throw new Error(`home image: no product ${slug}`);
    const set = p.images.find((s) => Object.entries(when).every(([k, v]) => s.when[k] === v)) ?? p.images[0];
    const flat = set.images.find((src) => /(^|\/)([a-z0-9-]+-)?flat\./.test(src)) ?? imagesFor(p, when)[0];
    const s = await shirt(pub(flat), spots[i].size, spots[i].angle);
    layers.push({ input: s.shadow, left: spots[i].x + 8, top: spots[i].y + 14 });
    layers.push({ input: s.shirt, left: spots[i].x, top: spots[i].y });
  }

  // The wordmark, as the site's header: mopclothing.com, a dashed rule, Modern Orange Pineapple.
  const word = await glowText("mopclothing.com", 50, "Black");
  const sub = await glowText("Modern Orange Pineapple", 27, "Bold", true);
  const x = 64;
  let y = 150;
  layers.push({ input: word.input, left: x - word.pad, top: y - word.pad });
  y += word.height - word.pad * 2 + 16;
  const ruleW = word.width - word.pad * 2;
  layers.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ruleW}" height="6"><line x1="0" y1="3" x2="${ruleW}" y2="3" stroke="white" stroke-opacity="0.45" stroke-width="3" stroke-dasharray="9 6"/></svg>`
    ),
    left: x,
    top: y,
  });
  y += 22;
  layers.push({ input: sub.input, left: x - sub.pad, top: y - sub.pad });
  y += sub.height - sub.pad * 2 + 44;

  // The line, in the site's tagline pill (white on translucent black).
  const line = await text(`<span foreground="white">${HOME_LINE}</span>`, { size: 22, weight: "SemiBold" });
  const padX = 20;
  const padY = 13;
  const pillW = line.width + padX * 2;
  const pillH = line.height + padY * 2;
  layers.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="100%" height="100%" rx="12" fill="black" fill-opacity="0.32"/></svg>`
    ),
    left: x,
    top: y,
  });
  layers.push({ input: line.input, left: x + padX, top: y + padY });
  y += pillH + 22;
  const small = await text(`<span foreground="white">Made to order • Morro Bay, CA</span>`, { size: 16, weight: "Medium" });
  layers.push({ input: small.input, left: x + 4, top: y });

  return sharp(bg).composite(layers).flatten({ background: TILE }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

/** A product photo letterboxed on the photo-tile grey. */
export async function productImage(file) {
  const photo = await sharp(file)
    .resize(W, H, { fit: "inside", withoutEnlargement: false })
    .flatten({ background: TILE })
    .png()
    .toBuffer({ resolveWithObject: true });
  return sharp({ create: { width: W, height: H, channels: 3, background: TILE } })
    .composite([{ input: photo.data, left: Math.round((W - photo.info.width) / 2), top: Math.round((H - photo.info.height) / 2) }])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
}

export async function generateShareImages() {
  const { shopProducts } = await import("../lib/catalog/index.ts");
  const { imagesFor, normalizeSelection } = await import("../lib/catalog/select.ts");

  const files = {};
  const outputs = [["home", await homeImage(shopProducts, imagesFor)]];
  for (const p of shopProducts) {
    const src = p.card ?? imagesFor(p, normalizeSelection(p))[0];
    if (!src) throw new Error(`no photo for ${p.slug}`);
    outputs.push([p.slug, await productImage(pub(src))]);
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, buf] of outputs) {
    const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 8);
    const file = `${name}.${hash}.jpg`;
    fs.writeFileSync(path.join(OUT_DIR, file), buf);
    files[name] = `/images/share/${file}`;
  }
  const ts =
    `// GENERATED by scripts/gen-share-images.mjs. Do not edit by hand: re-run the script.\n` +
    `// 1200×630 link-preview JPEGs: "home" and one per catalog product (by slug).\n` +
    `export const SHARE_IMAGE_SIZE = { width: ${W}, height: ${H} } as const;\n\n` +
    `export const shareImages: Record<string, string> = ${JSON.stringify(files, null, 2)};\n`;
  fs.writeFileSync(TS_OUT, ts);
  const kb = outputs.reduce((n, [, b]) => n + b.length, 0) / 1024;
  console.log(`wrote ${outputs.length} share images (${Math.round(kb)} KB) to public/images/share/ and lib/share-images.generated.ts`);
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateShareImages().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
