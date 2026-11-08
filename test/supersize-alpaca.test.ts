// The Supersize Alpaca Tee (John, 11/07): 3 colorways on one Yoycol SPU, one
// designCode per color, shipped one size up (yoycol-config.ts). 11/08: added
// a "Back" option (Logo default / Plain), same price, with its own designCode
// per (color, back) - 6 combos total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItem } from "../lib/orders/build-items.ts";
import { yoycolForColor, yoycolSizeShiftUp } from "../lib/orders/yoycol-config.ts";
import legacy, { getTotalPrice } from "../public/products.ts";
import { legacyPageProduct } from "../lib/product-page.ts";
import { imageSetFor, normalizeSelection } from "../lib/catalog/select.ts";

const SLUG = "supersize-alpaca-tee";

// All 6 (color, back) -> designCode combos (Yoycol Open API, read 2026-11-08).
const DESIGN_CODES: Record<string, Record<string, string>> = {
  White: { Logo: "PY8DV", Plain: "PYBUK" },
  Sky: { Logo: "PY7X7", Plain: "PYBUN" },
  Black: { Logo: "PY8EN", Plain: "PYBUF" },
};

test("all 6 (color, back) combos map to their own designCode, same SPU, same (White) SKU colour segment", () => {
  for (const [color, backs] of Object.entries(DESIGN_CODES)) {
    for (const [back, designCode] of Object.entries(backs)) {
      assert.deepEqual(
        yoycolForColor(SLUG, color, back, {}),
        { spu: "3MTXVYM32", designCode, colorHex: "FFFFFF", templateName: "Supersize Alpaca" },
        `${color}/${back}`
      );
    }
  }
  // No back given: falls back to the first declared back (Logo).
  assert.equal(yoycolForColor(SLUG, "White", undefined, {})!.designCode, "PY8DV");
  assert.equal(yoycolForColor(SLUG, "Purple", "Logo", {}), undefined);
  assert.equal(yoycolForColor("not-a-product", "White", "Logo", {}), undefined);
});

test("a designCode override applies per (slug:color:back), then slug:color, then plain slug, then the saved code", () => {
  assert.equal(yoycolForColor(SLUG, "Sky", "Logo", { YOYCOL_DESIGN_CODES: `${SLUG}:Sky:Logo=NEWSKY` })!.designCode, "NEWSKY");
  assert.equal(yoycolForColor(SLUG, "Sky", "Plain", { YOYCOL_DESIGN_CODES: `${SLUG}:Sky:Logo=NEWSKY` })!.designCode, "PYBUN", "the override is back-specific");
  assert.equal(yoycolForColor(SLUG, "White", "Logo", { YOYCOL_DESIGN_CODES: `${SLUG}:Sky:Logo=NEWSKY` })!.designCode, "PY8DV");
  assert.equal(yoycolForColor(SLUG, "White", "Logo", { YOYCOL_DESIGN_CODES: `${SLUG}=ALLCODE` })!.designCode, "ALLCODE");
});

test("ships one size up (S->M ... 3XL->4XL); 4XL (the top) is not shifted and is flagged", () => {
  assert.deepEqual(yoycolSizeShiftUp("S"), { size: "M", shifted: true, atTop: false });
  assert.deepEqual(yoycolSizeShiftUp("3XL"), { size: "4XL", shifted: true, atTop: false });
  assert.deepEqual(yoycolSizeShiftUp("4XL"), { size: "4XL", shifted: false, atTop: true });
});

test("buildItem: customer's picked size and back stay in opts/description; Yoycol's SKU is shifted up one size", () => {
  const r = buildItem(SLUG, { color: "Black", back: "Logo", size: "M" }, 1, {});
  assert.equal(r.item.opts.size, "M", "the customer-facing size is unchanged");
  assert.equal(r.item.opts.back, "Logo");
  assert.equal(r.item.supplier, "yoycol");
  assert.equal(r.item.yoycol?.designCode, "PY8EN");
  assert.equal(r.item.yoycol?.skuCode, "ADS-3MTXVYM32-00000-FFFFFF-L", "Yoycol order is one size up: L for a customer M");
  assert.match(r.item.manual ?? "", /one size up/);
});

test("buildItem: a Plain back maps to its own designCode, not the Logo one", () => {
  const r = buildItem(SLUG, { color: "Black", back: "Plain", size: "M" }, 1, {});
  assert.equal(r.item.opts.back, "Plain");
  assert.equal(r.item.yoycol?.designCode, "PYBUF");
});

test("buildItem: the top size (4XL) is left as-is and flagged for John, not silently shifted off the chart", () => {
  const r = buildItem(SLUG, { color: "White", back: "Logo", size: "4XL" }, 1, {});
  assert.equal(r.item.yoycol?.skuCode, "ADS-3MTXVYM32-00000-FFFFFF-4XL");
  assert.match(r.item.manual ?? "", /TODO.*top of the size chart/);
});

test("an invalid color is refused like any other bad option", () => {
  assert.throws(() => buildItem(SLUG, { color: "Purple", back: "Logo", size: "M" }, 1, {}), /invalid color/);
});

test("an invalid back is refused like any other bad option", () => {
  assert.throws(() => buildItem(SLUG, { color: "Black", back: "Reversed", size: "M" }, 1, {}), /invalid back/);
});

test("on sale, free US shipping, $44.76 displayed total (matches the other all-overs), 3 colors x 2 backs x 8 sizes", () => {
  const p = legacy.products.find((x) => x.id === SLUG)!;
  assert.ok(p, "product exists in public/products.ts");
  assert.ok(!p.retired && !p.comingSoon && !p.superseded);
  assert.equal(p.freeShippingMode, true);
  assert.equal(p.price, 37.24);
  assert.equal(getTotalPrice(p), 44.76, "displayed total matches the other all-overs");
  assert.deepEqual(p.options.color, ["White", "Sky", "Black"]);
  assert.deepEqual(p.options.back, ["Logo", "Plain"], "Logo first: preselected default");
  assert.deepEqual(p.options.size, ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"]);
  // Back doesn't change price: same $44.76 whichever back is picked.
  for (const size of p.options.size!) assert.equal(getTotalPrice(p, size), 44.76, size);
});

test("page: Logo preselected by default; the page offers a Back picker and Plain swaps the back photo", () => {
  const p = legacy.products.find((x) => x.id === SLUG)!;
  const page = legacyPageProduct(p)!;
  assert.deepEqual(page.options.back, ["Logo", "Plain"]);

  const defaultSel = normalizeSelection(page, {});
  assert.equal(defaultSel.back, "Logo", "Logo is preselected");

  for (const color of ["White", "Sky", "Black"]) {
    const logoImages = imageSetFor(page, { color, back: "Logo" })!.images;
    const plainImages = imageSetFor(page, { color, back: "Plain" })!.images;
    assert.deepEqual(logoImages, (p.images as Record<string, string[]>)[color]);
    assert.deepEqual(plainImages, p.plainBackImages![color], color);
    // Only the model-back photo differs; front and flat-lay stay the same.
    assert.equal(plainImages[0], logoImages[0], `${color} model-front unchanged`);
    assert.notEqual(plainImages[1], logoImages[1], `${color} model-back swapped`);
    assert.match(plainImages[1], /-model-back-plain\.webp$/, color);
    assert.equal(plainImages[2], logoImages[2], `${color} flat front unchanged`);
    assert.equal(plainImages[3], logoImages[3], `${color} flat back unchanged (no plain flat-lay yet)`);
  }
  // Every color has a plain-back mockup, so no "no logo" fallback note is needed.
  assert.equal(page.backNote, undefined);
});

test("pageBackground is a per-color cut-out (John, 11/08: model shot's FRONT, background removed) and reaches the page product", () => {
  const p = legacy.products.find((x) => x.id === SLUG)!;
  assert.deepEqual(p.pageBackground, {
    White: "/images/supersize-alpaca-tee/white-erasebg-transformed.png",
    Sky: "/images/supersize-alpaca-tee/sky-erasebg-transformed.png",
    Black: "/images/supersize-alpaca-tee/black-erasebg-transformed.png",
  });
  const page = legacyPageProduct(p)!;
  assert.deepEqual(page.pageBackground, p.pageBackground);
});

test("gallery order per color: model front, model back, then the flat-lay front, back", () => {
  const p = legacy.products.find((x) => x.id === SLUG)!;
  for (const color of ["White", "Sky", "Black"]) {
    const images = (p.images as Record<string, string[]>)[color];
    assert.equal(images.length, 4, color);
    assert.match(images[0], /model-front\.webp$/, color);
    assert.match(images[1], /model-back\.webp$/, color);
    assert.match(images[2], /-front\.webp$/, color);
    assert.match(images[3], /-back\.webp$/, color);
  }
});

test("every other legacy product keeps its page background on (the flag is per-product, not a global off-switch)", () => {
  const shorts = legacy.products.find((x) => x.id === "blue-sky-cotton-shorts")!;
  assert.equal(shorts.pageBackground, undefined);
  assert.equal(legacyPageProduct(shorts)!.pageBackground, undefined);
});
