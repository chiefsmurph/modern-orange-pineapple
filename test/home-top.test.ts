// The top of the home page (John, 10/16): a bigger brand line, one sentence under
// it, and a benefits row that only says what's true of every product on sale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import legacy from "../public/products.ts";
import { BENEFITS, HERO_LINE } from "../lib/home-copy.ts";
import { homeCards } from "../lib/shop-cards.ts";
import { SHIPPING_COUNTRIES } from "../lib/orders/checkout.ts";
import { buildItem } from "../lib/orders/build-items.ts";
import { shopProducts } from "../lib/catalog/index.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const page = readFileSync(path.join(ROOT, "app/page.tsx"), "utf8");
const css = readFileSync(path.join(ROOT, "app/HomeGrid.module.css"), "utf8");

test("the words: one sentence under the brand line, and the benefits row", () => {
  assert.equal(HERO_LINE, "Original characters on real cotton.");
  assert.equal(BENEFITS.join(" · "), "Tees from $29 · Free US shipping · Original art, made to order");
  // nothing we can't back up
  for (const t of [HERO_LINE, ...BENEFITS]) assert.doesNotMatch(t, /made in|USA|America|organic|handmade/i, t);
});

test("'Free US shipping' is true: every card is free shipping, checkout ships to the US only, and no item adds shipping", () => {
  assert.deepEqual(SHIPPING_COUNTRIES, ["US"]);
  for (const c of homeCards()) assert.ok(c.freeShipping, `${c.href} is free shipping`);
  for (const p of shopProducts) assert.equal(buildItem(p.slug, { ...p.variants[0].opts }, 1, {}).shippingCents, 0, p.slug);
  const onSale = legacy.products.filter((p) => !p.retired && !p.comingSoon && !p.superseded);
  assert.ok(onSale.length > 0);
  for (const p of onSale) {
    assert.ok(p.freeShippingMode, `${p.id} is free shipping`);
    assert.equal(buildItem(p.id, { size: p.options.size?.[0] ?? "M" }, 1, {}).shippingCents, 0, p.id);
  }
});

test("'made to order' is true of every card; 'Real cotton' stays out of the row while anything on sale isn't cotton", () => {
  for (const c of homeCards()) assert.match(c.delivery, /^Made to order/, c.href);
  const notCotton = homeCards().filter((c) => /not cotton/i.test(c.fabricNote ?? ""));
  // today: the skater dress (78% polyester) and the snapback (acrylic / wool)
  assert.deepEqual(notCotton.map((c) => c.href).sort(), ["/clouds-skater-dress", "/star-snapback"]);
  if (notCotton.length) for (const b of BENEFITS) assert.doesNotMatch(b, /cotton/i, b);
});

test("the home page renders them at the top: brand line, sentence, slogan, benefits row, then the wild strip and the grid", () => {
  const order = ["<h1", "{HERO_LINE}", "Escape the Ordinary", "BENEFITS.map", "</header>", "<WildStrip", "homeCards().map"];
  const at = order.map((s) => page.indexOf(s));
  order.forEach((s, i) => assert.ok(at[i] >= 0, `${s} is on the page`));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in this order");
  assert.match(page, /className=\{styles\.benefits\}/);
  // the row breaks only between benefits (each one is nowrap), with a dot between them
  assert.match(css, /\.benefit \{\s*white-space: nowrap;/);
  assert.match(page, /<span aria-hidden="true">·<\/span>/);
  // the old descriptor line (its cotton words are the sentence's now) and the Featured heading are gone
  assert.doesNotMatch(page, /real cotton, even the all-overs|materialNote|phoneNote/);
});

test("the brand line is bigger: 3rem on desktop (was 2rem), and on phones as big as fits beside the bag button", () => {
  assert.match(css, /\.header \.title \{[^}]*font-size: 3rem;/);
  const phone = css.slice(css.indexOf("@media (max-width: 768px)"));
  assert.match(phone, /\.header \.title \{[^}]*font-size: min\(1\.8rem, calc\(10vw - 11px\)\);/);
  assert.match(phone, /\.subtitle \{[^}]*font-size: 0\.78em;/);
});

test('"Tees from $29" is true: the cheapest tee on sale costs exactly $29 (John 10/17)', () => {
  const tees = shopProducts.filter((p) => /-tee$/.test(p.slug));
  assert.ok(tees.length > 0);
  const prices = tees.flatMap((p) => p.variants.map((v) => Number(v.price)));
  assert.ok(prices.every(Number.isFinite), "every tee variant has a price");
  assert.equal(Math.min(...prices), 29);
  assert.ok(BENEFITS.includes("Tees from $29"));
});
