// The top of the home page (John, 10/16): the logo (John, 10/17: the bunny and
// the wordmark, as in the emails, not glowing text), one sentence under it, and a
// benefits row that only says what's true of every product on sale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("the home page renders them at the top: logo, sentence, slogan, benefits row, then the wild strip and the grid", () => {
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

/** A WebP's canvas size (the VP8X header sharp writes for images with alpha). */
function webpSize(file: string) {
  const b = readFileSync(file);
  assert.equal(b.toString("latin1", 0, 4), "RIFF", file);
  assert.equal(b.toString("latin1", 8, 16), "WEBPVP8X", file);
  return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
}

test("the logo replaces the glowing text: one <h1> with the bunny (alt 'MOP Clothing') and the wordmark, read once (John 10/17)", () => {
  const h1s = page.match(/<h1[\s>]/g) ?? [];
  assert.equal(h1s.length, 1, "one h1");
  const h1 = page.slice(page.indexOf("<h1"), page.indexOf("</h1>") + 5);
  assert.match(h1, /<h1 className=\{styles\.logo\}>/);
  // the bunny: the brand's name for screen readers, search and a broken image
  const img = /<img[^>]*\/>/s.exec(h1)?.[0] ?? "";
  assert.match(img, /alt="MOP Clothing"/);
  assert.match(img, /className=\{styles\.bunny\}/);
  // the wordmark is live text in the h1, so the heading carries the brand name
  assert.match(h1, />MOP Clothing<\/span>/);
  assert.match(h1, />Modern Orange Pineapple<\/span>/);
  // the visible "MOP Clothing" repeats the alt, so it's hidden from screen readers
  // (the heading reads "MOP Clothing Modern Orange Pineapple" once)
  assert.match(h1, /<span className=\{styles\.name\} aria-hidden="true">MOP Clothing<\/span>/);
  assert.match(h1, /<span className=\{styles\.subtitle\}>Modern Orange Pineapple<\/span>/);
  // the old text logo and its glow are gone
  assert.doesNotMatch(h1, /mopclothing\.com/);
  assert.doesNotMatch(page, /glitch|glowRef|glow-paused|\.\/styles\.css/);
  assert.ok(!existsSync(path.join(ROOT, "app/styles.css")), "the glow's stylesheet is gone");
});

test("the bunny comes in two sizes of the same art (1x to 3x screens), and `sizes` matches its CSS width", () => {
  const img = /<img[^>]*className=\{styles\.bunny\}[^>]*\/>/s.exec(page)?.[0] ?? "";
  assert.match(img, /src="\/images\/brand\/mop-bunny-120\.webp"/);
  assert.match(img, /srcSet="\/images\/brand\/mop-bunny-120\.webp 120w, \/images\/brand\/mop-bunny-240\.webp 240w"/);
  assert.match(img, /width=\{120\}\s+height=\{216\}/);
  const small = webpSize(path.join(ROOT, "public/images/brand/mop-bunny-120.webp"));
  const big = webpSize(path.join(ROOT, "public/images/brand/mop-bunny-240.webp"));
  assert.deepEqual(small, { width: 120, height: 216 });
  assert.equal(big.width, 240);
  assert.ok(Math.abs(big.height / big.width - small.height / small.width) < 0.01, "same aspect");
  for (const f of ["mop-bunny-120.webp", "mop-bunny-240.webp"])
    assert.ok(readFileSync(path.join(ROOT, "public/images/brand", f)).length < 30_000, `${f} stays small`);
  // `sizes` = the bunny's displayed width (its CSS height × 120/216), phone then desktop
  const [, phoneW, deskW] = /sizes="\(max-width: 768px\) (\d+)px, (\d+)px"/.exec(img) ?? [];
  const phoneCss = css.slice(css.indexOf("@media (max-width: 768px)"));
  const deskH = Number(/\.bunny \{[^}]*height: (\d+)px;/.exec(css.slice(0, css.indexOf("@media (max-width: 768px)")))?.[1]);
  const phoneH = Number(/\.bunny \{[^}]*height: min\((\d+)px/.exec(phoneCss)?.[1]);
  assert.ok(deskH > 0 && phoneH > 0, "bunny heights");
  assert.equal(Number(deskW), Math.ceil((deskH * 120) / 216));
  assert.equal(Number(phoneW), Math.ceil((phoneH * 120) / 216));
});

test("the logo sits on the sky with no card (John 10/17): dark Orbitron with a soft light halo; on phones it shrinks to clear the bag button", () => {
  const logo = /\.logo \{[^}]*\}/.exec(css)?.[0] ?? "";
  assert.match(logo, /background: none;/);
  assert.doesNotMatch(logo, /border-radius|box-shadow/); // no card
  assert.match(logo, /color: #14232b;/);
  assert.match(logo, /text-shadow: 0 0 10px rgba\(255, 255, 255, 0\.75\)/); // legible on mid-blue sky
  assert.match(logo, /font-weight: 500;/); // the one Orbitron weight we load, as in the email logo
  const phone = css.slice(css.indexOf("@media (max-width: 768px)"));
  assert.match(phone, /\.logo \{[^}]*font-size: min\(1\.45rem, 5\.9vw\);/);
  assert.match(phone, /\.bunny \{[^}]*height: min\(76px, 19\.5vw\);/);
});

test('"Tees from $29" is true: the cheapest tee on sale costs exactly $29 (John 10/17)', () => {
  const tees = shopProducts.filter((p) => /-tee$/.test(p.slug));
  assert.ok(tees.length > 0);
  const prices = tees.flatMap((p) => p.variants.map((v) => Number(v.price)));
  assert.ok(prices.every(Number.isFinite), "every tee variant has a price");
  assert.equal(Math.min(...prices), 29);
  assert.ok(BENEFITS.includes("Tees from $29"));
});

test("no scroll bounce: the page root has overscroll-behavior none (John 10/17)", () => {
  const g = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
  assert.match(/\nhtml \{[^}]*\}/.exec(g)?.[0] ?? "", /overscroll-behavior: none;/);
});
