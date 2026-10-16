// Home-grid card crops (scripts/card-crop.mjs) and the generated images.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { cardCrop } from "../scripts/card-crop.mjs";
import { catalogProducts } from "../lib/catalog/products.generated.ts";
import { tmpDir } from "./helpers.ts";

/** A transparent 800×800 PNG with an opaque "figure" rectangle. */
async function figure(file: string, box: { left: number; top: number; width: number; height: number }, opaque = false) {
  const base = sharp({
    create: { width: 800, height: 800, channels: 4, background: opaque ? "#c8c8c8" : { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  const body = await sharp({ create: { width: box.width, height: box.height, channels: 4, background: "#3366cc" } }).png().toBuffer();
  await base.composite([{ input: body, left: box.left, top: box.top }]).png().toFile(file);
  return file;
}

test("a full-body cut-out is cropped to a head-to-hips square", async () => {
  const dir = tmpDir();
  // 120 wide × 760 tall: covers 14% of the frame, like Printful's full-body shots
  const crop = await cardCrop(await figure(path.join(dir, "full.png"), { left: 340, top: 20, width: 120, height: 760 }));
  assert.ok(crop);
  assert.equal(crop.width, crop.height);
  assert.ok(Math.abs(crop.height - 760 * 0.55) <= 2, `side ${crop.height}`);
  assert.ok(crop.top <= 20, "starts at (or just above) the top of the head");
  assert.ok(crop.left <= 340 && crop.left + crop.width >= 460, "keeps the figure centred");
});

test("waist-up cut-outs and photos are left alone", async () => {
  const dir = tmpDir();
  // 340 × 780: 41% of the frame, like the waist-up mockups
  assert.equal(await cardCrop(await figure(path.join(dir, "waist.png"), { left: 230, top: 10, width: 340, height: 780 })), null);
  // an opaque studio photo (grey background): nothing to measure
  assert.equal(await cardCrop(await figure(path.join(dir, "photo.png"), { left: 340, top: 20, width: 120, height: 760 }, true)), null);
});

test("generated images: content-hashed names, model shots before the flat, cards exist", () => {
  for (const p of catalogProducts) {
    for (const set of p.images) {
      for (const src of set.images) {
        assert.match(src, /\.[0-9a-f]{8}\.(webp|png|jpe?g)$/, src);
        assert.ok(existsSync(path.join("public", src)), `missing ${src}`);
      }
      // model, then model2, then flat, then extras (detail, back...). The hero is a model
      // shot, or the flat itself when Printful has no second model (the all-over line:
      // one model, so some heroes are flat shots; the Sky Shorts, Printful 1481, have flat
      // mockups only); either way no image repeats.
      const stems = set.images.map((src) => path.basename(src).replace(/\.[0-9a-f]{8}\.\w+$/, ""));
      assert.equal(new Set(set.images).size, set.images.length, `${p.slug}: repeated image`);
      const flatHero = /(^|-)flat$/.test(stems[0]);
      const flatOnly = p.group === "allover" || p.printfulCatalogProductId === 1481;
      assert.ok(/model/.test(stems[0]) || (flatHero && flatOnly), `${p.slug}: hero ${stems[0]}`);
      const flat = stems.findIndex((s) => /(^|-)flat$/.test(s));
      if (flat > 0) assert.ok(stems.slice(0, flat).every((s) => /model/.test(s)), `${p.slug}: ${stems.join(", ")}`);
    }
    if (p.card) {
      assert.match(p.card, /-card\.webp$/);
      assert.ok(existsSync(path.join("public", p.card)), `missing ${p.card}`);
    }
  }
});
