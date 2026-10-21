// The Gulf Coast Tee (John 2026-10-20: approved for the shop). Printful sync product 483547766
// "MOP · Gulf Coast Tee" (catalog 1414, stitch white, set up like the Sky Tee's Daydream).
// One in, one out: it is NOT in the featured row; it follows the other all-overs in the grid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { getShopProduct, shopProducts } from "../lib/catalog/index.ts";
import { featured } from "../lib/catalog/copy.ts";
import { catalogFulfilment } from "../lib/catalog/fulfilment.generated.ts";
import { creditLinesFor, normalizeSelection, variantKey } from "../lib/catalog/select.ts";
import { creditText, creditedArtists, designFromCreditLines } from "../lib/artists.ts";
import { homeCards, shopCards } from "../lib/shop-cards.ts";
import { shareImages } from "../lib/share-images.generated.ts";
import { buildItem } from "../lib/orders/build-items.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const slugOf = (href: string) => href.split("?")[0].slice(1);
const CREDIT =
  'Photos: "surf", "view2" and "view" by Matt Billings, "Gulf of America" and "Northwest Florida" by Olin Gilbert, "White Sands – Pensacola Beach" by Tony Webster (CC BY 2.0); "Johnson\'s Beach Access E" by NPS/Breault (public domain); combined, retouched and colour-graded';
const SYNC = { XS: 5586098566, S: 5586098567, M: 5586098568, L: 5586098570, XL: 5586098571, "2XL": 5586098572 };

const coast = getShopProduct("coast-tee");
const present = !!coast;

test("the Gulf Coast Tee is on sale: $45 in XS–2XL, free shipping, an all-over like the Sky Tee", { skip: !present }, () => {
  const p = coast!;
  assert.equal(p.title, "Gulf Coast Tee");
  assert.equal(p.group, "allover");
  assert.equal(p.printfulCatalogProductId, 1414);
  assert.deepEqual(Object.keys(p.options), ["size"], "no picker yet: sizes only");
  assert.deepEqual(p.options.size, ["XS", "S", "M", "L", "XL", "2XL"]);
  assert.ok(p.variants.every((v) => v.price === 45 && v.status === "DECIDED"));
  assert.equal(p.sizeNote, getShopProduct("sky-tee")!.sizeNote);
  assert.equal(p.fabricNote, getShopProduct("sky-tee")!.fabricNote);
  const card = shopCards().find((c) => c.href === "/coast-tee")!;
  assert.equal(card.price, "$45");
  assert.ok(card.freeShipping);
});

test("each size maps to its Printful sync variant (product 483547766)", { skip: !present }, () => {
  for (const [size, id] of Object.entries(SYNC)) {
    assert.equal(catalogFulfilment["coast-tee"].variants[variantKey({ size })].syncVariantId, id, size);
    const { item } = buildItem("coast-tee", { size }, 1, {});
    assert.equal(item.unitAmount, 4500);
    assert.equal(item.printful?.syncVariantId, id);
  }
});

test("the description: John's intro, then the same garment bullets as the Sky Tee", { skip: !present }, () => {
  const intro =
    "The Gulf at Pensacola Beach: emerald water, sugar-white dunes and a big blue sky, printed edge to edge. The back is a different stretch of the same coast, lined up at the seams so the horizon runs all the way around.";
  const skyDetails = getShopProduct("sky-tee")!.description.split("\n\n").slice(1).join("\n\n");
  assert.equal(coast!.description, `${intro}\n\n${skyDetails}`);
  assert.match(skyDetails, /^- Printed edge to edge/);
});

test("the photo credit shows exactly as written, with no avatar (CC BY: unaltered)", { skip: !present }, () => {
  const lines = creditLinesFor(coast!, normalizeSelection(coast!));
  assert.deepEqual(lines, [CREDIT]);
  const design = designFromCreditLines(lines)!;
  assert.deepEqual(design.credits, [], "not a byline: no avatar, no bold name");
  assert.deepEqual(design.notes, [CREDIT]);
  assert.equal(creditText(design), CREDIT);
  assert.deepEqual(creditedArtists(design), []);
  // real bylines are unchanged
  assert.equal(designFromCreditLines(["Beanie by Janette Garcia"])!.credits[0].artist, "janette-garcia");
  assert.equal(designFromCreditLines(["Colour & design by MOP"])!.credits.length, 1);
});

test("not featured: it follows the other all-overs, below the featured row", { skip: !present }, () => {
  assert.ok(!featured.items.some((i) => i.slug === "coast-tee"));
  const order = homeCards().map((c) => slugOf(c.href));
  const at = order.indexOf("coast-tee");
  assert.ok(at >= featured.items.length, "below the featured row");
  const allovers = shopCards().filter((c) => c.group === "allover").map((c) => slugOf(c.href));
  assert.equal(allovers.at(-1), "coast-tee", "last of the all-overs");
  for (const s of allovers.slice(0, -1)) assert.ok(order.indexOf(s) < at, `${s} before it`);
  assert.equal(order[at - 1], "gold-stripes", "right after the last all-over in the grid");
});

test("photos, checkout JPEG and share image are on disk", { skip: !present }, () => {
  const set = coast!.images[0];
  assert.equal(set.images.length, 4, "model, model back, flat front, flat back");
  assert.match(set.images[0], /model-left-front/);
  for (const src of [...set.images, set.checkout!]) assert.ok(existsSync(path.join(ROOT, "public", src)), src);
  const share = (shareImages as Record<string, string>)["coast-tee"];
  assert.ok(share && existsSync(path.join(ROOT, "public", share)), "share image");
});

test("the feeds list all six sizes at $45", { skip: !present }, async () => {
  const { googleFeedXml } = await import("../lib/google-feed.ts");
  for (const flavor of ["google", "meta"] as const) {
    const xml = googleFeedXml(shopProducts, new Date(), flavor);
    const items = xml.split("<item>").filter((i) => i.includes("<g:item_group_id>coast-tee</g:item_group_id>"));
    assert.equal(items.length, 6, flavor);
    for (const i of items) {
      assert.match(i, /<g:price>45\.00 USD<\/g:price>/);
      assert.match(i, /Gulf Coast Tee/);
      assert.match(i, /\/images\/catalog\/coast-tee\//);
    }
  }
});
