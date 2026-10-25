// The Blue Sky Cotton Shorts (Yoycol, public/products.ts) on the same product page
// as the line-up (John, 2026-10-16), with their own checkout unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import legacy, { vendorDelivery, type Product } from "../public/products.ts";
import { legacyPageProduct } from "../lib/product-page.ts";
import { findVariant, normalizeSelection, priceLabel, imagesFor } from "../lib/catalog/select.ts";
import { buildItem } from "../lib/orders/build-items.ts";
import { checkoutSessionParams } from "../lib/orders/checkout.ts";
import { itemsFromSessionMetadata } from "../lib/orders/metadata.ts";
import { yoycolOrderBody } from "../lib/orders/yoycol.ts";
import type { OrderRecord } from "../lib/orders/types.ts";
import { bagId, lineView } from "../lib/bag.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const ID = "blue-sky-cotton-shorts";
const shorts = legacy.products.find((p) => p.id === ID)!;
const SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
const CENTS: Record<string, number> = { S: 4443, M: 4443, L: 4443, XL: 4443, "2XL": 4443, "3XL": 4443, "4XL": 4643, "5XL": 4843 }; // John 10/24 endings (were $45/$47/$49 from 10/20, $40/$42/$44 before)

test("the shorts' page product: size pills S–5XL at $44.43/$46.43/$48.43, Yoycol delivery, Buy now only", () => {
  const page = legacyPageProduct(shorts)!;
  assert.ok(page);
  assert.equal(page.slug, ID);
  assert.equal(page.buyNowOnly, true, "the bag can't hold them yet");
  assert.equal(page.delivery, "yoycol");
  assert.match(vendorDelivery[page.delivery].text, /3–4 weeks/);
  assert.deepEqual(page.options, { size: SIZES });
  assert.deepEqual(
    page.variants.map((v) => [v.opts.size, v.price]),
    SIZES.map((s) => [s, CENTS[s] / 100])
  );
  assert.equal(priceLabel(page, {}), "From $44.43");
  assert.deepEqual(imagesFor(page, {}), shorts.images);
  // no size picked from the URL: "Choose a size"; ?size=4XL preselects it
  assert.deepEqual(normalizeSelection(page, {}), { size: undefined });
  assert.deepEqual(normalizeSelection(page, { size: "4XL" }), { size: "4XL" });
});

test("the shorts still go to Yoycol exactly as before: design code, SKU per size, price per size", () => {
  const page = legacyPageProduct(shorts)!;
  const record = {
    order_ref: "mop-test",
    created: "2026-10-16T00:00:00Z",
    customer: { name: "Test Person", email: "t@example.com", phone: "5555550100", address: { country: "US" } },
  } as unknown as OrderRecord;
  for (const size of SIZES) {
    // what "Buy now" posts to /api/checkout: { productId: slug, ...selection }
    const sel = normalizeSelection(page, { size });
    const variant = findVariant(page, sel)!;
    const priced = buildItem(page.slug, sel, 1, {});
    assert.equal(Math.round(variant.price * 100), priced.item.unitAmount, `${size}: the page shows what Stripe charges`);
    assert.deepEqual(
      priced.item,
      {
        slug: ID,
        title: "Blue Sky Cotton Shorts",
        supplier: "yoycol",
        qty: 1,
        opts: { size },
        unitAmount: CENTS[size],
        yoycol: { designCode: "LRWGN", skuCode: `ADS-3MPXZT40-00000-FFFFFF-${size}` },
      },
      size
    );
    assert.equal(priced.shippingCents, 0, size);
    assert.deepEqual(priced.delivery, vendorDelivery.yoycol, size);
    const params = checkoutSessionParams(priced);
    assert.equal(
      params.metadata!.mop_item_0,
      `{"s":"${ID}","t":"Blue Sky Cotton Shorts","sup":"yoycol","q":1,"o":{"size":"${size}"},"u":${CENTS[size]},"yc":{"dc":"LRWGN","sku":"ADS-3MPXZT40-00000-FFFFFF-${size}"}}`,
      size
    );
    const items = itemsFromSessionMetadata(params.metadata as Record<string, string>)!;
    assert.deepEqual(yoycolOrderBody(record, items, {}).items, [
      {
        source: "productTemplate",
        designCode: "LRWGN",
        skuCode: `ADS-3MPXZT40-00000-FFFFFF-${size}`,
        quantity: 1,
        thirdItemId: "mop-test-1",
        title: `Blue Sky Cotton Shorts (${size})`,
        realPrice: CENTS[size] / 100,
      },
    ]);
  }
});

test("the page renders hand-written products in the shared view; Buy now only while the bag can't hold them", () => {
  const page = readFileSync(path.join(ROOT, "app/[productId]/page.tsx"), "utf8");
  assert.match(page, /const legacyPage = product && legacyPageProduct\(product\);/);
  assert.match(page, /legacyPage \|\| getShopProduct\(productId\)/);
  const buttons = readFileSync(path.join(ROOT, "app/[productId]/AddToBag.tsx"), "utf8");
  assert.match(buttons, /product\.buyNowOnly \? \(\s*<button type="button" className=\{bag\.add\} onClick=\{buyNow\}/);
  assert.match(buttons, /singleCheckout\(\{ productId: product\.slug, title: product\.title, value: variant\.price, options: sel \}\)/);
  // When the bag learns the shorts, drop buyNowOnly (lib/product-page.ts) to get "Add to bag".
  assert.equal(lineView({ id: bagId(ID, { size: "M" }), qty: 1 }), null);
});

test("the shorts' copy: a MOP lead line, then the facts; no supplier blurb", () => {
  const lines = shorts.description.split("\n");
  assert.equal(lines[0], "The blue sky, on soft cotton shorts.");
  assert.doesNotMatch(shorts.description, /natural fiber|many scenarios/);
  for (const fact of [/100% cotton/, /Regular fit/, /Side pocket, back pocket, elastic waist/, /245\sg\/m²/])
    assert.match(shorts.description, fact);
  assert.equal(shorts.sizeNote, "100% cotton · true to size, size up for a longer, below-the-knee fit");
});

test("products the shared page can't show faithfully keep the older template", () => {
  const base = shorts as Product;
  assert.equal(legacyPageProduct({ ...base, freeShippingMode: undefined }), null, "the page says Free US shipping");
  assert.equal(legacyPageProduct({ ...base, design: "pelican-beanie" }), null, "artist credits come from credit lines");
  // per-colour photos follow the colour pick
  const coloured = legacyPageProduct({ ...base, options: { color: ["Yellow", "White"], size: ["S"] }, images: { Yellow: ["/y.webp"], White: ["/w.webp"] } })!;
  assert.deepEqual(imagesFor(coloured, { color: "White" }), ["/w.webp"]);
  assert.equal(coloured.variants.length, 2);
});
