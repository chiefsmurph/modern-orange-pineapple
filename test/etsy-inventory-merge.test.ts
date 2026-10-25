// scripts/etsy add-colors / replace-photos: keeping a live listing's inventory exactly while
// colours are appended, and planning photo swaps (no network). The inventory below has the
// shape of a real getListingInventory answer (10/25: Money prices, "Size" property name,
// Etsy's migrated value ids); every id in it is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendColors,
  assertKeepsLive,
  compareInventories,
  liveColors,
  liveToRequest,
  moneyToDecimal,
  planAddedImages,
  planReplaceImages,
  productKey,
} from "../scripts/etsy/lib/inventory-merge.mjs";
import { parseListingMd } from "../scripts/etsy/lib/listing-md.mjs";

const SIZES: [string, number, number][] = [
  ["S", 900001, 3827], ["M", 900002, 3827], ["L", 900003, 3827], ["XL", 900004, 3827],
  ["2X", 900005, 4027], ["3X", 900006, 4227], ["4X", 900007, 4427],
];
const LIGHT: [string, number][] = [["Lagoon Blue", 800001], ["Ivory", 800002], ["Butter", 800003], ["Washed Denim", 800004]];
const READY = 333;

function liveInventory({ skus = false, colors = LIGHT } = {}) {
  let pid = 1000;
  const products = colors.flatMap(([color, cid]) =>
    SIZES.map(([size, sid, amount]) => ({
      product_id: ++pid,
      sku: skus ? `PF_${cid}_${sid}` : "",
      is_deleted: false,
      offerings: [{ offering_id: pid + 50000, quantity: 999, is_enabled: true, is_deleted: false, price: { amount, divisor: 100, currency_code: "USD" }, readiness_state_id: READY }],
      property_values: [
        { property_id: 200, property_name: "Primary color", scale_id: null, scale_name: null, value_ids: [cid], values: [color] },
        { property_id: 62809790533, property_name: "Size", scale_id: 51, scale_name: "Unisex letter size", value_ids: [sid], values: [size] },
      ],
    })),
  );
  return {
    products,
    price_on_property: skus ? [200, 62809790533] : [62809790533],
    quantity_on_property: skus ? [200, 62809790533] : [],
    sku_on_property: skus ? [200, 62809790533] : [],
    readiness_state_on_property: [],
    listing: {},
  };
}

const LISTING_MD = `# 03 · Pelican Tee · Classic (Big print)

**Shop section:** Character tees

## Title

\`\`\`
Pelican T-Shirt, Original Art Pelican Tee on Comfort Colors Heavyweight Cotton
\`\`\`

## Tags (13)

\`\`\`
a, b, c, d, e, f, g, h, i, j, k, l, m
\`\`\`

## Materials

Cotton

## Price (by size)

S–XL $38.27 · 2XL $40.27 · 3XL $42.27 · 4XL $44.27

## Variations

Primary colour: Lagoon Blue, Ivory, Butter, Washed Denim, Black, Pepper, True Navy · Size: S–4XL (price varies by size)

## Description

\`\`\`
The MOP pelican.
\`\`\`

## Photos (upload in this order)

Folder: \`/tmp/photos/03\`

- \`01-model.jpg\`: Lagoon Blue, on model (1600×1600)
- \`03-lagoon-flat.jpg\`: Lagoon Blue, flat (1600×1600)
- \`04-ivory-flat.jpg\`: Ivory, flat (1600×1600)
- \`07-black-flat.jpg\`: Black, flat (1600×1600)
- \`08-pepper-flat.jpg\`: Pepper, flat (1600×1600)
- \`09-true-navy-flat.jpg\`: True Navy, flat (1600×1600)
`;
const LISTING = parseListingMd(LISTING_MD);
const DARK = ["Black", "Pepper", "True Navy"];

test("Money → decimal, exact to the cent", () => {
  assert.equal(moneyToDecimal({ amount: 3827, divisor: 100, currency_code: "USD" }), 38.27);
  assert.equal(moneyToDecimal({ amount: 4427, divisor: 100 }), 44.27);
  assert.equal(moneyToDecimal(40.27), 40.27);
  assert.throws(() => moneyToDecimal({ amount: 38271, divisor: 1000 }), /whole number of cents/);
  assert.throws(() => moneyToDecimal(null), /not Etsy Money/);
});

test("the live inventory goes back unchanged: ids, is_deleted and scale_name dropped, prices as decimals, skus kept", () => {
  const inv = liveInventory({ skus: true });
  const body = liveToRequest(inv);
  assert.equal(body.products.length, 28);
  const p = body.products[0];
  assert.deepEqual(Object.keys(p).sort(), ["offerings", "property_values", "sku"]);
  assert.equal(p.sku, inv.products[0].sku);
  assert.deepEqual(p.offerings, [{ price: 38.27, quantity: 999, is_enabled: true, readiness_state_id: READY }]);
  assert.deepEqual(p.property_values[1], { property_id: 62809790533, property_name: "Size", scale_id: 51, value_ids: [900001], values: ["S"] });
  assert.deepEqual(body.sku_on_property, [200, 62809790533]);
  assert.ok(!("listing" in body));
  const deleted = liveInventory();
  deleted.products[3].is_deleted = true;
  assert.throws(() => liveToRequest(deleted), /marked deleted/);
});

test("add-colors: 28 live products kept exactly, 21 dark ones appended at each size's price", () => {
  const inv = liveInventory();
  const { body, kept, added, alreadyLive } = appendColors(inv, LISTING, DARK);
  assert.equal(kept, 28);
  assert.equal(added.length, 21);
  assert.deepEqual(alreadyLive, []);
  assert.equal(body.products.length, 49);
  assertKeepsLive(inv, body);
  assert.deepEqual(body.products.slice(0, 28), liveToRequest(inv).products);
  const black2x = body.products.find((p: any) => productKey(p) === "Black / 2X");
  assert.deepEqual(black2x, {
    sku: "",
    property_values: [
      { property_id: 200, property_name: "Primary color", scale_id: null, value_ids: [1], values: ["Black"] },
      { property_id: 62809790533, property_name: "Size", scale_id: 51, value_ids: [900005], values: ["2X"] },
    ],
    offerings: [{ price: 40.27, quantity: 999, is_enabled: true, readiness_state_id: READY }],
  });
  const pepper = body.products.find((p: any) => productKey(p) === "Pepper / 4X");
  assert.deepEqual(pepper.property_values[0].value_ids, [], "a colour Etsy doesn't predefine goes in as a custom value");
  assert.equal(pepper.offerings[0].price, 44.27);
  assert.deepEqual(body.price_on_property, [62809790533]);
  assert.deepEqual(added.map((a: any) => a.key).slice(0, 7), ["Black / S", "Black / M", "Black / L", "Black / XL", "Black / 2X", "Black / 3X", "Black / 4X"]);
  assert.equal(added.find((a: any) => a.key === "True Navy / 3X").price, 4227);
});

test("add-colors on a Printful-built listing: its per-product SKUs and *_on_property fields are kept", () => {
  const inv = liveInventory({ skus: true });
  const { body } = appendColors(inv, LISTING, DARK);
  assertKeepsLive(inv, body);
  assert.deepEqual(body.products.slice(0, 28).map((p: any) => p.sku), inv.products.map((p: any) => p.sku));
  assert.deepEqual(body.quantity_on_property, [200, 62809790533]);
  assert.ok(body.products.slice(28).every((p: any) => p.sku === ""));
});

test("add-colors: colours already live are skipped; re-running changes nothing", () => {
  const inv = liveInventory({ colors: [...LIGHT, ["Black", 1]] });
  const r = appendColors(inv, LISTING, DARK);
  assert.deepEqual(r.alreadyLive, ["Black"]);
  assert.equal(r.added.length, 14);
  const all = liveInventory({ colors: [...LIGHT, ["Black", 1], ["Pepper", 800005], ["True Navy", 800006]] });
  const again = appendColors(all, LISTING, DARK);
  assert.equal(again.added.length, 0);
  assert.deepEqual(again.body, liveToRequest(all));
  assert.deepEqual(liveColors(all), ["Lagoon Blue", "Ivory", "Butter", "Washed Denim", "Black", "Pepper", "True Navy"]);
});

test("add-colors stops when the listing file's price disagrees with the live price, or a size isn't live", () => {
  const inv = liveInventory();
  for (const p of inv.products) if (p.property_values[1].values[0] === "3X") p.offerings[0].price.amount = 4237;
  assert.throws(() => appendColors(inv, LISTING, DARK), /3X: the listing file says \$42\.27, the live listing has \$42\.37/);
  const no4x = liveInventory();
  no4x.products = no4x.products.filter((p: any) => p.property_values[1].values[0] !== "4X");
  assert.throws(() => appendColors(no4x, LISTING, DARK), /no 4X product/);
});

test("assertKeepsLive catches any change to a live product or to the *_on_property fields", () => {
  const inv = liveInventory();
  const { body } = appendColors(inv, LISTING, DARK);
  const repriced = structuredClone(body);
  repriced.products[2].offerings[0].price = 38.28;
  assert.throws(() => assertKeepsLive(inv, repriced), /Lagoon Blue \/ L would change/);
  const dropped = structuredClone(body);
  dropped.products.splice(0, 1);
  assert.throws(() => assertKeepsLive(inv, dropped), /would change/);
  const moved = structuredClone(body);
  moved.sku_on_property = [200];
  assert.throws(() => assertKeepsLive(inv, moved), /sku_on_property would change/);
  const dupe = structuredClone(body);
  dupe.products.push(dupe.products[30]);
  assert.throws(() => assertKeepsLive(inv, dupe), /two products would be/);
});

test("after the PUT: kept vs new product ids, and any missing, changed or unexpected product", () => {
  const before = liveInventory();
  const { added } = appendColors(before, LISTING, DARK);
  // liveInventory numbers ids the same way each time, so the first 28 keep their ids
  const after = liveInventory({ colors: [...LIGHT, ["Black", 1], ["Pepper", 800005], ["True Navy", 800006]] });
  const same = compareInventories(before, after, added);
  assert.deepEqual(same, { missing: [], changed: [], unexpected: [], idsKept: 28, idsChanged: 0 });
  const renumbered = structuredClone(after);
  renumbered.products.forEach((p: any) => (p.product_id += 7000));
  assert.equal(compareInventories(before, renumbered, added).idsChanged, 28);
  const broken = structuredClone(after);
  broken.products[0].offerings[0].price.amount = 3927;
  broken.products = broken.products.filter((p: any) => productKey(p) !== "Pepper / M");
  const r = compareInventories(before, broken, added);
  assert.deepEqual(r.changed, ["Lagoon Blue / S: price 3827 → 3927 cents"]);
  assert.deepEqual(r.missing, ["Pepper / M"]);
  const extra = structuredClone(after);
  extra.products.push({ ...structuredClone(after.products[0]), property_values: [{ property_id: 200, values: ["Red"] }, after.products[0].property_values[1]] });
  assert.deepEqual(compareInventories(before, extra, added).unexpected, ["Red / S"]);
});

test("added photos: only the new colours', ranked after what's there, skipping ones already up; 20 max", () => {
  const existing = [1, 2, 3].map((rank) => ({ listing_image_id: rank, rank, alt_text: `x${rank}` }));
  const plan = planAddedImages(LISTING, DARK, existing);
  assert.deepEqual(plan.map((p: any) => [p.rank, p.file]), [[4, "07-black-flat.jpg"], [5, "08-pepper-flat.jpg"], [6, "09-true-navy-flat.jpg"]]);
  assert.equal(plan[0].path, "/tmp/photos/03/07-black-flat.jpg");
  assert.equal(plan[0].alt_text, "Pelican Tee · Classic (Big print): Black, flat");
  const partly = [...existing, { listing_image_id: 9, rank: 4, alt_text: "Pelican Tee · Classic (Big print): Black, flat" }];
  assert.deepEqual(planAddedImages(LISTING, DARK, partly).map((p: any) => [p.rank, p.file]), [[5, "08-pepper-flat.jpg"], [6, "09-true-navy-flat.jpg"]]);
  const full = Array.from({ length: 18 }, (_, i) => ({ listing_image_id: i + 1, rank: i + 1, alt_text: `m${i}` }));
  assert.throws(() => planAddedImages(LISTING, DARK, full), /Etsy max 20/);
});

test("replace photos: overwrite rank by rank (never past 20), skip ranks already done, delete the rest afterwards", () => {
  const planned = [1, 2, 3].map((rank) => ({ rank, file: `${rank}.jpg`, path: `/p/${rank}.jpg`, alt_text: `new ${rank}` }));
  const twenty = Array.from({ length: 20 }, (_, i) => ({ listing_image_id: 100 + i + 1, rank: i + 1, alt_text: "mockup" }));
  const plan = planReplaceImages(planned, twenty);
  assert.deepEqual(plan.uploads.map((u: any) => [u.rank, u.overwrite, u.replaces]), [[1, true, 101], [2, true, 102], [3, true, 103]]);
  assert.deepEqual(plan.skip, []);
  assert.deepEqual(plan.deleteAfter, twenty.slice(3).map((i) => i.listing_image_id));
  const rerun = [{ listing_image_id: 7, rank: 1, alt_text: "new 1" }, ...twenty.slice(1)];
  const again = planReplaceImages(planned, rerun);
  assert.deepEqual(again.skip.map((s: any) => [s.rank, s.listing_image_id]), [[1, 7]]);
  assert.deepEqual(again.uploads.map((u: any) => u.rank), [2, 3]);
  assert.ok(!again.deleteAfter.includes(7));
  const few = planReplaceImages(planned, [{ listing_image_id: 5, rank: 1, alt_text: "mockup" }]);
  assert.deepEqual(few.uploads.map((u: any) => [u.rank, u.overwrite]), [[1, true], [2, false], [3, false]]);
  assert.deepEqual(few.deleteAfter, []);
});
