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
import { buildItem, itemSummary } from "../lib/orders/build-items.ts";
import { itemsFromLineItems } from "../lib/orders/session.ts";
import { rulesFor } from "../lib/orders/royalties.ts";

test("the old $27 pelican is off the home grid but still in the product data", () => {
  const hrefs = shopCards().map((c) => c.href);
  assert.ok(!hrefs.includes("/pelican-beanie-t-shirt"));
  for (const id of ["clouds-in-sky-shirt", "clouds-skater-dress", "blue-sky-cotton-shorts"])
    assert.ok(hrefs.includes(`/${id}`), `${id} still listed`);
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
