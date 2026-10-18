// Phone cards (two per row) use short names; everything else keeps the full ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { shortName, shortNames, featured } from "../lib/catalog/copy.ts";
import { getShopProduct, shopProducts } from "../lib/catalog/index.ts";
import { featuredCards, restCards, shopCards } from "../lib/shop-cards.ts";
import { googleFeedXml } from "../lib/google-feed.ts";
import { buildItem } from "../lib/orders/build-items.ts";
import { checkoutSessionParams } from "../lib/orders/checkout.ts";
import { productShareTitle } from "../lib/share-meta.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("the short-name map: real products, really shorter, and the list John asked for", () => {
  for (const [slug, short] of Object.entries(shortNames)) {
    const p = getShopProduct(slug);
    assert.ok(p, `${slug} is a product`);
    assert.ok(short.length < p.title.length, `${slug}: "${short}" is shorter than "${p.title}"`);
  }
  assert.equal(shortNames["day-all-over"], "Day All-Over");
  assert.equal(shortNames["dusk-all-over"], "Dusk All-Over");
  assert.equal(shortNames["night-all-over"], "Night All-Over");
  assert.equal(shortName("gold-stripes", "Gold Stripes"), "Gold Stripes"); // its full title is short now (10/18)
  assert.equal(shortNames["original-star-tee"], "Original Star Tee");
  assert.equal(shortName("pelican-tee", "Pelican Tee"), "Pelican Tee"); // not listed: the full name
});

test("every Featured and home-grid card has a phone name of at most 22 characters, and keeps its full title", () => {
  const cards = [...featuredCards(), ...restCards()];
  assert.equal(cards.length, shopCards().length);
  for (const c of cards) {
    const slug = c.href.split("?")[0].slice(1);
    const p = getShopProduct(slug);
    assert.equal(c.title, p?.title ?? c.title, `${slug} keeps its full title (alt text uses it)`);
    assert.equal(c.shortTitle, shortName(slug, c.title), slug);
    assert.ok(c.shortTitle.length <= 22, `${slug}: "${c.shortTitle}" fits two lines on a phone card`);
  }
  for (const f of featured.items) assert.ok(featuredCards().some((c) => c.href.startsWith(`/${f.slug}`)), f.slug);
});

test("feeds, Stripe and the share cards keep the full names", () => {
  const feed = googleFeedXml(shopProducts, new Date(), "meta") + googleFeedXml(shopProducts, new Date(), "google");
  for (const slug of Object.keys(shortNames)) {
    const p = getShopProduct(slug)!;
    const esc = p.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    assert.ok(feed.includes(`<g:title>${esc}`), `feed: ${p.title}`);
    const params = checkoutSessionParams(buildItem(slug, p.variants[0].opts, 1, {}));
    assert.equal(params.line_items![0].price_data!.product_data!.name, p.title);
    assert.ok(productShareTitle(p).startsWith(p.title), `share: ${p.title}`);
  }
});

test("the card renders the full name and the phone name; the image keeps the full name as alt text", () => {
  const src = readFileSync(path.join(ROOT, "components/ProductCard.tsx"), "utf8");
  assert.match(src, /alt=\{title\}/);
  assert.match(src, /styles\.fullTitle\}>\{title\}/);
  assert.match(src, /styles\.shortTitle\}>\{shortTitle\}/);
  // phones ask for about half the screen
  assert.match(src, /sizes="\(max-width: 768px\) calc\(50vw - 34px\)/);
});
