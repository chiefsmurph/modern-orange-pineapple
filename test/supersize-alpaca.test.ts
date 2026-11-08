// The Supersize Alpaca Tee (John, 11/07): 3 colorways on one Yoycol SPU, one
// designCode per color, shipped one size up (yoycol-config.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItem } from "../lib/orders/build-items.ts";
import { yoycolForColor, yoycolSizeShiftUp } from "../lib/orders/yoycol-config.ts";
import legacy from "../public/products.ts";

const SLUG = "supersize-alpaca-tee";

test("3 colorways map to their own designCode, same SPU, same (White) SKU colour segment", () => {
  assert.deepEqual(yoycolForColor(SLUG, "White", {}), { spu: "3MTXVYM32", designCode: "PY8DV", colorHex: "FFFFFF", templateName: "Supersize Alpaca" });
  assert.deepEqual(yoycolForColor(SLUG, "Sky", {}), { spu: "3MTXVYM32", designCode: "PY7X7", colorHex: "FFFFFF", templateName: "Supersize Alpaca" });
  assert.deepEqual(yoycolForColor(SLUG, "Black", {}), { spu: "3MTXVYM32", designCode: "PY8EN", colorHex: "FFFFFF", templateName: "Supersize Alpaca" });
  assert.equal(yoycolForColor(SLUG, "Purple", {}), undefined);
  assert.equal(yoycolForColor("not-a-product", "White", {}), undefined);
});

test("a designCode override applies per color (slug:color), then plain slug, then the saved code", () => {
  assert.equal(yoycolForColor(SLUG, "Sky", { YOYCOL_DESIGN_CODES: `${SLUG}:Sky=NEWSKY` })!.designCode, "NEWSKY");
  assert.equal(yoycolForColor(SLUG, "White", { YOYCOL_DESIGN_CODES: `${SLUG}:Sky=NEWSKY` })!.designCode, "PY8DV");
  assert.equal(yoycolForColor(SLUG, "White", { YOYCOL_DESIGN_CODES: `${SLUG}=ALLCODE` })!.designCode, "ALLCODE");
});

test("ships one size up (S->M ... 3XL->4XL); 4XL (the top) is not shifted and is flagged", () => {
  assert.deepEqual(yoycolSizeShiftUp("S"), { size: "M", shifted: true, atTop: false });
  assert.deepEqual(yoycolSizeShiftUp("3XL"), { size: "4XL", shifted: true, atTop: false });
  assert.deepEqual(yoycolSizeShiftUp("4XL"), { size: "4XL", shifted: false, atTop: true });
});

test("buildItem: customer's picked size stays in opts/description; Yoycol's SKU is shifted up one size", () => {
  const r = buildItem(SLUG, { color: "Black", size: "M" }, 1, {});
  assert.equal(r.item.opts.size, "M", "the customer-facing size is unchanged");
  assert.equal(r.item.supplier, "yoycol");
  assert.equal(r.item.yoycol?.designCode, "PY8EN");
  assert.equal(r.item.yoycol?.skuCode, "ADS-3MTXVYM32-00000-FFFFFF-L", "Yoycol order is one size up: L for a customer M");
  assert.match(r.item.manual ?? "", /one size up/);
});

test("buildItem: the top size (4XL) is left as-is and flagged for John, not silently shifted off the chart", () => {
  const r = buildItem(SLUG, { color: "White", size: "4XL" }, 1, {});
  assert.equal(r.item.yoycol?.skuCode, "ADS-3MTXVYM32-00000-FFFFFF-4XL");
  assert.match(r.item.manual ?? "", /TODO.*top of the size chart/);
});

test("an invalid color is refused like any other bad option", () => {
  assert.throws(() => buildItem(SLUG, { color: "Purple", size: "M" }, 1, {}), /invalid color/);
});

test("on sale, free US shipping, $37.73 PRICE_TBD placeholder, 3 colors x 8 sizes", () => {
  const p = legacy.products.find((x) => x.id === SLUG)!;
  assert.ok(p, "product exists in public/products.ts");
  assert.ok(!p.retired && !p.comingSoon && !p.superseded);
  assert.equal(p.freeShippingMode, true);
  assert.equal(p.price, 37.73, "PRICE_TBD placeholder - needs John's confirmed price before going live");
  assert.deepEqual(p.options.color, ["White", "Sky", "Black"]);
  assert.deepEqual(p.options.size, ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"]);
});
