// Site-level decisions (John, 2026-10-12): the old $27 pelican is retired and
// redirects to the Pelican Tee's Grind Beanie style; "Version" reads "Print: Big / Small".
// (2026-10-16): the original Yoycol Blue Sky Cotton Shorts are back on sale and the
// Printful Sky Shorts are retired, redirecting to them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import nextConfig from "../next.config.ts";
import legacy, { getPriceLabel, getTotalPrice, vendorDelivery } from "../public/products.ts";
import { homeCards, shopCards } from "../lib/shop-cards.ts";
import { allShopProducts, getShopProduct, getShopProductIncludingRetired, shopProducts } from "../lib/catalog/index.ts";
import { retiredCatalog, retiredOptions } from "../lib/catalog/retired.ts";
import { catalogFulfilment } from "../lib/catalog/fulfilment.generated.ts";
import { creditLinesFor, imagesFor, normalizeSelection } from "../lib/catalog/select.ts";
import { catalogRank, optionTitle, valueLabel } from "../lib/catalog/copy.ts";
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

// $45 total S–3XL, 4XL $47, 5XL $49 (John, 2026-10-20; $40/$42/$44 from 10/16), shipping included.
const SHORTS_TOTAL_CENTS: Record<string, number> = { S: 4500, M: 4500, L: 4500, XL: 4500, "2XL": 4500, "3XL": 4500, "4XL": 4700, "5XL": 4900 };

test("the original Blue Sky Cotton Shorts are on sale again through Yoycol: S–5XL, 3–4 weeks", () => {
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
  assert.equal(cards[0].price, "From $45", "4XL/5XL cost more");
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
    assert.equal(priced.item.unitAmount, SHORTS_TOTAL_CENTS[size], `${size} with shipping included`);
    assert.equal(priced.shippingCents, 0, size);
    assert.deepEqual(priced.delivery, vendorDelivery.yoycol, size);
  }
  const params = checkoutSessionParams(buildItem(id, { size: "M" }, 1, {}));
  assert.equal(params.line_items![0].price_data!.unit_amount, 4500);
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

test("the shorts cost $45 in S–3XL, $47 in 4XL and $49 in 5XL (John 10/20): page, checkout and Stripe line follow the size", () => {
  const id = "blue-sky-cotton-shorts";
  const p = legacy.products.find((x) => x.id === id)!;
  for (const size of ["S", "M", "L", "XL", "2XL", "3XL"]) {
    assert.equal(getTotalPrice(p, size), 45, size);
    assert.equal(getPriceLabel(p, size), "$45", size);
    assert.equal(buildItem(id, { size }, 1, {}).item.unitAmount, 4500, size);
  }
  assert.equal(getTotalPrice(p, "4XL"), 47);
  assert.equal(getTotalPrice(p, "5XL"), 49);
  assert.equal(getPriceLabel(p, "4XL"), "$47");
  assert.equal(getPriceLabel(p, "5XL"), "$49");
  // before a size is picked the page (and card) say "From $45"
  assert.equal(getPriceLabel(p), "From $45");
  assert.equal(buildItem(id, { size: "4XL" }, 1, {}).item.unitAmount, 4700);
  assert.equal(buildItem(id, { size: "5XL" }, 1, {}).item.unitAmount, 4900);
  // the Stripe line carries the size's price, shipping stays free, quantity multiplies the line
  for (const [size, cents] of [["3XL", 4500], ["4XL", 4700], ["5XL", 4900]] as const) {
    const params = checkoutSessionParams(buildItem(id, { size }, 2, {}));
    assert.equal(params.line_items![0].price_data!.unit_amount, cents, size);
    assert.equal(params.line_items![0].quantity, 2, size);
    assert.equal(params.shipping_options![0].shipping_rate_data!.fixed_amount!.amount, 0, size);
    assert.match(params.metadata!.mop_summary ?? "", new RegExp(`${size}`), size);
  }
  // one-price legacy products are unchanged
  const dress = legacy.products.find((x) => x.id === "clouds-skater-dress")!;
  assert.equal(getTotalPrice(dress, "M"), getTotalPrice(dress));
  assert.equal(getPriceLabel(dress), `$${getTotalPrice(dress)}`);
  assert.equal(buildItem("pelican-beanie-t-shirt", { color: "White", size: "5XL" }, 1, {}).item.unitAmount, 2700);
});

test("the shorts are 3rd on the home grid (John 10/16); their rank keeps them near the top of the full list", () => {
  const home = homeCards().map((c) => c.href.split("?")[0].slice(1));
  assert.equal(home.indexOf("blue-sky-cotton-shorts"), 2, home.join(", "));
  // shopCards (every card on sale, also the Meta "unavailable" page): where the Printful Sky Shorts sat
  const all = shopCards().map((c) => c.href.split("?")[0].slice(1));
  const at = all.indexOf("blue-sky-cotton-shorts");
  // every generated card before them ranks above the old Sky Shorts slot (2), every one after below it
  for (const slug of all.slice(0, at)) assert.ok(catalogRank(slug) <= 2, `${slug} before the shorts`);
  for (const slug of all.slice(at + 1).filter((s) => getShopProduct(s))) assert.ok(catalogRank(slug) > 2, `${slug} after the shorts`);
  assert.equal(legacy.products.find((x) => x.id === "blue-sky-cotton-shorts")!.rank, catalogRank("sky-shorts"));
  // the other older products still come after every generated one
  assert.ok(all.indexOf("clouds-skater-dress") > all.indexOf("star-snapback"));
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

test("the Sky Tee keeps six skies (John 10/20, Last Light added 10/21): Midnight and the other six are off the picker, cards, feeds and bag, refused at checkout, but checkouts started before still go to Printful", () => {
  const slug = "sky-tee";
  const RETIRED = ["sunset-glow", "mackerel-sky", "above-the-clouds", "cloud-study", "golden-hour", "roman-sunset", "midnight"];
  assert.deepEqual(retiredOptions[slug], { sky: RETIRED });
  const p = getShopProduct(slug)!;
  // picker order: Daydream (the default) first, then the two night skies that replaced Midnight; Last Light after Orbital Sunset
  assert.deepEqual(p.options.sky, ["daydream", "milky-way", "cosmic-cliffs", "aurora", "orbital-sunset", "last-light"]);
  assert.deepEqual(p.options.sky!.map((v) => valueLabel("sky", v, p.optionLabels)), ["Daydream", "Milky Way", "Cosmic Cliffs", "Aurora", "Orbital Sunset", "Last Light"]);
  assert.ok(p.variants.every((v) => !RETIRED.includes(v.opts.sky)));
  assert.equal(p.variants.length, 6 * p.options.size!.length);
  // the card shows one swatch per kept sky, in picker order (the home Featured card stays on
  // Orbital Sunset: test/featured.test.ts)
  const card = shopCards().find((c) => c.href.split("?")[0] === `/${slug}`)!;
  assert.deepEqual(card.swatches?.map((s) => s.label), ["Daydream", "Milky Way", "Cosmic Cliffs", "Aurora", "Orbital Sunset", "Last Light"]);
  // a link to a retired sky opens on the default sky (Daydream, the first)
  assert.equal(normalizeSelection(p, { sky: "sunset-glow" }).sky, "daydream");
  assert.equal(normalizeSelection(p, { sky: "golden-hour" }).sky, "daydream");
  assert.equal(normalizeSelection(p, { sky: "midnight" }).sky, "daydream");
  assert.equal(normalizeSelection(p).sky, "daydream");
  for (const flavor of ["google", "meta"] as const) {
    const xml = googleFeedXml(shopProducts, new Date(), flavor);
    for (const sky of RETIRED) assert.doesNotMatch(xml, new RegExp(`sky-tee[^<]*${sky}`), `${flavor} ${sky}`);
    assert.match(xml, /orbital-sunset/, flavor);
  }

  // the full product (every sky, its Printful variants and images) stays for paid orders
  const all = getShopProductIncludingRetired(slug)!;
  assert.equal(all.options.sky!.length, 13);
  const old = all.variants.find((v) => v.opts.sky === "sunset-glow" && v.opts.size === "M")!;
  const fid = feedId(slug, old.opts);
  assert.equal(lineView({ id: fid, qty: 1 }), null);
  assert.deepEqual(resolveMetaCart([{ id: fid, qty: 1 }], {}).skipped, [{ id: fid, reason: "unknown id" }]);
  assert.deepEqual(resolveMetaCart([{ id: fid, qty: 1 }], {}, { products: allShopProducts }).skipped, [
    { id: fid, slug, reason: "no longer available" },
  ]);
  assert.deepEqual(checkoutBlock(slug, { sky: "sunset-glow", size: "M" }), { status: 410, error: "no longer available" });
  assert.deepEqual(checkoutBlock(slug, { sky: "Mackerel-Sky" }), { status: 410, error: "no longer available" });
  assert.equal(checkoutBlock(slug, { sky: "orbital-sunset", size: "XL" }), null);
  // a paid checkout started before the cut still maps to its Printful variant
  const { item } = buildItem(slug, { sky: "sunset-glow", size: "M" }, 1, {});
  assert.equal(item.printful?.syncVariantId, catalogFulfilment[slug].variants["sunset-glow|M"].syncVariantId);
  assert.deepEqual(itemsFromSessionMetadata(sessionMetadata([item])), [item]);
  // Midnight too: refused for new checkouts, but its Printful product (480750267) still maps
  assert.deepEqual(checkoutBlock(slug, { sky: "midnight", size: "XL" }), { status: 410, error: "no longer available" });
  assert.equal(buildItem(slug, { sky: "midnight", size: "XL" }, 1, {}).item.printful?.syncVariantId, 5568376631);
});

test("the two night skies (John 10/20): Milky Way and Cosmic Cliffs sell like the other skies, with their exact CC BY credit lines", () => {
  const slug = "sky-tee";
  const p = getShopProduct(slug)!;
  const NEW = {
    "milky-way": {
      label: "Milky Way",
      // Printful "MOP · Sky Tee — Milky Way" (483492895), XS..2XL
      ids: [5585834433, 5585834434, 5585834436, 5585834438, 5585834440, 5585834441],
      credit: "Photo: ESO/B. Tafreshi (twanight.org) (CC BY 4.0), cropped, stars brightened, colours boosted",
    },
    "cosmic-cliffs": {
      label: "Cosmic Cliffs",
      // Printful "MOP · Sky Tee — Cosmic Cliffs" (483492897), XS..2XL
      ids: [5585834477, 5585834479, 5585834480, 5585834482, 5585834487, 5585834492],
      credit: "Image: NASA, ESA, CSA, and STScI (CC BY 4.0), cropped, stars brightened",
    },
  };
  const sizes = ["XS", "S", "M", "L", "XL", "2XL"];
  assert.deepEqual(p.options.size, sizes);
  for (const [sky, n] of Object.entries(NEW)) {
    assert.equal(valueLabel("sky", sky, p.optionLabels), n.label);
    // the same sizes and price as the other skies, each on its own Printful sync variant
    sizes.forEach((size, i) => {
      const v = p.variants.find((x) => x.opts.sky === sky && x.opts.size === size)!;
      assert.equal(v.price, p.variants.find((x) => x.opts.sky === "aurora" && x.opts.size === size)!.price, `${sky} ${size}`);
      assert.equal(catalogFulfilment[slug].variants[`${sky}|${size}`].syncVariantId, n.ids[i]);
      assert.equal(checkoutBlock(slug, { sky, size }), null);
      const { item, description } = buildItem(slug, { sky, size }, 1, {});
      assert.equal(item.printful?.syncVariantId, n.ids[i]);
      assert.equal(description, `Sky: ${n.label}, Size: ${size}`);
    });
    // the same photo set as Midnight had: model, back-of-model, flat, flat back (+ checkout JPEG, swatch)
    const set = p.images.find((s) => s.when.sky === sky)!;
    assert.deepEqual(set.images.map((src) => src.split("/").pop()!.replace(/\.[0-9a-f]{8}\.webp$/, "")),
      [`${sky}-model-left-front`, `${sky}-model2`, `${sky}-flat`, `${sky}-back`]);
    assert.match(set.checkout!, new RegExp(`/sky-tee/${sky}-model-left-front\\.[0-9a-f]{8}-checkout\\.jpg$`));
    assert.match(set.swatch!, new RegExp(`/sky-tee/${sky}-flat\\.[0-9a-f]{8}-swatch\\.webp$`));
    // the credit (required by CC BY): only this sky's line, shown exactly as written (no "by" byline, no avatar)
    const lines = creditLinesFor(p, { sky, size: "M" });
    assert.deepEqual(lines, [n.credit]);
    const design = designFromCreditLines(lines)!;
    assert.deepEqual(design.credits, []);
    assert.equal(creditText(design), n.credit);
    for (const flavor of ["google", "meta"] as const)
      assert.match(googleFeedXml(shopProducts, new Date(), flavor), new RegExp(feedId(slug, { sky, size: "M" })), `${flavor} ${sky}`);
  }
  // the other skies keep their own credit lines
  assert.deepEqual(creditLinesFor(p, { sky: "aurora", size: "M" }), ["Photo: NASA (ISS)"]);
});

test("Last Light (John 10/21): the wrap-around sunset sells like the other skies, after Orbital Sunset, with its exact CC BY credit line", () => {
  const slug = "sky-tee";
  const p = getShopProduct(slug)!;
  const sky = "last-light";
  // Printful "MOP · Sky Tee — Last Light" (483729900), XS..2XL, stitch white
  const ids = [5587201073, 5587201074, 5587201075, 5587201077, 5587201078, 5587201079];
  const credit = "Sun: Hari Samynaath (CC BY 4.0) · Sky and clouds: M. Roselund/ESO (CC BY 4.0) · Sea: Rick Obst (CC BY 4.0) · modified";
  assert.equal(valueLabel("sky", sky, p.optionLabels), "Last Light");
  assert.equal(p.options.sky!.indexOf(sky), p.options.sky!.indexOf("orbital-sunset") + 1);
  // the page still opens on Daydream
  assert.equal(normalizeSelection(p).sky, "daydream");
  ["XS", "S", "M", "L", "XL", "2XL"].forEach((size, i) => {
    const v = p.variants.find((x) => x.opts.sky === sky && x.opts.size === size)!;
    assert.equal(v.price, p.variants.find((x) => x.opts.sky === "orbital-sunset" && x.opts.size === size)!.price, size);
    assert.equal(catalogFulfilment[slug].variants[`${sky}|${size}`].syncVariantId, ids[i]);
    assert.equal(checkoutBlock(slug, { sky, size }), null);
    const { item, description } = buildItem(slug, { sky, size }, 1, {});
    assert.equal(item.printful?.syncVariantId, ids[i]);
    assert.equal(description, `Sky: Last Light, Size: ${size}`);
  });
  // the night skies' photo set, with the model from the right front so the shoulder sun shows (+ checkout JPEG, swatch)
  const set = p.images.find((s) => s.when.sky === sky)!;
  assert.deepEqual(set.images.map((src) => src.split("/").pop()!.replace(/\.[0-9a-f]{8}\.webp$/, "")),
    [`${sky}-model-right-front`, `${sky}-model2`, `${sky}-flat`, `${sky}-back`]);
  assert.match(set.checkout!, new RegExp(`/sky-tee/${sky}-model-right-front\\.[0-9a-f]{8}-checkout\\.jpg$`));
  assert.match(set.swatch!, new RegExp(`/sky-tee/${sky}-flat\\.[0-9a-f]{8}-swatch\\.webp$`));
  for (const src of [...set.images, set.checkout!, set.swatch!]) assert.ok(existsSync(path.join(process.cwd(), "public", src)), src);
  // the credit (CC BY): only this sky's line, shown exactly as written ("(CC BY 4.0)" is not a byline: no artist, no avatar)
  const lines = creditLinesFor(p, { sky, size: "M" });
  assert.deepEqual(lines, [credit]);
  const design = designFromCreditLines(lines)!;
  assert.deepEqual(design.credits, []);
  assert.equal(creditText(design), credit);
  for (const flavor of ["google", "meta"] as const)
    assert.match(googleFeedXml(shopProducts, new Date(), flavor), new RegExp(feedId(slug, { sky, size: "M" })), `${flavor} ${sky}`);
  // the home Featured card still opens on Orbital Sunset (test/featured.test.ts) and the Sky Tee card counts 6 skies
  const card = shopCards().find((c) => c.href.split("?")[0] === `/${slug}`)!;
  assert.equal(card.swatches?.length, 6);
});
