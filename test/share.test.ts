// Link previews: Open Graph / Twitter cards (lib/share-meta.ts, scripts/gen-share-images.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { shopProducts, getShopProduct } from "../lib/catalog/index.ts";
import { SHARE_IMAGE_SIZE, shareImages } from "../lib/share-images.generated.ts";
import { firstSentence, productShareMeta, productShareTitle, shareMeta, SITE_DESCRIPTION } from "../lib/share-meta.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("a 1200×630 JPEG for the home page and every product, content-hashed", async () => {
  assert.deepEqual(SHARE_IMAGE_SIZE, { width: 1200, height: 630 });
  for (const key of ["home", ...shopProducts.map((p) => p.slug)]) {
    const src = shareImages[key];
    assert.match(src ?? "", new RegExp(`^/images/share/${key}\\.[0-9a-f]{8}\\.jpg$`), key);
    const file = path.join(ROOT, "public", src);
    assert.ok(existsSync(file), file);
    const m = await sharp(file).metadata();
    assert.equal(m.format, "jpeg", key);
    assert.equal(m.width, 1200, key);
    assert.equal(m.height, 630, key);
    assert.ok(readFileSync(file).length < 1_000_000, `${key} is small enough for every app`);
  }
});

test("product previews: '<name> · $<price>', the copy's first sentence, its own photo, absolute URLs", () => {
  assert.equal(productShareTitle(getShopProduct("sky-tee")!), "Sky Tee · $44");
  assert.equal(productShareTitle(getShopProduct("pelican-tee")!), "Pelican Tee · from $29");
  assert.equal(productShareTitle(getShopProduct("clouds-skater-dress")!), "Clouds Skater Dress · $55");
  const m = productShareMeta(getShopProduct("pelican-tee")!);
  const og = m.openGraph as Record<string, any>;
  assert.equal(og.title, "Pelican Tee · from $29");
  assert.equal(og.description, "Yes, this really is the coolest pelican you have ever met.");
  assert.equal(og.url, "https://mopclothing.com/pelican-tee");
  assert.equal(og.siteName, "Modern Orange Pineapple");
  assert.match(og.images[0].url, /^https:\/\/mopclothing\.com\/images\/share\/pelican-tee\.[0-9a-f]{8}\.jpg$/);
  assert.equal(og.images[0].width, 1200);
  assert.equal(og.images[0].height, 630);
  const tw = m.twitter as Record<string, any>;
  assert.equal(tw.card, "summary_large_image");
  assert.deepEqual(tw.images, [og.images[0].url]);
  for (const p of shopProducts) {
    const o = productShareMeta(p).openGraph as Record<string, any>;
    assert.ok(o.description.length >= 10 && o.description.length <= 200, p.slug);
    assert.doesNotMatch(o.description, /\n|^- /, p.slug);
    assert.ok(o.title.startsWith(p.title), p.slug);
  }
});

test("first sentence: plain text, Mr. isn't a full stop, very short ones take the next", () => {
  assert.equal(firstSentence("Mr. Buckley's Nolli, Extra Fancy.\n\n- Comfort Colors"), "Mr. Buckley's Nolli, Extra Fancy.");
  assert.equal(firstSentence("Pick your sky. Every one is printed edge to edge.\n\n- Printed"), "Pick your sky. Every one is printed edge to edge.");
  assert.equal(firstSentence("The MOP rabbit, printed big or small.\n\n- Fabric"), "The MOP rabbit, printed big or small.");
  assert.ok(firstSentence("x".repeat(300)).endsWith("…"));
});

test("home and the other pages: the home image, the new description, a large card", () => {
  const m = shareMeta({ title: "Modern Orange Pineapple", description: SITE_DESCRIPTION });
  const og = m.openGraph as Record<string, any>;
  assert.equal(og.title, "Modern Orange Pineapple");
  assert.equal(og.description, "Art-inspired shirts on real cotton — even the all-overs. Made to order in the USA · Morro Bay, CA");
  assert.equal(og.url, undefined); // the shared URL itself
  assert.equal(og.images[0].url, `https://mopclothing.com${shareImages.home}`);
  assert.equal((m.twitter as Record<string, any>).card, "summary_large_image");
});

test("the old tagline is gone from the metadata and the manifest", () => {
  const old = /Escape the Ordinary|Collectible Piece of Paradise/i;
  for (const f of ["app/layout.tsx", "app/[productId]/page.tsx", "public/manifest.json", "lib/share-meta.ts"])
    assert.doesNotMatch(readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*\* The site's description \(replaced[^\n]*/, ""), old, f);
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "public/manifest.json"), "utf8"));
  assert.equal(manifest.name, "Modern Orange Pineapple");
  assert.equal(manifest.short_name, "MOP");
  assert.equal(manifest.description, SITE_DESCRIPTION);
});
