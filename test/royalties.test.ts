import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRates, royaltyRows, rulesFor } from "../lib/orders/royalties.ts";
import { buildOrderRecord } from "../lib/orders/session.ts";
import { catalogFulfilment } from "../lib/catalog/fulfilment.generated.ts";
import type { RoyaltyRule } from "../lib/catalog/types.ts";
import { makeSession, printfulItem, yoycolItem } from "./helpers.ts";

// The spec's rules, as the Printful agent writes them into catalog.json.
const specRules: Record<string, RoyaltyRule[]> = {
  "pelican-tee": [{ artist: "janette", perItem: 1.5, when: { style: "beanie" } }],
  "alpaca-tee": [{ artist: "austin", perItem: 1.5 }],
  "star-snapback": [{ artist: "sunshine", perItem: 1.5 }],
};
const rules = (slug: string) => specRules[slug] ?? [];

const record = async (items) => buildOrderRecord(makeSession(items));

test("Grind Beanie items pay Janette; Classic pays nobody", async () => {
  const beanie = await record([printfulItem({ slug: "pelican-tee" })]);
  const classic = await record([printfulItem({ slug: "pelican-tee", opts: { version: "large", style: "classic", color: "Ivory", size: "M" } })]);
  const rows = royaltyRows(beanie, "2026-10-12T00:00:00Z", {}, rules);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].artist, "janette");
  assert.equal(rows[0].amount, 1.5);
  assert.equal(rows[0].order_ref, beanie.order_ref);
  assert.equal(royaltyRows(classic, "t", {}, rules).length, 0);
});

test("royalty is per item: qty 3 alpaca = $4.50; Yoycol clouds = nothing", async () => {
  const r = await record([printfulItem({ slug: "alpaca-tee", qty: 3, opts: { version: "small", color: "Blue Jean", size: "L" } }), yoycolItem()]);
  const rows = royaltyRows(r, "t", {}, rules);
  assert.deepEqual(rows.map((x) => [x.artist, x.qty, x.amount]), [["austin", 3, 4.5]]);
});

test("Sunshine's rate is configurable (MOP_ROYALTY_RATES)", async () => {
  const r = await record([printfulItem({ slug: "star-snapback", opts: { color: "Navy" } })]);
  assert.equal(royaltyRows(r, "t", {}, rules)[0].amount, 1.5);
  assert.equal(royaltyRows(r, "t", { MOP_ROYALTY_RATES: "sunshine=2.25" }, rules)[0].amount, 2.25);
  // a first-word key matches a longer artist id
  const long = (slug: string) => (slug === "star-snapback" ? [{ artist: "sunshine-austina", perItem: 1.5 }] : []);
  assert.equal(royaltyRows(r, "t", { MOP_ROYALTY_RATES: "sunshine=2" }, long)[0].amount, 2);
  assert.deepEqual(parseRates("a=1, b = 2.5,bad,c=-1"), { a: 1, b: 2.5 });
});

test("the old $27 Pelican With Beanie tee pays Janette too", async () => {
  const r = await record([printfulItem({ slug: "pelican-beanie-t-shirt", supplier: "manual", printful: undefined, opts: { size: "M", color: "White" } })]);
  assert.deepEqual(royaltyRows(r, "t", {}).map((x) => [x.artist, x.amount]), [["janette", 1.5]]);
});

test("generated catalog royalties follow the spec", { skip: Object.keys(catalogFulfilment).length === 0 }, () => {
  for (const [slug, f] of Object.entries(catalogFulfilment)) {
    const artists = f.royalties.map((r) => r.artist.toLowerCase());
    for (const r of f.royalties) assert.equal(r.perItem, 1.5, `${slug}: ${r.artist} rate`);
    if (/alpaca/.test(slug)) assert.ok(artists.some((a) => a.startsWith("austin")), `${slug}: Austin`);
    if (/star/.test(slug)) assert.ok(artists.some((a) => a.startsWith("sunshine")), `${slug}: Sunshine`);
    if (/nolli|rabbit/.test(slug)) assert.equal(artists.length, 0, `${slug}: nobody`);
    for (const r of f.royalties)
      if (r.artist.toLowerCase().startsWith("janette"))
        assert.ok(r.when && /beanie/i.test(Object.values(r.when).join()), `${slug}: Janette only on the beanie style`);
    assert.deepEqual(rulesFor(slug), f.royalties);
  }
});
