// The merged Rabbit Crop Top (2026-10-30): one page, /rabbit-crop-top, with
// White + Black (AS Colour 4062, XS-XL, $33.46) and Washed Black (Bella+Canvas
// 6882GD, S-2XL, $34.46 / 2XL $36.46). Replaces the separate
// rabbit-crop-top-classic page (now a 301 to ?color=White).
import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";
import { getShopProduct, shopProducts } from "../lib/catalog/index.ts";
import { catalogFulfilment } from "../lib/catalog/fulfilment.generated.ts";
import {
  catalogProductIdFor,
  catalogProductIdsFor,
  isAvailable,
  normalizeSelection,
  variantKey,
} from "../lib/catalog/select.ts";
import { sizeGuides } from "../lib/catalog/sizes.generated.ts";
import { googleFeedXml } from "../lib/google-feed.ts";
import { buildItem } from "../lib/orders/build-items.ts";
import { handleStripeEvent } from "../lib/orders/process.ts";
import { makeDeps, makeEvent, makeSession, printfulItem, happyResponder, fakeFetch, tmpDir } from "./helpers.ts";

const p = getShopProduct("rabbit-crop-top")!;

// All 10 (color, size) combinations this product actually sells, each with its
// real Printful sync variant id, catalog product id and retail price.
const CASES: { color: string; size: string; syncVariantId: number; catalogId: number; price: number }[] = [
  { color: "White", size: "XS", syncVariantId: 5607252365, catalogId: 636, price: 33.46 },
  { color: "White", size: "S", syncVariantId: 5607252366, catalogId: 636, price: 33.46 },
  { color: "White", size: "M", syncVariantId: 5607252367, catalogId: 636, price: 33.46 },
  { color: "White", size: "L", syncVariantId: 5607252368, catalogId: 636, price: 33.46 },
  { color: "White", size: "XL", syncVariantId: 5607252369, catalogId: 636, price: 33.46 },
  { color: "Black", size: "XS", syncVariantId: 5607252370, catalogId: 636, price: 33.46 },
  { color: "Black", size: "S", syncVariantId: 5607252371, catalogId: 636, price: 33.46 },
  { color: "Black", size: "M", syncVariantId: 5607252376, catalogId: 636, price: 33.46 },
  { color: "Black", size: "L", syncVariantId: 5607252388, catalogId: 636, price: 33.46 },
  { color: "Black", size: "XL", syncVariantId: 5607252399, catalogId: 636, price: 33.46 },
  { color: "Washed Black", size: "S", syncVariantId: 5607311890, catalogId: 1579, price: 34.46 },
  { color: "Washed Black", size: "M", syncVariantId: 5607311892, catalogId: 1579, price: 34.46 },
  { color: "Washed Black", size: "L", syncVariantId: 5607311893, catalogId: 1579, price: 34.46 },
  { color: "Washed Black", size: "XL", syncVariantId: 5607311895, catalogId: 1579, price: 34.46 },
  { color: "Washed Black", size: "2XL", syncVariantId: 5607311896, catalogId: 1579, price: 36.46 },
];

test("one merged product, three colours, sizes vary by colour", () => {
  assert.equal(p.title, "Rabbit Crop Top");
  assert.deepEqual(p.options.color, ["White", "Black", "Washed Black"]);
  assert.deepEqual(p.options.size, ["XS", "S", "M", "L", "XL", "2XL"]);
  assert.equal(p.variants.length, 15);
  // the old classic product is gone, replaced by this one
  assert.equal(getShopProduct("rabbit-crop-top-classic"), undefined);
  // exactly one card/page for the merged product in the real line-up
  assert.equal(shopProducts.filter((x) => x.slug === "rabbit-crop-top").length, 1);
});

test("size availability follows colour: White/Black have no 2XL, Washed Black has no XS", () => {
  const whiteSel = normalizeSelection(p, { color: "White" });
  assert.ok(!isAvailable(p, whiteSel, "size", "2XL"));
  for (const s of ["XS", "S", "M", "L", "XL"]) assert.ok(isAvailable(p, whiteSel, "size", s), s);

  const blackSel = normalizeSelection(p, { color: "Black" });
  assert.ok(!isAvailable(p, blackSel, "size", "2XL"));

  const washedSel = normalizeSelection(p, { color: "Washed Black" });
  assert.ok(!isAvailable(p, washedSel, "size", "XS"));
  for (const s of ["S", "M", "L", "XL", "2XL"]) assert.ok(isAvailable(p, washedSel, "size", s), s);

  // invalid combinations simply don't exist as variants
  assert.ok(!p.variants.some((v) => v.opts.color === "White" && v.opts.size === "2XL"));
  assert.ok(!p.variants.some((v) => v.opts.color === "Washed Black" && v.opts.size === "XS"));
});

test("every (colour, size) combo: price + Printful sync variant id resolve correctly (10 for White/Black, 5 for Washed Black)", () => {
  assert.equal(CASES.length, 10 + 5);
  for (const c of CASES) {
    const key = variantKey({ color: c.color, size: c.size });
    const entry = catalogFulfilment["rabbit-crop-top"].variants[key];
    assert.equal(entry.syncVariantId, c.syncVariantId, key);

    const { item } = buildItem("rabbit-crop-top", { color: c.color, size: c.size }, 1, {});
    assert.equal(item.unitAmount, Math.round(c.price * 100), key);
    assert.equal(item.printful?.syncVariantId, c.syncVariantId, key);

    const variant = p.variants.find((v) => v.opts.color === c.color && v.opts.size === c.size)!;
    assert.equal(catalogProductIdFor(p, variant.opts), c.catalogId, key);
  }
});

test("catalogProductIdsFor finds both blanks; each has its own size guide with a fit note", () => {
  assert.deepEqual(catalogProductIdsFor(p).sort((a, b) => a - b), [636, 1579]);
  for (const id of [636, 1579]) {
    assert.ok(sizeGuides[id], `${id}: no size guide`);
    assert.ok(sizeGuides[id].fit, `${id}: fit note`);
  }
});

test("description names both fabrics: Washed Black is garment-dyed ring-spun cotton, White/Black is its own AS Colour fabric", () => {
  assert.match(p.description, /garment-dyed 100% ring-spun cotton/);
  assert.match(p.description, /100% combed cotton/); // AS Colour 4062, the White/Black blank
  assert.notEqual(
    p.description.match(/garment-dyed 100% ring-spun cotton/)?.index,
    p.description.match(/100% combed cotton/)?.index
  );
});

test("/rabbit-crop-top-classic redirects permanently to the merged page's White pick", async () => {
  const redirects = await nextConfig.redirects!();
  const r = redirects.find((x) => x.source === "/rabbit-crop-top-classic");
  assert.deepEqual(r, { source: "/rabbit-crop-top-classic", destination: "/rabbit-crop-top?color=White", statusCode: 301 });
  // a new checkout attempt on the retired slug is refused
  const { checkoutBlock } = await import("../lib/orders/build-items.ts");
  assert.deepEqual(checkoutBlock("rabbit-crop-top-classic"), { status: 410, error: "no longer available" });
});

test("Google/Meta feeds: one item_group for the merged product, 15 variant items, no live classic-slug items", () => {
  for (const flavor of ["google", "meta"] as const) {
    const xml = googleFeedXml(shopProducts, new Date("2026-10-30T12:00:00Z"), flavor);
    const groups = [...xml.matchAll(/<g:item_group_id>rabbit-crop-top<\/g:item_group_id>/g)];
    assert.equal(groups.length, 15, flavor);
    // no live item references the old classic slug as its own product (its photo
    // files, unchanged, still live in a directory of that name — that's fine)
    assert.doesNotMatch(xml, /<g:item_group_id>rabbit-crop-top-classic<\/g:item_group_id>/, flavor);
    assert.doesNotMatch(xml, /<g:link>[^<]*\/rabbit-crop-top-classic[?"]/, flavor);
    // prices and colours show up correctly for each blank
    assert.match(xml, /<g:price>33\.46 USD<\/g:price>/);
    assert.match(xml, /<g:price>34\.46 USD<\/g:price>/);
    assert.match(xml, /<g:price>36\.46 USD<\/g:price>/);
    assert.match(xml, /<g:color>White<\/g:color>/);
    assert.match(xml, /<g:color>Black<\/g:color>/);
    assert.match(xml, /<g:color>Washed Black<\/g:color>/);
  }
});

test("ORDER_DRY_RUN: one variant of each colour resolves to the right sync product/variant, nothing sent to Printful", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  const deps = makeDeps(dir, fetch, { ORDER_DRY_RUN: "1" });

  const picks = [
    { color: "White", size: "M", expectSync: 5607252367 }, // sync product 487473756
    { color: "Black", size: "M", expectSync: 5607252376 }, // same sync product, different variant
    { color: "Washed Black", size: "M", expectSync: 5607311892 }, // sync product 487487076
  ];

  for (const [i, pick] of picks.entries()) {
    const { item } = buildItem("rabbit-crop-top", pick, 1, {});
    assert.equal(item.printful?.syncVariantId, pick.expectSync, pick.color);
    const session = makeSession(
      [
        printfulItem({
          slug: "rabbit-crop-top",
          title: "Rabbit Crop Top",
          opts: { color: pick.color, size: pick.size },
          unitAmount: item.unitAmount,
          printful: { syncVariantId: pick.expectSync },
        }),
      ],
      // a distinct session id per pick: the store refuses to re-process the same session id twice
      { id: `cs_test_rabbit_${i}_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ0123456789abcdefghijklmnop` }
    );
    const res = await handleStripeEvent(makeEvent(session), deps);
    assert.equal(res.status, 200, pick.color);
  }

  // no real Printful (or any) API call was made — every order was dry-run only
  assert.equal(calls.length, 0);
  const dryRunLogs = deps.logs.filter((l) => l.startsWith("[orders] DRY-RUN Printful POST"));
  assert.equal(dryRunLogs.length, 3);
  for (const [i, pick] of picks.entries()) {
    const jsonStart = dryRunLogs[i].indexOf("\n") + 1;
    const body = JSON.parse(dryRunLogs[i].slice(jsonStart));
    assert.equal(body.items[0].sync_variant_id, pick.expectSync, pick.color);
    // eslint-disable-next-line no-console
    console.log(`[dry-run] ${pick.color} ${pick.size} ->`, JSON.stringify(body, null, 2));
  }
});
