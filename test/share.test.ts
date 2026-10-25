// Link previews: Open Graph / Twitter cards (lib/share-meta.ts, scripts/gen-share-images.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { shopProducts, getShopProduct } from "../lib/catalog/index.ts";
import { SHARE_IMAGE_SIZE, shareImages } from "../lib/share-images.generated.ts";
import { firstSentence, productShareMeta, productShareTitle, shareMeta, SITE_DESCRIPTION, SITE_URL } from "../lib/share-meta.ts";

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
  assert.equal(productShareTitle(getShopProduct("sky-tee")!), "Sky Tee · $44.76");
  assert.equal(productShareTitle(getShopProduct("pelican-tee")!), "Pelican Tee · from $34.73");
  assert.equal(productShareTitle(getShopProduct("clouds-skater-dress")!), "Clouds Skater Dress · $54.27");
  const m = productShareMeta(getShopProduct("pelican-tee")!);
  const og = m.openGraph as Record<string, any>;
  assert.equal(og.title, "Pelican Tee · from $34.73");
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
  assert.equal(og.description, "Escape the ordinary, own a collectible piece of paradise. Art-inspired designs on real cotton, even the all-overs. Made to order · Morro Bay, CA");
  assert.equal(og.url, undefined); // the shared URL itself
  assert.equal(og.images[0].url, `https://mopclothing.com${shareImages.home}`);
  assert.equal((m.twitter as Record<string, any>).card, "summary_large_image");
});

test("the description pairs the slogan with the descriptor (John 10/13), and never claims 'in the USA'", () => {
  assert.match(SITE_DESCRIPTION, /^Escape the ordinary, own a collectible piece of paradise\. Art-inspired designs on real cotton/);
  for (const f of ["app/layout.tsx", "app/[productId]/page.tsx", "public/manifest.json", "lib/share-meta.ts", "app/page.tsx", "app/HomePage.tsx", "scripts/gen-share-images.mjs"])
    assert.doesNotMatch(readFileSync(path.join(ROOT, f), "utf8"), /in the USA/i, f);
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "public/manifest.json"), "utf8"));
  assert.equal(manifest.name, "Modern Orange Pineapple");
  assert.equal(manifest.short_name, "MOP");
  assert.equal(manifest.description, SITE_DESCRIPTION);
});

test("a ?color= link previews that colour's own photo and keeps the colour in og:url (John 10/14)", () => {
  const pelican = getShopProduct("pelican-tee")!;
  const black = productShareMeta(pelican, { color: "black" }); // case-insensitive, as people type it
  const og = black.openGraph as { url?: string; title?: string; images?: { url: string }[] };
  assert.match(og.images![0].url, /\/images\/share\/pelican-tee--black\.[0-9a-f]{8}\.jpg$/);
  assert.equal(og.url, `${SITE_URL}/pelican-tee?color=Black`);
  assert.match(String(og.title), /^Pelican Tee in Black · /);
  // no colour, an unknown colour, or a colour that shares the default photo → the product's image
  for (const color of [undefined, "Plaid", ""]) {
    const m = productShareMeta(pelican, { color }).openGraph as { url?: string; images?: { url: string }[] };
    assert.equal(m.images![0].url, `${SITE_URL}${shareImages["pelican-tee"]}`);
    assert.equal(m.url, `${SITE_URL}/pelican-tee`);
  }
  for (const [key, src] of Object.entries(shareImages))
    if (key.includes("?color=")) assert.notEqual(src, shareImages[key.split("?")[0]], key);
});
