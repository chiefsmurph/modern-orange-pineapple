// "Out in the wild" home section: data, files and the random pick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { wildPhotos } from "../lib/wild.generated.ts";
import { pickRandom, splitWild } from "../lib/wild.ts";
import { getShopProduct } from "../lib/catalog/index.ts";

const config = JSON.parse(readFileSync("scripts/wild/photos.json", "utf8")).photos as { n: string; hidden?: boolean }[];

test("every photo but the hidden ones is on the site; hidden ones have no files in the repo", () => {
  const hidden = config.filter((p) => p.hidden).map((p) => p.n);
  assert.deepEqual(hidden, ["13"]); // waiting for the camera original
  assert.deepEqual(wildPhotos.map((p) => p.n), config.filter((p) => !p.hidden).map((p) => p.n));
  const files = readdirSync("public/images/wild");
  for (const n of hidden) assert.ok(!files.some((f) => f.startsWith(`${n}.`) || f.startsWith(`${n}-`)), `no files for ${n}`);
  assert.equal(files.length, wildPhotos.length * 3); // lightbox, grid square, strip square
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

test("one shuffle feeds both spots: 5 in the top strip, the next 9 in the grid, none twice", () => {
  const order = pickRandom(wildPhotos, wildPhotos.length);
  const { strip, grid } = splitWild(order);
  assert.equal(strip.length, 5);
  assert.equal(grid.length, 9);
  const both = strip.filter((p) => grid.includes(p));
  assert.deepEqual(both, []);
  assert.equal(new Set([...strip, ...grid].map((p) => p.n)).size, 14);
});

test("strip thumbnails are 240×240", async () => {
  for (const p of wildPhotos) {
    const m = await sharp(path.join("public", p.small)).metadata();
    assert.deepEqual([m.width, m.height], [240, 240], p.n);
  }
});
