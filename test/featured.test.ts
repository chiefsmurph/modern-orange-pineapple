// The first cards on the home grid (lib/catalog/copy.ts `featured`, lib/shop-cards.ts).
// Until 10/16 they were a "Featured" section above the grid; now they're its top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { featured } from "../lib/catalog/copy.ts";
import { getShopProduct } from "../lib/catalog/index.ts";
import { featuredCardImages } from "../lib/catalog/featured.generated.ts";
import { featuredCards, homeCards, restCards, shopCards } from "../lib/shop-cards.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const slugOf = (href: string) => href.split("?")[0].slice(1);

test("the home grid opens with the Sky Tee, then Day, the shorts, Dusk, Rabbit, Pelican, Original Star (John 10/16)", () => {
  assert.deepEqual(homeCards().slice(0, 7).map((c) => slugOf(c.href)), [
    "sky-tee",
    "day-all-over",
    "blue-sky-cotton-shorts",
    "dusk-all-over",
    "rabbit-tee",
    "pelican-tee",
    "original-star-tee",
  ]);
  // the picks and prices John chose on 10/13 travel with each card
  assert.deepEqual(
    featuredCards().map((c) => [c.href, c.price]),
    [
      ["/sky-tee?sky=orbital-sunset", "$44"],
      ["/day-all-over?style=beanie", "$44"],
      ["/blue-sky-cotton-shorts", "From $40"],
      ["/dusk-all-over", "$44"],
      ["/rabbit-tee?version=large&color=Blossom", "From $29"],
      ["/pelican-tee?version=large&style=beanie", "From $29"],
      ["/original-star-tee", "From $29"],
    ]
  );
});

test("the first card, the Sky Tee, keeps its row of skies", () => {
  const sky = homeCards()[0];
  assert.equal(sky.title, "Sky Tee");
  assert.equal(sky.swatches?.length, getShopProduct("sky-tee")!.options.sky.length);
  assert.ok(sky.swatches!.length > 1);
  for (const s of sky.swatches!) assert.ok(existsSync(path.join(ROOT, "public", s.src)), s.src);
  // phones show them too (two compact cards per row): small enough for one row
  const css = readFileSync(path.join(ROOT, "components/ProductCard.module.css"), "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 768px)"));
  assert.doesNotMatch(phone, /\.swatches\s*[,{][^}]*display:\s*none/);
  assert.match(phone, /\.swatch \{[^}]*width: 12px/);
});

test("the shorts are the usual Yoycol card: their own photo, free shipping, the honest 3–4 week delivery", () => {
  const shorts = featuredCards().find((c) => c.href === "/blue-sky-cotton-shorts")!;
  assert.equal(shorts.title, "Blue Sky Cotton Shorts");
  assert.ok(shorts.freeShipping);
  assert.match(shorts.delivery, /3–4 weeks/);
  assert.ok(existsSync(path.join(ROOT, "public", shorts.image)), shorts.image);
  assert.deepEqual(shorts, shopCards().find((c) => c.href === "/blue-sky-cotton-shorts"));
});

test("Featured photos: no model twice in a row — pelican on the women's model, Blossom rabbit on the men's, Sky Tee flat", async () => {
  const cards = featuredCards();
  const pel = cards.find((c) => c.href.startsWith("/pelican-tee"))!;
  const rabbit = cards.find((c) => c.href.startsWith("/rabbit-tee"))!;
  assert.match(pel.image, /^\/images\/featured\/pelican-tee\.[0-9a-f]{8}\.webp$/);
  assert.match(rabbit.image, /^\/images\/featured\/rabbit-tee\.[0-9a-f]{8}\.webp$/);
  assert.match(cards.find((c) => c.href.startsWith("/sky-tee"))!.image, /\/sky-tee\/orbital-sunset-flat\.[0-9a-f]{8}\.webp$/);
  assert.match(cards.find((c) => c.href.startsWith("/day-all-over"))!.image, /\/day-all-over\/beanie-model\..*-card\.webp$/);
  for (const c of cards) {
    const file = path.join(ROOT, "public", c.image);
    assert.ok(existsSync(file), c.image);
  }
  const m = await sharp(path.join(ROOT, "public", pel.image)).metadata();
  assert.equal(m.width, 900);
  assert.equal(m.height, 900);
  // the generated list covers exactly the featured products made from the catalog (not the older shorts)
  assert.deepEqual(Object.keys(featuredCardImages), featured.items.map((f) => f.slug).filter((s) => getShopProduct(s)));
});

test("after the first seven: everything else, in the usual order, no repeats; Night is still there; Gold Stripes is retired", () => {
  const featuredPaths = featuredCards().map((c) => c.href.split("?")[0]);
  const rest = restCards().map((c) => c.href);
  for (const p of featuredPaths) assert.ok(!rest.includes(p), p);
  assert.ok(rest.includes("/night-all-over"));
  assert.ok(!rest.includes("/gold-stripes")); // retired 2026-10-17 while John redoes the trim
  assert.equal(rest.length + featuredPaths.length, shopCards().length);
  // same order as before for the rest
  assert.deepEqual(rest, shopCards().map((c) => c.href).filter((h) => !featuredPaths.includes(h)));
  assert.deepEqual(homeCards().map((c) => c.href), [...featuredCards(), ...restCards()].map((c) => c.href));
  assert.equal(new Set(homeCards().map((c) => slugOf(c.href))).size, homeCards().length);
});

test("the home page is one grid: no separate Featured heading, the first card loads first", () => {
  const src = readFileSync(path.join(ROOT, "app/page.tsx"), "utf8");
  assert.match(src, /homeCards\(\)\.map\(\(card, index\)/);
  assert.match(src, /priority=\{index === 0\}/);
  assert.doesNotMatch(src, /featuredCards\(\)|restCards\(\)/);
  assert.doesNotMatch(src, /featured\.title|id="featured"/);
  assert.doesNotMatch(src, /groupSections/);
});

test("the Star Crop Top leads with the sitting photo (card, page and checkout), not the Pelican Crop Top's standing pose (John 10/16)", () => {
  const star = getShopProduct("star-crop-top")!;
  for (const set of star.images) {
    assert.match(set.images[0], /-model-womens-lifestyle-2\.[0-9a-f]{8}\.webp$/, JSON.stringify(set.when));
    assert.match(set.images[1], /-model-womens-3\.[0-9a-f]{8}\.webp$/);
    assert.match(set.images[2], /-flat\.[0-9a-f]{8}\.webp$/);
    assert.match(set.checkout ?? "", /-model-womens-lifestyle-2\.[0-9a-f]{8}-checkout\.jpg$/);
    assert.ok(existsSync(path.join(ROOT, "public", set.checkout!)), set.checkout);
  }
  const cards = homeCards();
  const starCard = cards.find((c) => c.href === "/star-crop-top")!;
  const pelicanCard = cards.find((c) => c.href === "/pelican-crop-top")!;
  // a seated full-body photo isn't cropped head-to-hips: the card is the photo itself
  assert.equal(star.card, undefined);
  assert.equal(starCard.image, "/images/catalog/star-crop-top/white-model-womens-lifestyle-2.2d569775.webp");
  assert.match(pelicanCard.image, /-model-womens-3\./);
});
