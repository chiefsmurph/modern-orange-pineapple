// The Grind Beanie is the pelican's default style (John, 2026-10-16): the Pelican
// Tee and the Pelican Crop Top open on it, their home cards and link previews show
// it, and Classic is the alternative (?style=classic). Royalties don't change.
import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";
import { getShopProduct } from "../lib/catalog/index.ts";
import { creditLinesFor, imagesFor, normalizeSelection } from "../lib/catalog/select.ts";
import { rulesFor } from "../lib/orders/royalties.ts";
import { shopCards } from "../lib/shop-cards.ts";

const PELICANS = ["pelican-tee", "pelican-crop-top"];
const present = PELICANS.every((s) => getShopProduct(s));
const fromQuery = (q: string) => Object.fromEntries(new URLSearchParams(q));

test("the pelican tee and crop top open on the Grind Beanie; Classic comes second", { skip: !present }, () => {
  for (const slug of PELICANS) {
    const p = getShopProduct(slug)!;
    assert.deepEqual(p.options.style, ["beanie", "classic"], slug);
    const sel = normalizeSelection(p);
    assert.equal(sel.style, "beanie", slug);
    assert.match(imagesFor(p, sel)[0], /\/(large-)?beanie-/, slug);
    assert.deepEqual(creditLinesFor(p, sel), ["Beanie by Janette Garcia"], slug);
  }
});

test("?style=classic still selects Classic (no beanie credit)", { skip: !present }, () => {
  for (const slug of PELICANS) {
    const p = getShopProduct(slug)!;
    const sel = normalizeSelection(p, fromQuery("style=classic"));
    assert.equal(sel.style, "classic", slug);
    assert.match(imagesFor(p, sel)[0], /\/(large-)?classic-/, slug);
    assert.deepEqual(creditLinesFor(p, sel), [], slug);
  }
});

test("the home cards show the beanie pelican", { skip: !present }, () => {
  for (const slug of PELICANS) {
    const card = shopCards().find((c) => c.href.split("?")[0] === `/${slug}`);
    assert.ok(card, slug);
    assert.match(card.image, /\/(large-)?beanie-/, slug);
  }
});

test("the old $27 pelican still lands on the beanie style", { skip: !present }, async () => {
  const r = (await nextConfig.redirects!()).find((x) => x.source === "/pelican-beanie-t-shirt");
  assert.equal(r?.destination, "/pelican-tee?style=beanie");
  const p = getShopProduct("pelican-tee")!;
  assert.equal(normalizeSelection(p, fromQuery(r!.destination.split("?")[1])).style, "beanie");
});

test("royalties unchanged: only the beanie style pays Janette $1.50", { skip: !present }, () => {
  for (const slug of PELICANS)
    assert.deepEqual(rulesFor(slug), [{ artist: "janette", perItem: 1.5, when: { style: "beanie" } }], slug);
  // the Day all-over was already beanie-first; the pelican polo has no style picker
  assert.deepEqual(getShopProduct("day-all-over")?.options.style, ["beanie", "classic"]);
  assert.equal(getShopProduct("pelican-polo")?.options.style, undefined);
});
