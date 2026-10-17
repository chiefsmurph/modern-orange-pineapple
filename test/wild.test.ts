// "Out in the wild" home section: data, files and the random pick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { wildPhotos } from "../lib/wild.generated.ts";
import { adjacentRepeats, mixWild, pickRandom, GRID_COLS, GRID_COUNT, STRIP_COUNT } from "../lib/wild.ts";
import { getShopProduct } from "../lib/catalog/index.ts";

const config = JSON.parse(readFileSync("scripts/wild/photos.json", "utf8")).photos as { n: string; hidden?: boolean }[];

test("every photo but the hidden ones is on the site; hidden ones have no files in the repo", () => {
  const hidden = config.filter((p) => p.hidden).map((p) => p.n);
  assert.deepEqual(hidden, ["13"]); // waiting for the camera original
  assert.deepEqual(wildPhotos.map((p) => p.n), config.filter((p) => !p.hidden).map((p) => p.n));
  const files = readdirSync("public/images/wild");
  for (const n of hidden) assert.ok(!files.some((f) => f.startsWith(`${n}.`) || f.startsWith(`${n}-`)), `no files for ${n}`);
  assert.equal(files.length, wildPhotos.length * 4); // lightbox, grid square, its 600 px version, strip square
});

test("captions link to products that exist; alt text describes the shirt, with no names", () => {
  const names = /\b(Jack|Anthony|Em|Zayra|Katrina|Valeria|Becca|Cece|Anecita|Christoph|Eva|John)\b/;
  for (const p of wildPhotos) {
    assert.ok(getShopProduct(p.href.slice(1)), `${p.n}: ${p.href}`);
    assert.doesNotMatch(p.alt, names, `${p.n} alt`);
    assert.doesNotMatch(p.design, names, `${p.n} caption`);
    assert.match(p.alt, /tee|top|tank|jersey|dress|crop/i, `${p.n}: alt names the garment`);
  }
});

test("lightbox photos are ≤1000 px on the long side; grid squares are 500×500", async () => {
  for (const p of wildPhotos) {
    assert.ok(existsSync(path.join("public", p.src)) && existsSync(path.join("public", p.square)), p.n);
    const full = await sharp(path.join("public", p.src)).metadata();
    assert.equal(Math.max(full.width!, full.height!) <= 1000, true, `${p.n} full`);
    assert.deepEqual([full.width, full.height], [p.width, p.height]);
    const sq = await sharp(path.join("public", p.square)).metadata();
    assert.deepEqual([sq.width, sq.height], [500, 500], `${p.n} square`);
  }
});

test("photo 10 is re-cropped (landscape, sign left out)", () => {
  const p = wildPhotos.find((x) => x.n === "10")!;
  assert.ok(p.width > p.height);
});

test("pickRandom: n different photos, a fresh order each time", () => {
  const items = Array.from({ length: 27 }, (_, i) => i);
  const a = pickRandom(items, 9);
  assert.equal(a.length, 9);
  assert.equal(new Set(a).size, 9);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const b = pickRandom(items, 9, rnd);
  seed = 7;
  const c = pickRandom(items, 9, rnd);
  assert.notDeepEqual(b, c);
  assert.deepEqual(items, Array.from({ length: 27 }, (_, i) => i)); // the input isn't shuffled in place
});

test("strip thumbnails are 240×240", async () => {
  for (const p of wildPhotos) {
    const m = await sharp(path.join("public", p.small)).metadata();
    assert.deepEqual([m.width, m.height], [240, 240], p.n);
  }
});

test("the strip is bigger on computers (John 10/16): 180 px tiles from 1200 px, up to 150 px from 769 px; phones unchanged", () => {
  const css = readFileSync("components/WildStrip.module.css", "utf8");
  const mid = css.slice(css.indexOf("@media (min-width: 769px)"), css.indexOf("@media (min-width: 1200px)"));
  const wide = css.slice(css.indexOf("@media (min-width: 1200px)"));
  assert.match(css, /\.row \{\s*--tile: 100px;/); // phones
  assert.match(mid, /--tile: min\(150px, calc\(\(100vw - 160px\) \/ 5\)\);/);
  assert.match(wide, /--tile: 180px;/);
  assert.match(mid, /\.label \{[^}]*font-size: 0\.85rem;/);
  // still a fixed height, so the shuffle after hydration can't move the page
  assert.match(css, /\.row \{[^}]*height: var\(--tile\);/);
  assert.match(css, /\.cell \{\s*flex: 0 0 var\(--tile\);/);
});

test("the 3×3 section is a little bigger on computers ≥ 1200 px (John 10/16): ~288 px tiles, sharp at 2x", async () => {
  const css = readFileSync("components/OutInTheWild.module.css", "utf8");
  assert.match(css, /\.wild \{\s*max-width: 720px;/); // below 1200 px, as before
  const wide = css.slice(css.indexOf("@media (min-width: 1200px)"), css.indexOf("@media (max-width: 768px)"));
  assert.match(wide, /\.wild \{\s*max-width: 880px;/);
  assert.match(wide, /\.grid \{\s*gap: 8px;/);
  const tile = (880 - 2 * 8) / 3;
  assert.ok(tile > 285 && tile <= 290, `${tile}`);
  // the 600 px square covers a ~288 px tile at 2x; the 500 px one still covers phones and smaller screens
  assert.ok(600 >= 2 * tile && 500 >= 2 * ((720 - 2 * 6) / 3));
  const src = readFileSync("components/OutInTheWild.tsx", "utf8");
  assert.match(src, /srcSet=\{`\$\{p\.square\} 500w, \$\{p\.large\} 600w`\}/);
  assert.match(src, /TILE_SIZES = "\(min-width: 1200px\) 290px, \(min-width: 769px\) 240px, 31vw"/);
  for (const p of wildPhotos) {
    // the same hand-picked square as the 500 and 240 px files
    assert.equal(p.large.replace(/-lg\.[0-9a-f]{8}/, ""), p.square.replace(/-sq\.[0-9a-f]{8}/, ""), p.n);
    const m = await sharp(path.join("public", p.large)).metadata();
    assert.deepEqual([m.width, m.height], [600, 600], `${p.n} large`);
  }
});

test("computers get the same square crop at 500 px (sharp on retina); phones keep the 240 px file", () => {
  const src = readFileSync("components/WildStrip.tsx", "utf8");
  assert.match(src, /<source media="\(min-width: 769px\)" srcSet=\{`\$\{p\.small\} 240w, \$\{p\.square\} 500w`\}/);
  assert.match(src, /STRIP_DESKTOP_SIZES = "\(min-width: 1200px\) 180px, 150px"/);
  assert.match(src, /<img src=\{p\.small\}/);
  // the 500 px file is the grid square: the same hand-picked crop as the 240 px one, not the uncropped photo
  for (const p of wildPhotos) assert.equal(p.square.replace(/-sq\.[0-9a-f]{8}/, ""), p.small.replace(/-sm\.[0-9a-f]{8}/, ""), p.n);
});

// --- people: the strip never shows anyone twice, the grid never side by side (10/13) ---

/** A small seeded random (mulberry32) so every run tries the same 2,000 visits. */
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("every photo on the site says who is in it; hidden photos stay off the site", () => {
  const photosJson = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "scripts/wild/photos.json"), "utf8")).photos;
  for (const p of photosJson) assert.ok(p.person && (typeof p.person === "string" || p.person.length), `${p.n} has a person`);
  for (const w of wildPhotos) {
    assert.ok(w.people.length >= 1 && w.people.every((x) => /^p\d{2}$/.test(x)), w.n);
    assert.deepEqual(w.people, [photosJson.find((p: { n: string }) => p.n === w.n).person].flat(), w.n);
  }
  const hidden = photosJson.filter((p: { hidden?: boolean }) => p.hidden).map((p: { n: string }) => p.n);
  assert.ok(hidden.length > 0);
  for (const n of hidden) assert.ok(!wildPhotos.some((w) => w.n === n), `hidden ${n} is not on the site`);
});

test("2,000 visits: the strip never shows a person twice, never overlaps the grid, and the grid never puts a person side by side", () => {
  const strips = new Set<string>();
  for (let seed = 1; seed <= 2000; seed++) {
    const { strip, grid } = mixWild(wildPhotos, seeded(seed));
    assert.equal(strip.length, STRIP_COUNT);
    assert.equal(grid.length, GRID_COUNT);
    const people = strip.flatMap((p) => p.people);
    assert.equal(new Set(people).size, people.length, `seed ${seed}: someone twice in the strip`);
    for (const p of grid) assert.ok(!strip.includes(p), `seed ${seed}: ${p.n} in both`);
    assert.equal(new Set(grid.map((p) => p.n)).size, GRID_COUNT, `seed ${seed}: a photo twice in the grid`);
    assert.equal(adjacentRepeats(grid, GRID_COLS), 0, `seed ${seed}: same person side by side`);
    strips.add(strip.map((p) => p.n).join(","));
  }
  // a fresh mix each visit (and every photo gets its turn)
  assert.ok(strips.size > 1900, `${strips.size} different strips`);
  const shown = new Set(Array.from(strips).flatMap((s) => s.split(",")));
  assert.equal(shown.size, wildPhotos.length);
});

test("the grid spreads people out: 9 photos of at least 7 different people, nobody more than twice", () => {
  let least = 99;
  for (let seed = 1; seed <= 2000; seed++) {
    const { grid } = mixWild(wildPhotos, seeded(seed));
    least = Math.min(least, new Set(grid.flatMap((p) => p.people)).size);
    const count: Record<string, number> = {};
    for (const p of grid) for (const x of p.people) count[x] = (count[x] ?? 0) + 1;
    assert.ok(Math.max(...Object.values(count)) <= 2, `seed ${seed}: someone 3 times in the grid`);
  }
  assert.ok(least >= 7, `only ${least} different people in some grid`);
});

test("the two-person photo blocks both of them: never with another photo of either in the strip", () => {
  const both = wildPhotos.find((w) => w.people.length > 1)!;
  assert.ok(both, "the photo with two people");
  for (let seed = 1; seed <= 500; seed++) {
    const { strip } = mixWild(wildPhotos, seeded(seed));
    if (!strip.includes(both)) continue;
    for (const p of strip) if (p !== both) assert.ok(!p.people.some((x) => both.people.includes(x)), `seed ${seed}: ${p.n} with ${both.n}`);
  }
});

test("adjacentRepeats counts left/right and above/below only", () => {
  const P = (id: string) => ({ people: [id] });
  assert.equal(adjacentRepeats([P("a"), P("a"), P("b")]), 1); // side by side
  assert.equal(adjacentRepeats([P("a"), P("b"), P("c"), P("a")]), 1); // above/below
  assert.equal(adjacentRepeats([P("a"), P("b"), P("a")]), 0); // same row, not touching
  assert.equal(adjacentRepeats([P("a"), P("b"), P("c"), P("d"), P("a")]), 0); // diagonal
});
