// Conversion pack: promotion codes, the welcome code, size guides, the Google feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildItem } from "../lib/orders/build-items.ts";
import { checkoutSessionParams } from "../lib/orders/checkout.ts";
import { createSubscriberStore, handleSubscribe } from "../lib/subscribers.ts";
import { shopProducts, getShopProduct } from "../lib/catalog/index.ts";
import { sizeGuides } from "../lib/catalog/sizes.generated.ts";
import { googleFeedXml, feedId, categoryFor, genderFor } from "../lib/google-feed.ts";
import legacy from "../public/products.ts";
import { tmpDir } from "./helpers.ts";

test("Checkout shows 'Add promotion code'; nothing else about the price changes", () => {
  const p = shopProducts[0];
  const params = checkoutSessionParams(buildItem(p.slug, p.variants[0].opts, 1, {}));
  assert.equal(params.allow_promotion_codes, true);
  assert.equal(params.discounts, undefined); // no code applied unless the customer adds one
  assert.equal(params.line_items![0].price_data!.unit_amount, Math.round(p.variants[0].price * 100));
});

test("signup returns the welcome code (new or repeat) only when it's configured", async () => {
  const base = { allow: () => true, productExists: () => false, now: () => new Date(), log: () => {}, notify: async () => {} };
  const req = { ip: "1.2.3.4", userAgent: "x" };
  const store = createSubscriberStore(tmpDir());
  const on = { ...base, store, welcomeCode: "WELCOME10" };
  assert.deepEqual((await handleSubscribe({ email: "a@example.com" }, req, on)).body, { ok: true, code: "WELCOME10" });
  assert.deepEqual((await handleSubscribe({ email: "A@example.com" }, req, on)).body, { ok: true, code: "WELCOME10" });
  const off = { ...base, store: createSubscriberStore(tmpDir()) };
  assert.deepEqual((await handleSubscribe({ email: "a@example.com" }, req, off)).body, { ok: true });
  assert.deepEqual((await handleSubscribe({ email: "bot@example.com", website: "x" }, req, on)).body, { ok: true }); // not for bots
});

test("every garment in the shop has a size guide covering its sizes, with a fit note", () => {
  for (const p of shopProducts) {
    const g = sizeGuides[p.printfulCatalogProductId!];
    assert.ok(g, `${p.slug}: no size guide`);
    assert.ok(g.fit, `${p.slug}: fit note`);
    for (const s of p.options.size ?? []) assert.ok(g.rows.some((r) => r.values[s]), `${p.slug}: ${s}`);
    for (const r of g.rows) assert.doesNotMatch(r.label, /^[A-F]$/, `${p.slug}: unnamed column`);
  }
  assert.equal(sizeGuides[586].fit, "Relaxed, heavyweight; true to size.");
  assert.equal(sizeGuides[1414].fit, "Runs slim — size up.");
  assert.deepEqual(sizeGuides[586].rows.map((r) => r.label), ["Length", "Chest width (laid flat)", "Sleeve length"]);
  assert.equal(sizeGuides[586].rows[1].values.M, "20¼");
});

test("Google feed: one item per variant, every required field, valid XML", () => {
  const xml = googleFeedXml(shopProducts, new Date("2026-10-12T20:00:00Z"));
  const items = xml.split("<item>").slice(1);
  assert.equal(items.length, shopProducts.reduce((n, p) => n + p.variants.length, 0));
  const ids = new Set<string>();
  for (const it of items) {
    for (const tag of ["id", "item_group_id", "title", "description", "link", "image_link", "price", "availability", "condition", "brand", "identifier_exists", "google_product_category", "size", "gender", "age_group", "shipping"])
      assert.match(it, new RegExp(`<g:${tag}>`), `missing g:${tag}`);
    const id = /<g:id>([^<]+)<\/g:id>/.exec(it)![1];
    assert.ok(id.length <= 50, id);
    assert.ok(!ids.has(id), `duplicate ${id}`);
    ids.add(id);
    assert.match(it, /<g:link>https:\/\/mopclothing\.com\/[a-z0-9-]+\?/);
    assert.match(it, /<g:image_link>https:\/\/mopclothing\.com\/images\/catalog\/.+-checkout\.jpg<\/g:image_link>/);
    assert.match(it, /<g:availability>in_stock<\/g:availability>/);
    assert.match(it, /<g:brand>Modern Orange Pineapple<\/g:brand>/);
    assert.match(it, /<g:shipping><g:country>US<\/g:country><g:service>Standard<\/g:service><g:price>0.00 USD<\/g:price><\/g:shipping>/);
  }
  // nothing that's off sale
  for (const p of legacy.products.filter((x) => x.retired || x.comingSoon))
    assert.doesNotMatch(xml, new RegExp(`<g:item_group_id>${p.id}</g:item_group_id>`), p.id);
  // a pelican variant links with its picks preselected
  const pel = getShopProduct("pelican-tee")!;
  const v = pel.variants.find((x) => x.opts.style === "beanie" && x.opts.color === "Ivory" && x.opts.size === "M" && x.opts.version === "large")!;
  const item = items.find((i) => i.includes(`<g:id>${feedId("pelican-tee", v.opts)}</g:id>`))!;
  assert.match(item, /<g:link>https:\/\/mopclothing\.com\/pelican-tee\?version=large&amp;style=beanie&amp;color=Ivory&amp;size=M<\/g:link>/);
  assert.match(item, /<g:title>Pelican Tee - Big print, Grind Beanie, Ivory, size M<\/g:title>/);
  assert.match(item, /<g:color>Ivory<\/g:color>/);
  assert.equal(genderFor(getShopProduct("pelican-crop-top")!), "female");
  assert.equal(categoryFor(getShopProduct("star-snapback")!), "Apparel & Accessories > Clothing Accessories > Hats");
  // well-formed XML (xmllint where it exists)
  const file = path.join(os.tmpdir(), `mop-feed-${process.pid}.xml`);
  writeFileSync(file, xml);
  try {
    execFileSync("xmllint", ["--noout", file], { stdio: "pipe" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`invalid XML: ${(err as { stderr?: Buffer }).stderr}`);
  }
});

test("Meta feed: same items, Meta's 'in stock' spelling, JPEG images only", () => {
  const meta = googleFeedXml(shopProducts, new Date("2026-10-12T20:00:00Z"), "meta");
  const google = googleFeedXml(shopProducts, new Date("2026-10-12T20:00:00Z"));
  assert.equal(meta.split("<item>").length, google.split("<item>").length);
  assert.doesNotMatch(meta, /in_stock/);
  assert.match(meta, /<g:availability>in stock<\/g:availability>/);
  assert.doesNotMatch(meta, /\.webp/);
  for (const tag of ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand", "item_group_id", "color", "size", "gender", "age_group"])
    assert.match(meta, new RegExp(`<g:${tag}>`), tag);
});
