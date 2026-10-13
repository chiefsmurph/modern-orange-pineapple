// The home page's Featured section (lib/catalog/copy.ts `featured`, lib/shop-cards.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { featured } from "../lib/catalog/copy.ts";
import { featuredCardImages } from "../lib/catalog/featured.generated.ts";
import { featuredCards, restCards, shopCards } from "../lib/shop-cards.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("Featured: all-overs alternating with the $29 tees, in the order John chose", () => {
  assert.equal(featured.title, "Featured");
  assert.equal(featured.line, "Heavyweight cotton tees and edge-to-edge all-overs.");
  const cards = featuredCards();
  assert.deepEqual(
    cards.map((c) => [c.href, c.price]),
    [
      ["/day-all-over?style=beanie", "$44"],
      ["/pelican-tee?version=large&style=beanie", "From $29"],
      ["/dusk-all-over", "$44"],
      ["/rabbit-tee", "From $29"],
      ["/sky-tee", "$44"],
      ["/original-star-tee", "From $29"],
    ]
  );
});

test("Featured photos: the Big Grind Beanie pelican and the rabbit on the women's model, cropped like the other cards", async () => {
  const cards = featuredCards();
  const pel = cards.find((c) => c.href.startsWith("/pelican-tee"))!;
  const rabbit = cards.find((c) => c.href.startsWith("/rabbit-tee"))!;
  assert.match(pel.image, /^\/images\/featured\/pelican-tee\.[0-9a-f]{8}\.webp$/);
  assert.match(rabbit.image, /model-womens.*-card\.webp$/);
  assert.match(cards.find((c) => c.href.startsWith("/day-all-over"))!.image, /\/day-all-over\/beanie-model\..*-card\.webp$/);
  for (const c of cards) {
    const file = path.join(ROOT, "public", c.image);
    assert.ok(existsSync(file), c.image);
  }
  const m = await sharp(path.join(ROOT, "public", pel.image)).metadata();
  assert.equal(m.width, 900);
  assert.equal(m.height, 900);
  // the generated list covers exactly the featured products
  assert.deepEqual(Object.keys(featuredCardImages), featured.items.map((f) => f.slug));
});

test("the main grid below: everything else, no repeats; Night and Gold Stripes are still there", () => {
  const featuredPaths = featuredCards().map((c) => c.href.split("?")[0]);
  const rest = restCards().map((c) => c.href);
  for (const p of featuredPaths) assert.ok(!rest.includes(p), p);
  assert.ok(rest.includes("/night-all-over"));
  assert.ok(rest.includes("/gold-stripes"));
  assert.equal(rest.length + featuredPaths.length, shopCards().length);
  // same order as before for the rest
  assert.deepEqual(rest, shopCards().map((c) => c.href).filter((h) => !featuredPaths.includes(h)));
});

test("the home page renders Featured and the rest (no more 'Premium all-over' section)", () => {
  const src = readFileSync(path.join(ROOT, "app/page.tsx"), "utf8");
  assert.match(src, /featuredCards\(\)/);
  assert.match(src, /restCards\(\)/);
  assert.doesNotMatch(src, /groupSections/);
});
