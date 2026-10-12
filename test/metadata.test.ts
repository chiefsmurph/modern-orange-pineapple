// Product + picks -> priced item -> Stripe metadata -> back to the same item.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItem, CheckoutError } from "../lib/orders/build-items.ts";
import {
  itemsFromSessionMetadata,
  lineItemMetadata,
  sessionMetadata,
} from "../lib/orders/metadata.ts";
import { itemsFromLineItems } from "../lib/orders/session.ts";
import { parseDesignCodes } from "../lib/orders/yoycol-config.ts";
import { catalogProducts } from "../lib/catalog/products.generated.ts";
import * as checkout from "../lib/orders/checkout.ts";
import { printfulItem, yoycolItem } from "./helpers.ts";

test("metadata round-trips every supplier", () => {
  const { printful: _none, ...base } = printfulItem({ slug: "pelican-beanie-t-shirt", supplier: "manual" });
  const manual = { ...base, manual: "Printful product template 85446338" };
  const items = [printfulItem({ qty: 2 }), yoycolItem(), manual];
  const md = sessionMetadata(items);
  assert.equal(md.mop_v, "1");
  assert.equal(md.mop_n, "3");
  for (const v of Object.values(md)) assert.ok(v.length <= 500);
  assert.deepEqual(itemsFromSessionMetadata(md), items);
  assert.match(md.mop_summary, /2 x Pelican Tee \(large \/ beanie \/ Ivory \/ M\) \[printful\]/);
});

test("unreadable or missing metadata is null (webhook falls back to line items)", () => {
  assert.equal(itemsFromSessionMetadata(null), null);
  assert.equal(itemsFromSessionMetadata({ productId: "x" }), null);
  assert.equal(itemsFromSessionMetadata({ mop_v: "1", mop_n: "1", mop_item_0: "{bad" }), null);
  // a printful item without a sync id is refused, not guessed
  assert.equal(
    itemsFromSessionMetadata({ mop_v: "1", mop_n: "1", mop_item_0: JSON.stringify({ s: "x", sup: "printful", o: {}, q: 1 }) }),
    null
  );
});

test("line-item metadata is flat strings with the fulfilment ids", () => {
  assert.deepEqual(lineItemMetadata(printfulItem()), {
    productId: "test-pelican-tee",
    supplier: "printful",
    qty: "1",
    version: "large",
    style: "beanie",
    color: "Ivory",
    size: "M",
    sync_variant_id: "4242",
  });
  assert.deepEqual(lineItemMetadata(yoycolItem()), {
    productId: "clouds-in-sky-shirt",
    supplier: "yoycol",
    qty: "1",
    size: "L",
    yoycol_design_code: "LRVV1",
    yoycol_sku_code: "ADS-3MTXVYM32-00000-FFFFFF-L",
  });
});

test("legacy Yoycol products map to designCode + SKU; codes can be overridden by env", () => {
  const { item } = buildItem("clouds-in-sky-shirt", { size: "XL" }, 1, {});
  assert.equal(item.supplier, "yoycol");
  assert.deepEqual(item.yoycol, { designCode: "LRVV1", skuCode: "ADS-3MTXVYM32-00000-FFFFFF-XL" });
  assert.equal(item.unitAmount, 3600); // free shipping: price + shipping = $36

  const env = { YOYCOL_DESIGN_CODES: "clouds-in-sky-shirt=NEW01, blue-sky-cotton-shorts = NEW02" };
  assert.deepEqual(parseDesignCodes(env.YOYCOL_DESIGN_CODES), { "clouds-in-sky-shirt": "NEW01", "blue-sky-cotton-shorts": "NEW02" });
  assert.equal(buildItem("blue-sky-cotton-shorts", { size: "5XL" }, 1, env).item.yoycol?.designCode, "NEW02");
  assert.equal(buildItem("blue-sky-cotton-shorts", { size: "5XL" }, 1, env).item.yoycol?.skuCode, "ADS-3MPXZT40-00000-FFFFFF-5XL");
});

test("legacy Printful template products become manual items with a note", () => {
  const { item, shippingCents } = buildItem("pelican-beanie-t-shirt", { size: "M", color: "White" }, 1, {});
  assert.equal(item.supplier, "manual");
  assert.match(item.manual!, /85446338/);
  assert.equal(item.unitAmount, 2700);
  assert.equal(shippingCents, 0);
});

test("checkout refuses bad picks instead of trusting the client", () => {
  assert.throws(() => buildItem("nope", {}), CheckoutError);
  assert.throws(() => buildItem("clouds-in-sky-shirt", { size: "9XL" }), /invalid size/);
  assert.throws(() => buildItem("pelican-beanie-t-shirt", { size: "M" }), /invalid color/);
  assert.throws(() => buildItem("clouds-in-sky-shirt", { size: "M" }, 0), /quantity/);
});

test("every generated catalog variant builds, prices from the variant, and fits in metadata", () => {
  for (const p of catalogProducts) {
    for (const v of p.variants) {
      const { item, shippingCents, image } = buildItem(p.slug, v.opts, 1, {});
      assert.equal(item.supplier, "printful");
      assert.equal(item.unitAmount, Math.round(v.price * 100));
      assert.equal(shippingCents, 0);
      assert.match(image ?? "", /^\/images\/catalog\/.+-checkout\.jpg$/, `${p.slug}: checkout image`);
      assert.deepEqual(itemsFromSessionMetadata(sessionMetadata([item])), [item]);
    }
  }
});

test("old sessions (no mop_* metadata) are rebuilt from Stripe line items", () => {
  const items = itemsFromLineItems(
    [
      { quantity: 1, price: { unit_amount: 3600, product: { name: "Clouds In Sky Shirt", metadata: { productId: "clouds-in-sky-shirt", size: "M" } } } },
      { quantity: 1, price: { unit_amount: 999, product: { name: "Mystery", metadata: { productId: "gone" } } } },
    ],
    {}
  );
  assert.equal(items[0].supplier, "yoycol");
  assert.equal(items[0].yoycol?.skuCode, "ADS-3MTXVYM32-00000-FFFFFF-M");
  assert.equal(items[1].supplier, "manual");
  assert.equal(items[1].title, "Mystery");
});

test("Checkout collects address + phone, carries the metadata, keeps the price rules", () => {
  const { checkoutSessionParams } = checkout;
  // Printful line-up item: the variant price, free shipping.
  const p = catalogProducts[0];
  if (p) {
    const v = p.variants[0];
    const params = checkoutSessionParams(buildItem(p.slug, v.opts, 1, {}));
    assert.equal(params.phone_number_collection?.enabled, true);
    assert.deepEqual(params.shipping_address_collection?.allowed_countries, ["US"]); // US only
    assert.equal(params.line_items![0].price_data!.unit_amount, Math.round(v.price * 100));
    assert.equal(params.shipping_options![0].shipping_rate_data!.fixed_amount!.amount, 0);
    assert.equal(params.metadata!.mop_v, "1");
    assert.deepEqual(itemsFromSessionMetadata(params.metadata as Record<string, string>)![0].opts, v.opts);
    assert.match(String(params.line_items![0].price_data!.product_data!.images![0]), /^https:\/\/mopclothing\.com\/images\/catalog\/.+-checkout\.jpg$/);
    assert.equal(params.line_items![0].price_data!.product_data!.metadata!.sync_variant_id !== undefined, true);
  }
  // Legacy free-shipping item: the item carries price + shipping, shipping line $0 (unchanged behaviour).
  const shirt = checkoutSessionParams(buildItem("clouds-in-sky-shirt", { size: "M" }, 1, {}));
  assert.equal(shirt.line_items![0].price_data!.unit_amount, 3600);
  assert.equal(shirt.shipping_options![0].shipping_rate_data!.fixed_amount!.amount, 0);
  assert.equal(shirt.phone_number_collection?.enabled, true);
  assert.deepEqual(shirt.shipping_address_collection?.allowed_countries, ["US"]);
  assert.equal(shirt.success_url, "https://mopclothing.com/clouds-in-sky-shirt?status=success");
});
