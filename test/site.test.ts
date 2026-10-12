// Site-level decisions (John, 2026-10-12): the old $27 pelican is retired and
// redirects to the Pelican Tee's Grind Beanie style; "Version" reads "Print: Big / Small".
import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";
import legacy from "../public/products.ts";
import { shopCards } from "../lib/shop-cards.ts";
import { getShopProduct } from "../lib/catalog/index.ts";
import { creditLinesFor, imagesFor, normalizeSelection } from "../lib/catalog/select.ts";
import { optionTitle, valueLabel } from "../lib/catalog/copy.ts";
import { buildItem, checkoutBlock, itemSummary } from "../lib/orders/build-items.ts";
import { itemsFromLineItems } from "../lib/orders/session.ts";
import { rulesFor } from "../lib/orders/royalties.ts";
import { creditText, designFromCreditLines } from "../lib/artists.ts";

test("the old $27 pelican is off the home grid but still in the product data", () => {
  const hrefs = shopCards().map((c) => c.href);
  assert.ok(!hrefs.includes("/pelican-beanie-t-shirt"));
  assert.ok(hrefs.includes("/clouds-skater-dress"), "the dress is still listed");
  assert.ok(legacy.products.some((p) => p.id === "pelican-beanie-t-shirt" && p.retired));
});

test("its URL redirects permanently to the pelican tee's beanie style", async () => {
  const redirects = await nextConfig.redirects!();
  assert.deepEqual(redirects, [
    { source: "/pelican-beanie-t-shirt", destination: "/pelican-tee?style=beanie", statusCode: 301 },
  ]);
});

test("the pelican page honours ?style=beanie", { skip: !getShopProduct("pelican-tee") }, () => {
  const p = getShopProduct("pelican-tee")!;
  const sel = normalizeSelection(p, { style: "beanie" });
  assert.equal(sel.style, "beanie");
  assert.match(imagesFor(p, sel)[0], /-beanie-/);
  assert.deepEqual(creditLinesFor(p, sel), ["Beanie by Janette Garcia"]);
});

test("old checkouts for the retired tee still map to a supplier note and Janette's royalty", () => {
  const [item] = itemsFromLineItems(
    [{ quantity: 1, price: { unit_amount: 2700, product: { name: "Pelican With Beanie T Shirt", metadata: { productId: "pelican-beanie-t-shirt", color: "White", size: "M" } } } }],
    {}
  );
  assert.equal(item.slug, "pelican-beanie-t-shirt");
  assert.match(item.manual ?? "", /85446338/);
  assert.equal(buildItem("pelican-beanie-t-shirt", { color: "White", size: "M" }, 1, {}).item.unitAmount, 2700);
  assert.deepEqual(rulesFor("pelican-beanie-t-shirt").map((r) => r.artist), ["janette"]);
});

test('"Print: Big / Small" is a label only: the option keys stay large/small', () => {
  assert.equal(optionTitle("version"), "Print");
  assert.equal(valueLabel("version", "large"), "Big");
  assert.equal(valueLabel("version", "small"), "Small");
  const p = getShopProduct("pelican-tee");
  if (p) {
    const { item, description } = buildItem("pelican-tee", { version: "large", style: "beanie", color: "Ivory", size: "M" }, 1, {});
    assert.equal(item.opts.version, "large");
    assert.match(description, /^Print: Big, Style: Grind Beanie/);
    assert.match(itemSummary(item), /^Big · Grind Beanie/);
    assert.deepEqual(p.options.version, ["large", "small"]);
  }
});

test("the skater dress is the Printful catalog product now; the legacy one only maps old checkouts", { skip: !getShopProduct("clouds-skater-dress") }, () => {
  const cards = shopCards().filter((c) => c.href === "/clouds-skater-dress");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].price, "$55");
  const { item } = buildItem("clouds-skater-dress", { size: "M" }, 1, {});
  assert.equal(item.supplier, "printful");
  assert.equal(item.unitAmount, 5500);
  assert.ok(item.printful?.syncVariantId);
  // a checkout started on the old page (no mop_* metadata) still maps the old way
  const [old] = itemsFromLineItems(
    [{ quantity: 1, price: { unit_amount: 5500, product: { name: "All-Over Clouds Skater Dress", metadata: { productId: "clouds-skater-dress", size: "M" } } } }],
    {}
  );
  assert.equal(old.supplier, "manual");
  assert.match(old.manual ?? "", /73677360/);
  assert.ok(legacy.products.some((p) => p.id === "clouds-skater-dress" && p.superseded));
});

test("a plain credit line (CC0 photo) shows as written, with no avatar", () => {
  const d = designFromCreditLines(["Sky photo: John Robert McPherson (CC0, Wikimedia Commons)"])!;
  assert.deepEqual(d.credits, []);
  assert.deepEqual(d.notes, ["Sky photo: John Robert McPherson (CC0, Wikimedia Commons)"]);
  assert.equal(creditText(d), "Sky photo: John Robert McPherson (CC0, Wikimedia Commons)");
});

test("the old-sky Yoycol shirt and shorts are 'coming back soon': off the grid, no new checkouts, old orders still map", () => {
  const hrefs = shopCards().map((c) => c.href);
  for (const id of ["clouds-in-sky-shirt", "blue-sky-cotton-shorts"]) {
    assert.ok(!hrefs.includes(`/${id}`), `${id} hidden`);
    const p = legacy.products.find((x) => x.id === id)!;
    assert.equal(p.comingSoon?.message, "Coming back soon with a new sky");
    assert.deepEqual(checkoutBlock(id), { status: 409, error: "coming back soon with a new sky" });
    // a paid order from a checkout started before still goes to Yoycol
    const { item } = buildItem(id, { size: "M" }, 1, {});
    assert.equal(item.supplier, "yoycol");
  }
  assert.deepEqual(checkoutBlock("pelican-beanie-t-shirt"), { status: 410, error: "no longer available" });
  assert.equal(checkoutBlock("pelican-tee"), null);
  assert.equal(checkoutBlock("clouds-skater-dress"), null);
});
