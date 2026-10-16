// Site-level decisions (John, 2026-10-12): the old $27 pelican is retired and
// redirects to the Pelican Tee's Grind Beanie style; "Version" reads "Print: Big / Small".
// (2026-10-16): the original Yoycol Blue Sky Cotton Shorts are back on sale and the
// Printful Sky Shorts are retired, redirecting to them.
import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";
import legacy, { vendorDelivery } from "../public/products.ts";
import { shopCards } from "../lib/shop-cards.ts";
import { allShopProducts, getShopProduct, getShopProductIncludingRetired, shopProducts } from "../lib/catalog/index.ts";
import { retiredCatalog } from "../lib/catalog/retired.ts";
import { catalogFulfilment } from "../lib/catalog/fulfilment.generated.ts";
import { creditLinesFor, imagesFor, normalizeSelection } from "../lib/catalog/select.ts";
import { optionTitle, valueLabel } from "../lib/catalog/copy.ts";
import { buildItem, checkoutBlock, itemSummary } from "../lib/orders/build-items.ts";
import { checkoutSessionParams } from "../lib/orders/checkout.ts";
import { itemsFromSessionMetadata, sessionMetadata } from "../lib/orders/metadata.ts";
import { resolveMetaCart } from "../lib/orders/meta-checkout.ts";
import { itemsFromLineItems } from "../lib/orders/session.ts";
import { rulesFor } from "../lib/orders/royalties.ts";
import { yoycolFor } from "../lib/orders/yoycol-config.ts";
import { lineView } from "../lib/bag.ts";
import { feedId, googleFeedXml } from "../lib/google-feed.ts";
import { creditText, designFromCreditLines } from "../lib/artists.ts";

test("the old $27 pelican is off the home grid but still in the product data", () => {
  const hrefs = shopCards().map((c) => c.href);
  assert.ok(!hrefs.includes("/pelican-beanie-t-shirt"));
  assert.ok(hrefs.includes("/clouds-skater-dress"), "the dress is still listed");
  assert.ok(legacy.products.some((p) => p.id === "pelican-beanie-t-shirt" && p.retired));
});

test("retired URLs redirect permanently: the old pelican to the beanie style, the Printful Sky Shorts to the original shorts", async () => {
  const redirects = await nextConfig.redirects!();
  assert.deepEqual(redirects, [
    { source: "/pelican-beanie-t-shirt", destination: "/pelican-tee?style=beanie", statusCode: 301 },
    { source: "/sky-shorts", destination: "/blue-sky-cotton-shorts", statusCode: 301 },
  ]);
  // the original shorts' own page is live again: nothing sends it away
  assert.ok(!redirects.some((r) => r.source === "/blue-sky-cotton-shorts"));
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

test("the old-sky Yoycol shirt is 'coming back soon': off the grid, no new checkouts, old orders still map", () => {
  const hrefs = shopCards().map((c) => c.href);
  const id = "clouds-in-sky-shirt";
  assert.ok(!hrefs.includes(`/${id}`), `${id} hidden`);
  const p = legacy.products.find((x) => x.id === id)!;
  assert.equal(p.comingSoon?.message, "Coming back soon with a new sky");
  assert.deepEqual(checkoutBlock(id), { status: 409, error: "coming back soon with a new sky" });
  // a paid order from a checkout started before still goes to Yoycol
  const { item } = buildItem(id, { size: "M" }, 1, {});
  assert.equal(item.supplier, "yoycol");
  assert.deepEqual(checkoutBlock("pelican-beanie-t-shirt"), { status: 410, error: "no longer available" });
  assert.equal(checkoutBlock("pelican-tee"), null);
  assert.equal(checkoutBlock("clouds-skater-dress"), null);
});

const SHORTS_SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

test("the original Blue Sky Cotton Shorts are on sale again through Yoycol: $40 every size S–5XL, 3–4 weeks", () => {
  const id = "blue-sky-cotton-shorts";
  const p = legacy.products.find((x) => x.id === id)!;
  assert.equal(p.retired, undefined);
  assert.equal(p.comingSoon, undefined);
  assert.equal(p.superseded, undefined);
  assert.deepEqual(p.vendor, { platform: "yoycol", productId: "ID LRWGN" });
  assert.deepEqual(p.options.size, SHORTS_SIZES);
  assert.match(p.description, /100% cotton/);
  assert.match(p.description, /245\sg\/m²/); // (a narrow no-break space)
  // on the home grid, with the honest Yoycol delivery time
  const cards = shopCards().filter((c) => c.href === `/${id}`);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].price, "$40");
  assert.equal(cards[0].freeShipping, true);
  assert.equal(cards[0].delivery, vendorDelivery.yoycol.text);
  assert.match(cards[0].delivery, /3–4 weeks/);
  // new checkouts are allowed and go to Yoycol's saved template (spu 3MPXZT40, design LRWGN)
  assert.equal(checkoutBlock(id), null);
  assert.deepEqual(yoycolFor(id, {}), { spu: "3MPXZT40", designCode: "LRWGN", colorHex: "FFFFFF", templateName: "Clouds Cotton Shorts" });
  for (const size of SHORTS_SIZES) {
    const priced = buildItem(id, { size }, 1, {});
    assert.equal(priced.item.supplier, "yoycol", size);
    assert.deepEqual(priced.item.yoycol, { designCode: "LRWGN", skuCode: `ADS-3MPXZT40-00000-FFFFFF-${size}` }, size);
    assert.equal(priced.item.unitAmount, 4000, `${size} is $40 with shipping included`);
    assert.equal(priced.shippingCents, 0, size);
    assert.deepEqual(priced.delivery, vendorDelivery.yoycol, size);
  }
  const params = checkoutSessionParams(buildItem(id, { size: "M" }, 1, {}));
  assert.equal(params.line_items![0].price_data!.unit_amount, 4000);
  assert.equal(params.shipping_options![0].shipping_rate_data!.fixed_amount!.amount, 0);
  assert.deepEqual(params.shipping_options![0].shipping_rate_data!.delivery_estimate, {
    minimum: { unit: "business_day", value: vendorDelivery.yoycol.minBusinessDays },
    maximum: { unit: "business_day", value: vendorDelivery.yoycol.maxBusinessDays },
  });
  assert.equal(params.phone_number_collection?.enabled, true, "Yoycol needs the recipient's phone");
  assert.deepEqual(itemsFromSessionMetadata(params.metadata as Record<string, string>)![0].yoycol, {
    designCode: "LRWGN",
    skuCode: "ADS-3MPXZT40-00000-FFFFFF-M",
  });
});

test("the Printful Sky Shorts are retired: off the grid, feeds and bag, no new checkouts, but checkouts started before still go to Printful", () => {
  const slug = "sky-shorts";
  assert.deepEqual(retiredCatalog[slug], { redirectTo: "/blue-sky-cotton-shorts" });
  // off sale everywhere a customer could find or start it
  assert.equal(getShopProduct(slug), undefined);
  assert.ok(!shopProducts.some((p) => p.slug === slug));
  assert.ok(!shopCards().some((c) => c.href.split("?")[0] === `/${slug}`));
  for (const flavor of ["google", "meta"] as const)
    assert.doesNotMatch(googleFeedXml(shopProducts, new Date(), flavor), /sky-shorts/, flavor);
  assert.deepEqual(checkoutBlock(slug), { status: 410, error: "no longer available" });

  // ...but the Printful product, its images and its prices stay (history + old checkouts)
  const p = getShopProductIncludingRetired(slug)!;
  assert.ok(p, "still in the generated catalog");
  assert.ok(allShopProducts.includes(p));
  assert.equal(p.printfulCatalogProductId, 1481);
  assert.deepEqual(p.options.size, ["XS", "S", "M", "L", "XL", "2XL", "3XL"]);
  const SIZE_PRICE: Record<string, number> = { XS: 40, S: 40, M: 40, L: 40, XL: 40, "2XL": 42, "3XL": 44 };
  assert.ok(p.variants.every((v) => v.price === SIZE_PRICE[v.opts.size]), JSON.stringify(p.variants.map((v) => [v.opts.size, v.price])));
  assert.equal(Object.keys(catalogFulfilment[slug].variants).length, 7);
  assert.ok(imagesFor(p, normalizeSelection(p)).length > 0);
  assert.deepEqual(creditLinesFor(p, normalizeSelection(p)), ["Sky photo: John Robert McPherson (CC0)"]);
  assert.deepEqual(rulesFor(slug), []);

  // a bag line or Meta cart for it is refused
  const v3xl = p.variants.find((v) => v.opts.size === "3XL")!;
  const fid = feedId(slug, v3xl.opts);
  assert.equal(lineView({ id: fid, qty: 1 }), null);
  assert.deepEqual(resolveMetaCart([{ id: fid, qty: 1 }], {}).skipped, [{ id: fid, reason: "unknown id" }]);
  // (even if its variant ids were still indexed, checkoutBlock refuses it)
  assert.deepEqual(resolveMetaCart([{ id: fid, qty: 1 }], {}, { products: allShopProducts }).skipped, [
    { id: fid, slug, reason: "no longer available" },
  ]);

  // a paid checkout started before the switch (mop_* metadata) still goes to Printful
  const { item } = buildItem(slug, { size: "3XL" }, 1, {});
  assert.equal(item.supplier, "printful");
  assert.equal(item.unitAmount, 4400); // 3XL = $44
  assert.equal(item.printful?.syncVariantId, catalogFulfilment[slug].variants["3XL"].syncVariantId);
  assert.deepEqual(itemsFromSessionMetadata(sessionMetadata([item])), [item]);
  assert.equal(itemSummary(item), "3XL");
  // ...and so does one rebuilt from Stripe line items (no mop_* metadata)
  const [old] = itemsFromLineItems(
    [{ quantity: 1, price: { unit_amount: 4000, product: { name: "Sky Shorts", metadata: { productId: slug, size: "M" } } } }],
    {}
  );
  assert.equal(old.supplier, "printful");
  assert.equal(old.printful?.syncVariantId, catalogFulfilment[slug].variants["M"].syncVariantId);
  assert.equal(old.unitAmount, 4000);
});
