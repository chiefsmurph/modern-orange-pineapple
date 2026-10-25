// The Bolt: a second design on the Original Star Tee (John 2026-10-21: "Sunshine hasn't responded so I say we go with
// it ourselves until/if she responds"). Same page, same slug, same card: a Design picker (Star / Bolt), star first.
// Printful sync products 483712974 "MOP · The Original Star Tee — Large — Bolt" and 483713041 "— Small — Bolt"
// (catalog 586, the star's colours, sizes and Printful prices; the Black shirt gets the cream-keyline print).
// Sunshine drew the star, not the bolt: her credit shows only on the star. Her $1.50 royalty applies to BOTH (John's
// call while he waits to hear back; add `when: { design: "star" }` to the royalty in catalog.json to stop it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getShopProduct } from "../lib/catalog/index.ts";
import { catalogFulfilment } from "../lib/catalog/fulfilment.generated.ts";
import {
  creditLinesFor,
  findVariant,
  imagesFor,
  normalizeSelection,
  optionNames,
  variantKey,
} from "../lib/catalog/select.ts";
import { optionTitle, valueLabel } from "../lib/catalog/copy.ts";
import { OPTION_ORDER } from "../lib/catalog/types.ts";
import { addedDefault, withoutAddedDefaults } from "../lib/catalog/added.ts";
import { designFromCreditLines } from "../lib/artists.ts";
import { shopCards } from "../lib/shop-cards.ts";
import { featuredCardImages } from "../lib/catalog/featured.generated.ts";
import { buildItem, CheckoutError } from "../lib/orders/build-items.ts";
import { royaltyRows, rulesFor } from "../lib/orders/royalties.ts";
import { buildOrderRecord } from "../lib/orders/session.ts";
import { feedId, googleFeedXml } from "../lib/google-feed.ts";
import { resolveMetaCart } from "../lib/orders/meta-checkout.ts";
import { designKey } from "../lib/likes.ts";
import { makeSession, printfulItem } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "original-star-tee";
const star = getShopProduct(SLUG)!;
const fv = catalogFulfilment[SLUG].variants;
// a few of the new Printful sync variants (products 483712974 / 483713041)
const BOLT_SYNC = {
  "bolt|large|White|M": 5587073343,
  "bolt|large|Black|M": 5587073331,
  "bolt|large|Red|4XL": 5587073372,
  "bolt|small|White|S": 5587073529,
  "bolt|small|Black|2XL": 5587073523,
  "bolt|small|Red|XL": 5587073528,
};
// the star's own, unchanged
const STAR_SYNC = { "star|large|White|S": 5567829355, "star|large|White|M": 5567829356, "star|small|Black|L": 5567830182 };

test("a Design picker on the same product: Star / Bolt, first, star by default", () => {
  assert.deepEqual(star.options.design, ["star", "bolt"]);
  assert.deepEqual(optionNames(star), ["design", "version", "color", "size"]);
  assert.equal(optionTitle("design"), "Design");
  assert.equal(valueLabel("design", "star", star.optionLabels), "Star");
  assert.equal(valueLabel("design", "bolt", star.optionLabels), "Bolt");
  assert.equal(normalizeSelection(star).design, "star");
  assert.equal(normalizeSelection(star, { design: "BOLT" }).design, "bolt");
  assert.equal(normalizeSelection(star, { design: "lightning" }).design, "star", "anything else falls back to the star");
  assert.equal(addedDefault(SLUG, "design"), star.options.design[0], "the added option's old value is its first value");
  // gen-catalog keeps its own copy of the picker order: it must be the same list
  const gen = /const OPTION_ORDER = (\[[^\]]*\])/.exec(readFileSync(path.join(ROOT, "scripts/gen-catalog.mjs"), "utf8"))![1];
  assert.deepEqual(JSON.parse(gen), [...OPTION_ORDER]);
});

test("the page, the home card and the featured card still show the star", () => {
  const first = imagesFor(star, normalizeSelection(star));
  assert.ok(first.length && first.every((src) => !/\/bolt-/.test(src)), "default photos are the star");
  const card = shopCards().find((c) => c.href.split("?")[0] === `/${SLUG}`)!;
  assert.ok(card, "one card, the same slug");
  assert.ok(!/bolt/.test(card.image), `card is the star: ${card.image}`);
  assert.equal(shopCards().filter((c) => c.href.split("?")[0] === `/${SLUG}`).length, 1, "no second product card");
  const f = featuredCardImages[SLUG];
  assert.ok(f && !/bolt/.test(f), `featured card is the star: ${f}`);
});

test("every bolt colour and print has its own real photos; the star keeps its own", () => {
  for (const version of star.options.version)
    for (const color of star.options.color) {
      const bolt = imagesFor(star, { design: "bolt", version, color });
      const own = imagesFor(star, { design: "star", version, color });
      const c = color.toLowerCase();
      assert.deepEqual(bolt.map((s) => s.replace(/\.[0-9a-f]{8}\.webp$/, "")),
        ["model-womens", "model-mens-2", "flat"].map((k) => `/images/catalog/${SLUG}/bolt-${version}-${c}-${k}`), `${version} ${color}`);
      assert.ok(own.every((s) => s.includes(`/${version}-${c}-`) && !s.includes("bolt-")), `star ${version} ${color}`);
      for (const src of [...bolt, ...own]) assert.ok(existsSync(path.join(ROOT, "public", src)), src);
    }
});

test("84 variants: the star's 42 as before plus 42 bolts at the star's prices, each with its own Printful variant", () => {
  assert.equal(star.variants.length, 84);
  const starIds = new Set<number>(), boltIds = new Set<number>();
  for (const v of star.variants) {
    const id = fv[variantKey(v.opts)]?.syncVariantId;
    assert.ok(Number.isInteger(id), variantKey(v.opts));
    (v.opts.design === "star" ? starIds : boltIds).add(id!);
    if (v.opts.design === "bolt") {
      const twin = findVariant(star, { ...v.opts, design: "star" })!;
      assert.equal(v.price, twin.price, `${variantKey(v.opts)} costs what the star costs`);
      assert.equal(fv[variantKey(v.opts)].catalogVariantId, fv[variantKey(twin.opts)].catalogVariantId, "same shirt");
    }
  }
  assert.equal(starIds.size, 42);
  assert.equal(boltIds.size, 42);
  assert.ok(Array.from(boltIds).every((id) => !starIds.has(id)), "bolt never prints from a star variant");
  for (const [k, id] of Object.entries({ ...BOLT_SYNC, ...STAR_SYNC })) assert.equal(fv[k]?.syncVariantId, id, k);
});

test("checkout: Bolt sells the bolt; a pick made before the Design picker existed is the star", () => {
  const bolt = buildItem(SLUG, { design: "bolt", version: "large", color: "Black", size: "M" }, 1, {});
  assert.equal(bolt.item.printful?.syncVariantId, BOLT_SYNC["bolt|large|Black|M"]);
  assert.equal(bolt.item.opts.design, "bolt");
  assert.match(bolt.description, /^Design: Bolt, Print: Big, Color: Black, Size: M$/);
  assert.match(bolt.image, /\/bolt-large-black-model-womens\.[0-9a-f]{8}-checkout\.jpg$/);
  // an old bag line / link without `design`
  const old = buildItem(SLUG, { version: "large", color: "White", size: "M" }, 1, {});
  assert.equal(old.item.printful?.syncVariantId, STAR_SYNC["star|large|White|M"]);
  assert.equal(old.item.opts.design, "star");
  assert.equal(old.item.unitAmount, 3473);
  assert.throws(() => buildItem(SLUG, { design: "moon", version: "large", color: "White", size: "M" }, 1, {}), CheckoutError);
});

test("credits: Sunshine on the star only; the bolt shows no artist credit", () => {
  const starLines = creditLinesFor(star, normalizeSelection(star));
  assert.deepEqual(starLines, ["Original star by Sunshine Austina", "Colour & design by MOP"]);
  assert.equal(designFromCreditLines(starLines)!.credits[0].artist, "sunshine-austina");
  for (const version of star.options.version)
    for (const color of star.options.color) {
      const lines = creditLinesFor(star, { design: "bolt", version, color });
      assert.deepEqual(lines, [], `${version} ${color}`);
      assert.equal(designFromCreditLines(lines), undefined, "no credit block at all");
    }
});

test("royalties: Sunshine's $1.50 applies to bolt sales too (until John says otherwise), and to old star orders", async () => {
  assert.deepEqual(rulesFor(SLUG), [{ artist: "sunshine", perItem: 1.5 }]);
  const rec = await buildOrderRecord(makeSession([
    printfulItem({ slug: SLUG, title: "The Original Star Tee", opts: { design: "bolt", version: "large", color: "Black", size: "M" }, qty: 2 }),
    printfulItem({ slug: SLUG, title: "The Original Star Tee", opts: { design: "star", version: "small", color: "Red", size: "L" } }),
    printfulItem({ slug: SLUG, title: "The Original Star Tee", opts: { version: "large", color: "White", size: "S" } }),
  ]));
  const rows = royaltyRows(rec, "2026-10-21T00:00:00Z", {});
  assert.deepEqual(rows.map((r) => [r.artist, r.options.design ?? "(none)", r.amount]),
    [["sunshine", "bolt", 3], ["sunshine", "star", 1.5], ["sunshine", "(none)", 1.5]]);
});

test("feeds, bags and Meta carts: every star id stays exactly as before; the bolts get their own", () => {
  const ids = star.variants.map((v) => feedId(SLUG, v.opts));
  assert.equal(new Set(ids).size, 84, "no two variants share an id");
  const was = (o: Record<string, string>) =>
    [SLUG, o.version, o.color, o.size].join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  for (const v of star.variants) {
    const id = feedId(SLUG, v.opts);
    if (v.opts.design === "star") assert.equal(id, was(v.opts), "the id Google, Meta and old bags have");
    else assert.equal(id, was(v.opts).replace(`${SLUG}-`, `${SLUG}-bolt-`));
  }
  assert.equal(feedId(SLUG, { design: "star", version: "large", color: "White", size: "S" }), "original-star-tee-large-white-s");
  const xml = googleFeedXml([star]);
  assert.equal((xml.match(/<item>/g) ?? []).length, 84);
  assert.match(xml, /<g:id>original-star-tee-bolt-large-black-m<\/g:id>/);
  assert.match(xml, /<g:title>The Original Star Tee - Bolt, Big print, Black, size M<\/g:title>/);
  assert.match(xml, /original-star-tee\?design=bolt&amp;version=large&amp;color=Black&amp;size=M/);
  const { priced, skipped } = resolveMetaCart([
    { id: "original-star-tee-large-white-m", qty: 1 },
    { id: "original-star-tee-bolt-small-red-xl", qty: 1 },
  ], {});
  assert.deepEqual(skipped, []);
  assert.deepEqual(priced.map((p) => p.item.printful?.syncVariantId), [STAR_SYNC["star|large|White|M"], BOLT_SYNC["bolt|small|Red|XL"]]);
});

test("likes: a like on the star from before the Bolt is the same like; the bolt is its own design", () => {
  const before = designKey({ version: "large", color: "White" });
  assert.equal(designKey(withoutAddedDefaults(SLUG, { design: "star", version: "large", color: "White", size: "M" })), before);
  assert.equal(designKey(withoutAddedDefaults(SLUG, { design: "bolt", version: "large", color: "White" })), "color=White&design=bolt&version=large");
  assert.deepEqual(withoutAddedDefaults("pelican-tee", { style: "beanie" }), { style: "beanie" }, "other products untouched");
});
