// Picker logic over a hand-made product, plus integrity checks on whatever
// catalog is generated (lib/catalog/*.generated.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creditLinesFor,
  findVariant,
  imagesFor,
  isAvailable,
  normalizeSelection,
  optionNames,
  priceLabel,
  variantKey,
} from "../lib/catalog/select.ts";
import type { CatalogProduct } from "../lib/catalog/types.ts";
import { catalogProducts, catalogIsSample } from "../lib/catalog/products.generated.ts";
import { catalogFulfilment } from "../lib/catalog/fulfilment.generated.ts";
import { designFromCreditLines, creditText } from "../lib/artists.ts";

const tee: CatalogProduct = {
  slug: "fixture-tee",
  title: "Fixture Tee",
  supplier: "printful",
  delivery: "printful",
  options: {
    version: ["large", "small"],
    style: ["classic", "beanie"],
    color: ["Lagoon Blue", "Ivory"],
    size: ["M", "3XL"],
  },
  variants: [],
  images: [
    { when: { version: "large", style: "classic", color: "Lagoon Blue" }, images: ["/a-lc-blue-model", "/a-lc-blue-flat"] },
    { when: { version: "large", style: "beanie", color: "Ivory" }, images: ["/a-lb-ivory-model"] },
    { when: { version: "small", style: "*", color: "*" }, images: ["/small-any"] },
  ],
  credits: [{ lines: ["Beanie by Janette Garcia"], when: { style: "beanie" } }],
};
for (const version of tee.options.version)
  for (const style of tee.options.style)
    for (const color of tee.options.color)
      for (const size of tee.options.size) {
        // Ivory has no 3XL in the small version.
        if (version === "small" && color === "Ivory" && size === "3XL") continue;
        tee.variants.push({ opts: { version, style, color, size }, price: size === "3XL" ? 31 : 29, status: "DECIDED" });
      }

test("options come out in picker order", () => {
  assert.deepEqual(optionNames({ options: { size: [], color: [], version: [], style: [] } }), [
    "version",
    "style",
    "color",
    "size",
  ]);
  assert.equal(variantKey({ size: "M", color: "Ivory", version: "large", style: "beanie" }), "large|beanie|Ivory|M");
});

test("normalizeSelection keeps valid picks, fixes case, defaults visuals but not size", () => {
  const sel = normalizeSelection(tee, { version: "SMALL", color: "ivory", size: "XXL", bogus: "x" });
  assert.deepEqual(sel, { version: "small", style: "classic", color: "Ivory", size: undefined });
  assert.deepEqual(normalizeSelection(tee, {}, { fillDefaults: false }), {
    version: undefined,
    style: undefined,
    color: undefined,
    size: undefined,
  });
});

test("findVariant needs every option and a real combination", () => {
  assert.equal(findVariant(tee, { version: "large", style: "beanie", color: "Ivory" }), undefined);
  assert.equal(findVariant(tee, { version: "small", style: "beanie", color: "Ivory", size: "3XL" }), undefined);
  const v = findVariant(tee, { version: "large", style: "beanie", color: "Ivory", size: "3XL" });
  assert.equal(v?.price, 31);
  assert.equal(isAvailable(tee, { version: "small", color: "Ivory" }, "size", "3XL"), false);
  assert.equal(isAvailable(tee, { version: "large", color: "Ivory" }, "size", "3XL"), true);
});

test("price label shows a range until the size is picked", () => {
  assert.equal(priceLabel(tee), "From $29");
  assert.equal(priceLabel(tee, { version: "small", color: "Ivory" }), "$29");
});

test("images follow version, style and colour; wildcards lose to exact matches", () => {
  assert.deepEqual(imagesFor(tee, { version: "large", style: "classic", color: "Lagoon Blue" }), [
    "/a-lc-blue-model",
    "/a-lc-blue-flat",
  ]);
  assert.deepEqual(imagesFor(tee, { version: "large", style: "beanie", color: "Ivory" }), ["/a-lb-ivory-model"]);
  assert.deepEqual(imagesFor(tee, { version: "small", style: "beanie", color: "Ivory" }), ["/small-any"]);
  // no match at all: first set
  assert.deepEqual(imagesFor(tee, { version: "large", style: "classic", color: "Ivory" }), [
    "/a-lc-blue-model",
    "/a-lc-blue-flat",
  ]);
});

test("the beanie credit shows only on the Grind Beanie style", () => {
  assert.deepEqual(creditLinesFor(tee, { style: "classic" }), []);
  assert.deepEqual(creditLinesFor(tee, { style: "beanie" }), ["Beanie by Janette Garcia"]);
  const design = designFromCreditLines(["Beanie by Janette Garcia"]);
  assert.equal(creditText(design!), "Beanie by Janette Garcia");
  assert.equal(design!.credits[0].artist, "janette-garcia"); // registry artist (avatar, links)
  assert.equal(designFromCreditLines([]), undefined);
  // someone not in the registry is still credited by name
  assert.equal(creditText(designFromCreditLines(["Photo by Someone New"])!), "Photo by Someone New");
  // "CC BY 4.0" is a licence, not a byline: the line stays exactly as written (CC BY requires it unaltered)
  const cc = "Image: NASA, ESA, CSA, and STScI (CC BY 4.0), cropped, stars brightened";
  const ccDesign = designFromCreditLines([cc])!;
  assert.deepEqual(ccDesign.credits, []);
  assert.deepEqual(ccDesign.notes, [cc]);
  assert.equal(creditText(ccDesign), cc);
});

test("generated catalog: every variant has a sync id, images and valid credits", () => {
  for (const p of catalogProducts) {
    const f = catalogFulfilment[p.slug];
    assert.ok(f, `${p.slug}: no fulfilment entry`);
    assert.ok(optionNames(p).filter((n) => n !== "size").length <= 3, `${p.slug}: more than 3 pickers + size`);
    for (const v of p.variants) {
      assert.ok(Number.isInteger(f.variants[variantKey(v.opts)]?.syncVariantId), `${p.slug} ${variantKey(v.opts)}: no sync id`);
      assert.ok(v.price > 0);
    }
    assert.ok(p.images.length > 0 && p.images.every((s) => s.images.length > 0), `${p.slug}: images`);
    for (const c of p.credits) for (const l of c.lines) assert.ok(l.trim().length > 0);
  }
});

test("generated catalog follows the spec's credit rules", { skip: catalogProducts.length === 0 }, () => {
  for (const p of catalogProducts) {
    const all = p.credits.flatMap((c) => c.lines).join(" | ");
    if (/nolli|rabbit/.test(p.slug)) assert.equal(all, "", `${p.slug} should have no credit`);
    if (/alpaca/.test(p.slug)) assert.match(all, /Austin Maxwell/);
    if (/star/.test(p.slug)) assert.match(all, /Sunshine Austina/);
    for (const c of p.credits) {
      if (c.lines.some((l) => /Janette Garcia/.test(l))) {
        assert.deepEqual(c.lines.filter((l) => /Janette/.test(l)), ["Beanie by Janette Garcia"]);
        assert.ok(c.when && /beanie/i.test(Object.values(c.when).join()), `${p.slug}: beanie credit must be conditional`);
      }
    }
  }
});

test("the committed catalog is not the hand-made sample", { skip: process.env.ALLOW_SAMPLE_CATALOG === "1" }, () => {
  assert.equal(catalogIsSample, false);
});
