// scripts/etsy link: colour/size parsing and the Etsy-variant → website-variant plan (no network).
// Fixtures in fixtures/etsy-printful/ are trimmed from real Printful answers of 10/25
// (no tokens, no file URLs): the hand-built, fully synced listing 04 in the Etsy store;
// the website's products for 04 and for Sky Tee 01; one real unsynced Etsy-store variant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ONE_SIZE, printfulSourceId } from "../scripts/etsy/lib/listing-md.mjs";
import {
  findWebsiteVariant,
  normColor,
  normSize,
  orderAttention,
  planLink,
  printFiles,
  variantColorSize,
  variantUpdate,
} from "../scripts/etsy/lib/printful-link.mjs";
import { websiteProductCommand } from "../scripts/etsy/lib/printful-client.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "etsy-printful");
const load = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));

const ETSY_04 = load("etsy-04-synced.json");
const WEB_04 = load("website-04.json");
const WEB_SKY = load("website-01-sky.json");
const UNSYNCED = load("etsy-unsynced-variant.json");
const PRICES = { S: 3827, M: 3827, L: 3827, XL: 3827, "2XL": 4027, "3XL": 4227, "4XL": 4427 };
const ETSY_LABEL: Record<string, string> = { "2XL": "2X", "3XL": "3X", "4XL": "4X" };

/** A variant as Printful first imports it from Etsy: the real unsynced shape, Etsy's size label in the name. */
function freshImport(product: any, variants: { id: number; color: string | null; size: string }[]) {
  return {
    sync_product: { ...product.sync_product, synced: 0 },
    sync_variants: variants.map((x) => ({
      ...UNSYNCED,
      id: x.id,
      is_ignored: false,
      name: [product.sync_product.name, x.color, ETSY_LABEL[x.size] ?? x.size].filter(Boolean).join(" / "),
    })),
  };
}

test("sizes: Etsy's 2X/3X/4X are Printful's 2XL/3XL/4XL; non-sizes are null", () => {
  assert.equal(normSize("2X"), "2XL");
  assert.equal(normSize("3x"), "3XL");
  assert.equal(normSize("4X"), "4XL");
  assert.equal(normSize("2XL"), "2XL");
  assert.equal(normSize(" s "), "S");
  assert.equal(normSize("XS"), "XS");
  assert.equal(normSize("Lagoon Blue"), null);
  assert.equal(normSize("6X"), null);
  assert.equal(normSize(null), null);
});

test("colour + size: from Printful's fields when synced, else from the name; the title prefix is stripped first", () => {
  const title = ETSY_04.sync_product.name;
  assert.deepEqual(variantColorSize(ETSY_04.sync_variants[0], title), { color: "Washed Denim", size: "S" });
  assert.deepEqual(variantColorSize(UNSYNCED, "Pelican With Beanie T-Shirt"), { color: "Light Blue", size: "4XL" });
  assert.deepEqual(variantColorSize({ name: `${title} / True Navy / 2X` }, title), { color: "True Navy", size: "2XL" });
  assert.deepEqual(variantColorSize({ name: "Sky Tee, All Over / XS" }, "Sky Tee, All Over"), { color: null, size: "XS" });
  assert.deepEqual(variantColorSize({ name: "A / B Title / 3X / Ivory" }, "A / B Title"), { color: "Ivory", size: "3XL" }, "a '/' in the title and size-first order both work");
  assert.throws(() => variantColorSize({ name: `${title} / Ivory / Huge` }, title), /can't read/);
  assert.throws(() => variantColorSize({ name: `${title} / Ivory / S / Long` }, title), /can't read/);
  assert.throws(() => variantColorSize({ name: "no separator" }, title), /can't read/);
});

test("listing file: the website sync product id comes from the Printful source line", () => {
  assert.equal(printfulSourceId("Printful store Modern Orange Pineapple → Pelican Tee, Big print, Grind Beanie (sync product 480715448)"), 480715448);
  assert.equal(printfulSourceId('"MOP · Clouds Skater Dress" (sync product 480725889, the 10/12 version)'), 480725889);
  assert.equal(printfulSourceId("The Original Star Tee, Big print, Star design"), null);
  assert.equal(printfulSourceId(null), null);
});

test("print files: mockups dropped, referenced by file id, type kept, position only when set", () => {
  const files = WEB_SKY.sync_variants[0].files;
  assert.deepEqual(printFiles(files), [
    { type: "front_dtfabric", id: 1090668200 },
    { type: "back_dtfabric", id: 1090668196 },
    { type: "sleeve_left_dtfabric", id: 1090668203 },
    { type: "sleeve_right_dtfabric", id: 1090668206 },
  ]);
  assert.deepEqual(printFiles(WEB_04.sync_variants[0].files), [{ type: "default", id: 1088326864 }], "the preview mockup is not copied");
  const pos = { area_width: 1800, area_height: 2400, width: 1800, height: 2400, top: 0, left: 0 };
  assert.deepEqual(printFiles([{ type: "back", id: 5, position: pos }]), [{ type: "back", id: 5, position: pos }]);
  assert.deepEqual(printFiles([{ type: "default", url: "https://example.com/a.png" }]), [{ type: "default", url: "https://example.com/a.png" }]);
  assert.throws(() => printFiles([{ type: "default", filename: "x.png" }]), /neither id nor url/);
});

test("04 is fully synced: the plan does nothing, and every synced variant carries the website's design", () => {
  const plan = planLink(ETSY_04, WEB_04, PRICES);
  assert.equal(plan.toLink.length, 0);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.counts, { total: 4, synced: 4, link: 0, ignored: 0, problem: 0, differs: 0 });
  assert.equal(plan.rows[0].variant_id, 21506);
  assert.deepEqual(plan.rows[0].files, ["mop-pelican-beanie-left-A-d.png"]);
});

test("an unsynced copy of 04 plans exactly what John built by hand (catalog variant, file id, options)", () => {
  const etsy = freshImport(ETSY_04, ETSY_04.sync_variants.map((v: any) => ({ id: v.id, color: v.color, size: v.size })));
  const plan = planLink(etsy, WEB_04, PRICES);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.toLink.length, 4);
  for (const step of plan.toLink) {
    const hand = ETSY_04.sync_variants.find((v: any) => v.id === step.id);
    assert.equal(step.body.variant_id, hand.variant_id, step.label);
    assert.deepEqual(step.body.files, printFiles(hand.files), step.label);
    assert.deepEqual(step.body.options, hand.options.map((o: any) => ({ id: o.id, value: o.value })), step.label);
    assert.equal(step.body.retail_price, hand.retail_price, `${step.label}: Etsy price`);
  }
  const lb2x = plan.toLink.find((s: any) => s.label === "Lagoon Blue / 2XL");
  assert.equal(lb2x.body.variant_id, 17683);
  assert.equal(lb2x.body.retail_price, "40.27");
  assert.deepEqual(Object.keys(lb2x.body).sort(), ["files", "options", "retail_price", "variant_id"]);
  assert.ok(lb2x.body.options.some((o: any) => o.id === "lifelike" && o.value === false));
});

test("dark colours pick up the website's -dark print file", () => {
  const etsy = freshImport(ETSY_04, [
    { id: 1, color: "Black", size: "S" },
    { id: 2, color: "Pepper", size: "L" },
    { id: 3, color: "True Navy", size: "3XL" },
    { id: 4, color: "Ivory", size: "M" },
  ]);
  const plan = planLink(etsy, WEB_04, PRICES);
  assert.deepEqual(plan.problems, []);
  const byLabel = Object.fromEntries(plan.rows.map((r: any) => [r.label, r]));
  for (const l of ["Black / S", "Pepper / L", "True Navy / 3XL"]) assert.deepEqual(byLabel[l].files, ["mop-pelican-beanie-left-A-d-dark.png"], l);
  assert.deepEqual(byLabel["Ivory / M"].files, ["mop-pelican-beanie-left-A-d.png"]);
  assert.equal(byLabel["True Navy / 3XL"].variant_id, 16332);
  assert.equal(byLabel["True Navy / 3XL"].retail_price, "42.27");
});

test("all-over Sky Tee: a size-only Etsy listing matches the one-colour website product; all 4 placements + options copy", () => {
  const etsy = freshImport({ sync_product: { id: 9, external_id: "4603013929", name: "Sky Tee, All Over Print", variants: 3, synced: 0 } }, [
    { id: 11, color: null, size: "XS" },
    { id: 12, color: null, size: "M" },
    { id: 13, color: null, size: "2XL" },
  ]);
  const plan = planLink(etsy, WEB_SKY, { XS: 4867, M: 4867, "2XL": 4867 });
  assert.deepEqual(plan.problems, []);
  const xs = plan.toLink.find((s: any) => s.label === "XS");
  assert.equal(xs.body.variant_id, 33937);
  assert.deepEqual(xs.body.files.map((f: any) => f.type), ["front_dtfabric", "back_dtfabric", "sleeve_left_dtfabric", "sleeve_right_dtfabric"]);
  assert.deepEqual(xs.body.options, [{ id: "stitch_color", value: "black" }, { id: "license_type", value: [] }]);
  assert.equal(plan.toLink.find((s: any) => s.label === "2XL").body.variant_id, 33942, "Etsy's 2X → the 2XL catalog variant");
  assert.equal(xs.body.retail_price, "48.67");
});

test("no exact match: the listing stops (unknown colour, missing size, colourless vs many colours); nothing is guessed", () => {
  const etsy = freshImport(ETSY_04, [
    { id: 1, color: "Ivory", size: "M" },
    { id: 2, color: "Lagoon  blue", size: "2XL" }, // case and spacing don't matter
    { id: 3, color: "Light Blue", size: "S" },
    { id: 4, color: "Ivory", size: "4XL" }, // not in the trimmed website fixture
  ]);
  const plan = planLink(etsy, WEB_04, PRICES);
  assert.equal(plan.counts.link, 2);
  assert.equal(plan.problems.length, 2);
  assert.match(plan.problems[0], /^Light Blue \/ S .*no website variant Light Blue \/ S/);
  assert.match(plan.problems[1], /no website variant Ivory \/ 4XL/);
  assert.match(findWebsiteVariant(WEB_04, null, "S").problem ?? "", /website product comes in 7 colours/);
  assert.equal(findWebsiteVariant(WEB_SKY, "White", "M").src.variant_id, 33939);
  assert.match(findWebsiteVariant(WEB_SKY, "Black", "M").problem ?? "", /no website variant Black \/ M/);
  const bad = freshImport(ETSY_04, [{ id: 5, color: "Ivory", size: "M" }]);
  bad.sync_variants[0].name = `${ETSY_04.sync_product.name} / Ivory / Medium`;
  assert.match(planLink(bad, WEB_04, PRICES).problems[0], /can't read colour\/size/);
});

test("ignored variants and synced ones that differ from the website are left alone, the latter flagged", () => {
  const ignored = { ...UNSYNCED, name: `${ETSY_04.sync_product.name} / Ivory / M` };
  const differs = { ...ETSY_04.sync_variants[0], files: [{ type: "default", id: 42, filename: "old.png" }] };
  const plan = planLink({ sync_product: ETSY_04.sync_product, sync_variants: [ignored, differs] }, WEB_04, PRICES);
  assert.deepEqual(plan.rows.map((r: any) => r.action), ["ignored", "synced"]);
  assert.equal(plan.toLink.length, 0);
  assert.match(plan.rows[1].differs, /mop-pelican-beanie-left-A-d\.png/);
  assert.equal(plan.counts.differs, 1);
});

test("retail_price: two-decimal string from cents; left out when the listing file has no price for the size", () => {
  assert.equal(variantUpdate(WEB_04.sync_variants[0], 4427).retail_price, "44.27");
  assert.ok(!("retail_price" in variantUpdate(WEB_04.sync_variants[0], null)));
  const etsy = freshImport(ETSY_04, [{ id: 1, color: "Ivory", size: "M" }]);
  const plan = planLink(etsy, WEB_04, { S: 3827 });
  assert.equal(plan.toLink.length, 1);
  assert.ok(!("retail_price" in plan.toLink[0].body));
  assert.match(plan.rows[0].note, /no M price/);
});

// The website's Star Snapback as Printful lists it (shape and spellings from the real 10/25
// answer; file ids made up): colour "Natural/ Black" with a space, size "One size".
const WEB_SNAP = {
  sync_product: { id: 480715419, name: "MOP · Star Snapback", variants: 2, synced: 2 },
  sync_variants: [
    { id: 1, name: "MOP · Star Snapback / Navy / One size", synced: true, is_ignored: false, variant_id: 4802, color: "Navy", size: "One size",
      files: [{ type: "embroidery_front_large", id: 900101, filename: "mop-hat-star-keyline.png" }, { type: "preview", id: 900102, filename: "mock.png" }],
      options: [{ id: "thread_colors_front_large", value: ["#FFFFFF"] }] },
    { id: 2, name: "MOP · Star Snapback / Natural/ Black / One size", synced: true, is_ignored: false, variant_id: 4801, color: "Natural/ Black", size: "One size",
      files: [{ type: "embroidery_front_large", id: 900103, filename: "mop-hat-star-original.png" }],
      options: [{ id: "thread_colors_front_large", value: ["#000000"] }] },
  ],
};

test("one size: 'One size' is a size; a one-part non-size name is a colour-only (one-size) Etsy variant", () => {
  assert.equal(normSize("One size"), ONE_SIZE);
  assert.equal(normSize("one-size"), ONE_SIZE);
  assert.equal(normSize("Navy"), null);
  assert.deepEqual(variantColorSize({ name: "Star Snapback Hat / Navy" }, "Star Snapback Hat"), { color: "Navy", size: ONE_SIZE });
  assert.deepEqual(variantColorSize({ name: "Star Snapback Hat / Natural/Black" }, "Star Snapback Hat"), { color: "Natural/Black", size: ONE_SIZE }, "a '/' inside the colour is kept");
  assert.deepEqual(variantColorSize({ name: "x", color: "Navy", size: "One size" }, "x"), { color: "Navy", size: ONE_SIZE }, "Printful's own fields when synced");
  assert.throws(() => variantColorSize({ name: "Star Snapback Hat / Navy / Huge" }, "Star Snapback Hat"), /can't read/, "two non-size parts still stop");
});

test("colours: Printful's 'Natural/ Black' is Etsy's 'Natural/Black'; case and spaces don't count", () => {
  assert.equal(normColor("Natural/ Black"), normColor("Natural/Black"));
  assert.equal(normColor(" natural /black "), "natural/black");
  assert.equal(normColor("Lagoon  Blue"), "lagoon blue");
  assert.notEqual(normColor("Natural/Black"), normColor("Natural Black"));
});

test("the snapback links: each colour-only Etsy variant takes its colour's One size website variant, embroidery file and thread options", () => {
  const title = "Embroidered Star Snapback Hat, Painted Zentangle Star Cap";
  const etsy = {
    sync_product: { id: 77, external_id: "4603999999", name: title, variants: 2, synced: 0 },
    sync_variants: [
      { ...UNSYNCED, id: 31, is_ignored: false, name: `${title} / Navy` },
      { ...UNSYNCED, id: 32, is_ignored: false, name: `${title} / Natural/Black` },
    ],
  };
  const plan = planLink(etsy, WEB_SNAP, { [ONE_SIZE]: 3662 });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.toLink.map((s: any) => [s.label, s.body.variant_id, s.body.files, s.body.retail_price]), [
    ["Navy / One size", 4802, [{ type: "embroidery_front_large", id: 900101 }], "36.62"],
    ["Natural/Black / One size", 4801, [{ type: "embroidery_front_large", id: 900103 }], "36.62"],
  ]);
  assert.deepEqual(plan.toLink[1].body.options, [{ id: "thread_colors_front_large", value: ["#000000"] }]);
  // a colour-only Etsy variant never matches a sized website product, and an unknown colour stops
  assert.match(findWebsiteVariant(WEB_04, "Ivory", ONE_SIZE).problem ?? "", /no website variant Ivory \/ One size/);
  assert.match(findWebsiteVariant(WEB_SNAP, "Red", ONE_SIZE).problem ?? "", /no website variant Red \/ One size/);
});

test("orders-check: draft / failed / on hold / in review and unsynced items need a look; shipped or cancelled don't", () => {
  const item = (variant_id: number | null) => ({ id: 1, name: "Pelican Tee / Ivory / M", quantity: 1, variant_id, files: [] });
  assert.deepEqual(orderAttention({ status: "onhold", items: [item(16524)] }), ["on hold"]);
  assert.deepEqual(orderAttention({ status: "failed", items: [item(16524)] }), ["failed"]);
  assert.deepEqual(orderAttention({ status: "draft", items: [item(null)] }), ["draft", "unsynced: Pelican Tee / Ivory / M"]);
  assert.deepEqual(orderAttention({ status: "inreview", items: [] }), ["inreview"]);
  assert.deepEqual(orderAttention({ status: "pending", items: [item(16524)] }), []);
  assert.deepEqual(orderAttention({ status: "inprocess", items: [item(0)] }), ["unsynced: Pelican Tee / Ivory / M"]);
  assert.deepEqual(orderAttention({ status: "fulfilled", items: [item(null)] }), []);
  assert.deepEqual(orderAttention({ status: "canceled", items: [item(null)] }), []);
  assert.deepEqual(orderAttention({ status: "pending", items: [{ ...item(null), warehouse_product_variant_id: 7 }] }), [], "a warehouse item has no catalog variant");
});

test("the server-side fetch: token read and used on the server only; the id must be a number", () => {
  const cmd = websiteProductCommand(480715448);
  assert.match(cmd, /grep -m1 -E '\^PRINTFUL_API_TOKEN=' \/srv\/mopclothing\/\.env \| cut -d= -f2-/);
  assert.match(cmd, /curl -sS --max-time 30 -H @- https:\/\/api\.printful\.com\/store\/products\/480715448$/);
  assert.match(cmd, /X-PF-Store-Id: 18891329/);
  assert.ok(!/source |\. \/srv/.test(cmd), "never sources the .env");
  assert.throws(() => websiteProductCommand("1; rm -rf /"), /not a number/);
});

test("printFiles: 'default' becomes 'front' when there is more than one placement", () => {
  const files = [
    { type: "default", id: 11, filename: "front.png" },
    { type: "back", id: 12, filename: "back.png" },
    { type: "preview", id: 13, filename: "mock.png" },
  ];
  assert.deepEqual(printFiles(files).map((f) => f.type), ["front", "back"]);
  assert.deepEqual(printFiles([{ type: "default", id: 11 }, { type: "preview", id: 13 }]).map((f) => f.type), ["default"]);
});
