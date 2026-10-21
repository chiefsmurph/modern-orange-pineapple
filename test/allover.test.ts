// The Premium all-over line (Printful 1414): home section, sky picker, cross-links,
// metadata and royalties (John said yes, 2026-10-12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { getShopProduct, crossLinkFor } from "../lib/catalog/index.ts";
import { catalogFulfilment } from "../lib/catalog/fulfilment.generated.ts";
import { creditLinesFor, findVariant, normalizeSelection, variantKey } from "../lib/catalog/select.ts";
import { shopCards, skySwatches } from "../lib/shop-cards.ts";
import { buildItem, itemSummary } from "../lib/orders/build-items.ts";
import { itemsFromSessionMetadata, sessionMetadata } from "../lib/orders/metadata.ts";
import { royaltyRows } from "../lib/orders/royalties.ts";
import { buildOrderRecord } from "../lib/orders/session.ts";
import { makeSession } from "./helpers.ts";

const ALLOVER = ["day-all-over", "dusk-all-over", "night-all-over", "sky-tee", "gold-stripes", "coast-tee"];
const present = ALLOVER.every((s) => getShopProduct(s));

const recordFor = async (slug: string, opts: Record<string, string>) =>
  buildOrderRecord(makeSession([buildItem(slug, opts, 1, {}).item]));

test("all six all-overs (the Gulf Coast Tee joined 10/20) are in the catalog: $45 (John 10/20 after the price comps; $44 from 10/12, $49 before), XS–2XL, group allover, Printful", { skip: !present }, () => {
  for (const slug of ALLOVER) {
    const p = getShopProduct(slug)!;
    assert.equal(p.group, "allover", slug);
    assert.equal(p.printfulCatalogProductId, 1414, slug);
    assert.deepEqual(p.options.size, ["XS", "S", "M", "L", "XL", "2XL"], slug);
    assert.ok(p.variants.every((v) => v.price === 45 && v.status === "DECIDED"), `${slug} prices`);
    assert.equal(p.sizeNote, "96% cotton, 4% elastane · runs slim — size up");
    assert.equal(p.delivery, "printful");
  }
});

test("all-over cards: $45, group allover; the Sky Tee card shows its skies", { skip: !present }, () => {
  const cards = shopCards().filter((c) => c.group === "allover");
  assert.deepEqual(cards.map((c) => c.href), ALLOVER.map((s) => `/${s}`));
  for (const c of cards) assert.equal(c.price, "$45");
  const sky = cards.find((c) => c.href === "/sky-tee")!;
  assert.equal(sky.swatches?.length, getShopProduct("sky-tee")!.options.sky.length);
  assert.equal(skySwatches(getShopProduct("day-all-over")!).length, 0);
});

test("every all-over variant builds a Printful item whose metadata round-trips", { skip: !present }, () => {
  for (const slug of ALLOVER) {
    const p = getShopProduct(slug)!;
    for (const v of p.variants) {
      const { item } = buildItem(slug, v.opts, 1, {});
      assert.equal(item.supplier, "printful");
      assert.equal(item.unitAmount, 4500);
      assert.equal(item.printful?.syncVariantId, catalogFulfilment[slug].variants[variantKey(v.opts)].syncVariantId);
      assert.deepEqual(itemsFromSessionMetadata(sessionMetadata([item])), [item]);
    }
  }
});

test("royalties: Janette on the Day Grind Beanie only, Austin on Dusk, nobody on Night", { skip: !present }, async () => {
  const day = getShopProduct("day-all-over")!;
  const beanie = await recordFor("day-all-over", { ...normalizeSelection(day), style: "beanie", size: "M" } as Record<string, string>);
  const classic = await recordFor("day-all-over", { ...normalizeSelection(day), style: "classic", size: "M" } as Record<string, string>);
  assert.deepEqual(royaltyRows(beanie, "t", {}).map((r) => [r.artist, r.amount]), [["janette", 1.5]]);
  assert.deepEqual(royaltyRows(classic, "t", {}), []);
  const dusk = await recordFor("dusk-all-over", { ...normalizeSelection(getShopProduct("dusk-all-over")!), size: "L" } as Record<string, string>);
  assert.deepEqual(royaltyRows(dusk, "t", {}).map((r) => [r.artist, r.amount]), [["austin", 1.5]]);
  const night = await recordFor("night-all-over", { ...normalizeSelection(getShopProduct("night-all-over")!), size: "S" } as Record<string, string>);
  assert.deepEqual(royaltyRows(night, "t", {}), []);
});

test("credits follow the pick: the beanie credit on Day Grind Beanie, a credit per sky on the Sky Tee", { skip: !present }, () => {
  const day = getShopProduct("day-all-over")!;
  assert.ok(creditLinesFor(day, { ...normalizeSelection(day), style: "beanie" }).includes("Beanie by Janette Garcia"));
  assert.ok(!creditLinesFor(day, { ...normalizeSelection(day), style: "classic" }).includes("Beanie by Janette Garcia"));
  // the sky's own credit shows on both styles (catalog `credits`, each line with its own condition)
  assert.ok(creditLinesFor(day, { ...normalizeSelection(day), style: "classic" }).some((l) => /McPherson/.test(l)));
  const sky = getShopProduct("sky-tee")!;
  const seen = new Set<string>();
  for (const s of sky.options.sky) {
    const sel = { ...normalizeSelection(sky), sky: s };
    assert.ok(findVariant(sky, { ...sel, size: "M" }), `${s}: variant`);
    const lines = creditLinesFor(sky, sel);
    assert.equal(lines.length, 1, `${s}: one credit line`);
    seen.add(lines[0]);
  }
  assert.ok(seen.size > 1, "different skies credit different sources");
});

test("Sky picker values show their labels (catalog option_labels) on the page, in Stripe and in emails", { skip: !present }, () => {
  const sky = getShopProduct("sky-tee")!;
  assert.equal(sky.optionLabels?.sky?.["orbital-sunset"], "Orbital Sunset");
  const { item, description } = buildItem("sky-tee", { sky: "orbital-sunset", size: "M" }, 1, {});
  assert.equal(item.opts.sky, "orbital-sunset"); // the key stays the code
  assert.equal(description, "Sky: Orbital Sunset, Size: M");
  assert.equal(itemSummary(item), "Orbital Sunset · M");
  assert.equal(shopCards().find((c) => c.href === "/sky-tee")!.swatches![0].label, "Daydream");
});

test("cross-links: pelican → Day (style carried), alpaca → Dusk, rabbit → Night", { skip: !present }, () => {
  assert.deepEqual(crossLinkFor("pelican-tee", { version: "large", style: "beanie", color: "Ivory" }), {
    text: "Also as an all-over: Day",
    href: "/day-all-over?style=beanie",
  });
  assert.equal(crossLinkFor("alpaca-tee", { version: "small" })?.href, "/dusk-all-over");
  assert.equal(crossLinkFor("rabbit-tee", {})?.href, "/night-all-over");
  assert.equal(crossLinkFor("star-polo", {}), null);
});

test("$45 all the way through: feeds, Meta checkout and the Stripe line item", { skip: !present }, async () => {
  const { googleFeedXml, feedId } = await import("../lib/google-feed.ts");
  const { shopProducts } = await import("../lib/catalog/index.ts");
  const { checkoutSessionParams } = await import("../lib/orders/checkout.ts");
  const { resolveMetaCart } = await import("../lib/orders/meta-checkout.ts");
  for (const flavor of ["google", "meta"] as const) {
    const xml = googleFeedXml(shopProducts, new Date(), flavor);
    for (const slug of ALLOVER) {
      const items = xml.split("<item>").filter((i) => i.includes(`<g:item_group_id>${slug}</g:item_group_id>`));
      assert.ok(items.length > 0, slug);
      for (const i of items) assert.match(i, /<g:price>45\.00 USD<\/g:price>/, `${flavor} ${slug}`);
    }
  }
  for (const slug of ALLOVER) {
    const v = getShopProduct(slug)!.variants[0];
    assert.equal(checkoutSessionParams(buildItem(slug, v.opts, 1, {})).line_items![0].price_data!.unit_amount, 4500, slug);
    assert.equal(resolveMetaCart([{ id: feedId(slug, v.opts), qty: 1 }], {}).priced[0].item.unitAmount, 4500, slug);
  }
});
