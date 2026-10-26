// scripts/etsy: the listing-file parser and the Etsy payload builders (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ONE_SIZE,
  expandSizeRange,
  parseListingMd,
  parsePriceBySize,
  parseVariations,
} from "../scripts/etsy/lib/listing-md.mjs";
import {
  PROP_COLOR,
  PROP_SIZE,
  PROP_WOMENS_SIZE,
  READY_LISTINGS,
  TAXONOMY_CROP_TOPS,
  TAXONOMY_DRESSES,
  TAXONOMY_HATS,
  TAXONOMY_POLOS,
  TAXONOMY_TSHIRTS,
  WOMENS_SIZE_VALUES,
  buildDraftListing,
  categoryFor,
  buildInventory,
  chooseColors,
  formEncode,
  formFields,
  planImages,
  skippedImages,
  validateListing,
} from "../scripts/etsy/lib/payload.mjs";

const FIXTURE = `# 03 · Pelican Tee · Classic (Big print)

**Status:** Ready: product exists in Printful; copy it to the Etsy store.

**Shop section:** Character tees

## Title

\`\`\`
Pelican T-Shirt, Original Art Pelican Tee on Comfort Colors Heavyweight Cotton, Coastal Bird Shirt, Beach Gift for Men and Women
\`\`\`
128/140 characters

## Tags (13)

\`\`\`
pelican shirt, pelican t shirt, bird shirt, coastal tee, beach shirt, comfort colors tee, seabird shirt, ocean lover gift, nautical shirt, pelican gift, bird lover gift, california shirt, beach bird tee
\`\`\`
Lengths: pelican shirt (13), …

## Materials

Cotton

## Price (by size)

S–XL $38.27 · 2XL $40.27 · 3XL $42.27 · 4XL $44.27

## Variations

Primary colour: Lagoon Blue, Ivory, Butter, Washed Denim, Black, Pepper, True Navy · Size: S–4XL (price varies by size)

## Description

\`\`\`
The MOP pelican, printed big.

THE SHIRT
- Comfort Colors 1717
\`\`\`

## Photos (upload in this order)

Folder: \`/tmp/photos/03-pelican-tee-classic\`

- \`01-large-classic-lagoon-blue-model.jpg\`: Lagoon Blue, on model (1600×1600)
- \`02-large-classic-lagoon-blue-flat.jpg\`: Lagoon Blue, flat (1600×1600)
- \`03-large-classic-ivory-flat.jpg\`: Ivory, flat (1600×1600)
- \`04-large-classic-black-flat.jpg\`: Black, flat (1600×1600)
- \`05-large-classic-true-navy-flat.jpg\`: True Navy, flat (1600×1600)

## Money per sale (Etsy vs the site)

| Sizes | Etsy price |
|---|---|
| S–XL | $38.27 |
`;

const SKY = FIXTURE.replace("# 03 · Pelican Tee · Classic (Big print)", "# 01 · Sky Tee · Cosmic Cliffs")
  .replace("**Shop section:** Character tees", "**Shop section:** Sky & all-over")
  .replace("S–XL $38.27 · 2XL $40.27 · 3XL $42.27 · 4XL $44.27", "XS–XL $48.67 · 2XL $48.67")
  .replace(/Primary colour: .*\n/, "Size: XS, S, M, L, XL, 2XL (one price)\n")
  .replace(/- `0[1-5].*\n/g, "")
  .replace("## Money", "- `01-cosmic-cliffs-model-left-front.jpg`: on model, front (1600×1600)\n- `02-cosmic-cliffs-flat.jpg`: flat, front (1600×1600)\n\n## Money");

const SHOP = {
  shopId: 111,
  shippingProfileId: 222,
  readinessStateId: 333,
  productionPartnerId: 444,
  returnPolicyId: 555,
  sections: { "Character tees": 666, "Sky & all-over": 777 },
};

test("prices by size: ranges expand, cents are exact (S–XL $38.27 · 2XL $40.27 · …)", () => {
  assert.deepEqual(parsePriceBySize("S–XL $38.27 · 2XL $40.27 · 3XL $42.27 · 4XL $44.27"), {
    S: 3827, M: 3827, L: 3827, XL: 3827, "2XL": 4027, "3XL": 4227, "4XL": 4427,
  });
  assert.deepEqual(parsePriceBySize("XS–XL $48.67 · 2XL $48.67"), {
    XS: 4867, S: 4867, M: 4867, L: 4867, XL: 4867, "2XL": 4867,
  });
  assert.deepEqual(parsePriceBySize("S-M $33.46"), { S: 3346, M: 3346 }, "a plain hyphen works too");
});

test("prices: a round price, a missing cent, a double-priced size or a backwards range is refused", () => {
  assert.throws(() => parsePriceBySize("S–XL $38.20"), /ends in 0/);
  assert.throws(() => parsePriceBySize("S–XL $38"), /not like \$38\.27/);
  assert.throws(() => parsePriceBySize("S–XL $38.27 · XL $40.27"), /priced twice/);
  assert.throws(() => expandSizeRange("XL–S"), /backwards/);
  assert.throws(() => parsePriceBySize("S–XXXL $38.27"), /unknown size/);
});

test("variations: colour × size range, or a size list with no colour", () => {
  assert.deepEqual(parseVariations("Primary colour: White, Black, Red · Size: S–4XL (price varies by size)"), {
    colors: ["White", "Black", "Red"],
    sizes: ["S", "M", "L", "XL", "2XL", "3XL", "4XL"],
  });
  assert.deepEqual(parseVariations("Size: XS, S, M, L, XL, 2XL (one price)"), {
    colors: [],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
  });
});

test("the .md parser reads every field, untouched", () => {
  const l = parseListingMd(FIXTURE);
  assert.equal(l.number, 3);
  assert.equal(l.name, "Pelican Tee · Classic (Big print)");
  assert.equal(l.section, "Character tees");
  assert.match(l.title, /^Pelican T-Shirt, Original Art/);
  assert.equal(l.title.length, 128);
  assert.equal(l.tags.length, 13);
  assert.equal(l.tags[12], "beach bird tee");
  assert.deepEqual(l.materials, ["Cotton"]);
  assert.equal(l.description, "The MOP pelican, printed big.\n\nTHE SHIRT\n- Comfort Colors 1717");
  assert.equal(l.colors.length, 7);
  assert.equal(l.photoFolder, "/tmp/photos/03-pelican-tee-classic");
  assert.deepEqual(l.photos.map((p) => p.color), ["Lagoon Blue", "Lagoon Blue", "Ivory", "Black", "True Navy"]);
  assert.equal(l.photos[0].desc, "Lagoon Blue, on model");
  validateListing(l);
});

test("createDraftListing: a made-to-order Printful T-shirt draft, never a state, min price, comma-joined arrays", () => {
  const l = parseListingMd(FIXTURE);
  const f = formFields(buildDraftListing(l, SHOP));
  assert.equal(f.who_made, "someone_else");
  assert.equal(f.when_made, "made_to_order");
  assert.equal(f.is_supply, "false");
  assert.equal(f.type, "physical");
  assert.equal(f.taxonomy_id, String(TAXONOMY_TSHIRTS));
  assert.equal(f.price, "38.27");
  assert.equal(f.shipping_profile_id, "222");
  assert.equal(f.readiness_state_id, "333");
  assert.equal(f.return_policy_id, "555");
  assert.equal(f.production_partner_ids, "444");
  assert.equal(f.shop_section_id, "666");
  assert.equal(f.should_auto_renew, "true");
  assert.equal(f.tags.split(",").length, 13);
  assert.equal(f.materials, "Cotton");
  assert.ok(!("state" in f));
  for (const k of ["quantity", "title", "description", "price", "who_made", "when_made", "taxonomy_id"]) assert.ok(k in f, k);
  const body = new URLSearchParams(formEncode(buildDraftListing(l, SHOP)));
  assert.equal(body.get("title"), l.title);
  assert.equal(body.get("description"), l.description);
  assert.throws(() => formFields({ ...buildDraftListing(l, SHOP), state: "active" }), /drafts only/);
  assert.throws(() => buildDraftListing(l, { ...SHOP, sections: {} }), /no section "Character tees"/);
});

test("inventory: 7 colours × 7 sizes, each size's own price, Etsy's size values, custom colours", () => {
  const l = parseListingMd(FIXTURE);
  const inv = buildInventory(l, l.colors, 333);
  assert.equal(inv.products.length, 49);
  assert.deepEqual(inv.price_on_property, [PROP_SIZE.id]);
  assert.deepEqual(inv.quantity_on_property, []);
  assert.deepEqual(inv.sku_on_property, []);
  const find = (color: string, size: string) =>
    inv.products.find((p: any) => p.property_values[0].values[0] === color && p.property_values[1].values[0] === size);
  assert.equal(find("Lagoon Blue", "S").offerings[0].price, 38.27);
  assert.equal(find("True Navy", "2X").offerings[0].price, 40.27);
  assert.equal(find("Ivory", "4X").offerings[0].price, 44.27);
  const p = find("Black", "3X");
  assert.deepEqual(p.property_values[0], { property_id: PROP_COLOR.id, property_name: "Primary color", scale_id: null, value_ids: [1], values: ["Black"] });
  assert.deepEqual(p.property_values[1], { property_id: PROP_SIZE.id, property_name: "Unisex shirt size", scale_id: 51, value_ids: [2149], values: ["3X"] });
  assert.deepEqual(find("Lagoon Blue", "M").property_values[0].value_ids, [], "a non-Etsy colour name goes in as a custom value");
  for (const prod of inv.products) {
    assert.deepEqual(Object.keys(prod.offerings[0]).sort(), ["is_enabled", "price", "quantity", "readiness_state_id"]);
    assert.equal(prod.offerings[0].readiness_state_id, 333);
    assert.ok(Math.round(prod.offerings[0].price * 100) % 10 !== 0);
  }
});

test("inventory: a one-price, size-only listing has one property and no price_on_property", () => {
  const l = parseListingMd(SKY);
  const inv = buildInventory(l, [], 333);
  assert.equal(inv.products.length, 6);
  assert.deepEqual(inv.price_on_property, []);
  for (const prod of inv.products) {
    assert.equal(prod.property_values.length, 1);
    assert.equal(prod.offerings[0].price, 48.67);
  }
  assert.deepEqual(inv.products.map((p: any) => p.property_values[0].values[0]), ["XS", "S", "M", "L", "XL", "2X"]);
  assert.equal(formFields(buildDraftListing(l, SHOP)).shop_section_id, "777");
});

test("photos: light-only drops the dark colours and their photos; ranks stay 1, 2, 3 …; colourless photos always go", () => {
  const l = parseListingMd(FIXTURE);
  const light = chooseColors(l, { lightOnly: true });
  assert.deepEqual(light, ["Lagoon Blue", "Ivory", "Butter", "Washed Denim"]);
  const imgs = planImages(l, light);
  assert.deepEqual(imgs.map((i) => [i.rank, i.file]), [
    [1, "01-large-classic-lagoon-blue-model.jpg"],
    [2, "02-large-classic-lagoon-blue-flat.jpg"],
    [3, "03-large-classic-ivory-flat.jpg"],
  ]);
  assert.equal(imgs[0].path, "/tmp/photos/03-pelican-tee-classic/01-large-classic-lagoon-blue-model.jpg");
  assert.equal(imgs[0].alt_text, "Pelican Tee · Classic (Big print): Lagoon Blue, on model");
  assert.deepEqual(skippedImages(l, light).map((p) => p.file), ["04-large-classic-black-flat.jpg", "05-large-classic-true-navy-flat.jpg"]);
  assert.equal(planImages(l, l.colors).length, 5);
  assert.deepEqual(chooseColors(l, { colors: ["ivory", "Black"] }), ["Ivory", "Black"]);
  assert.throws(() => chooseColors(l, { colors: ["Mauve"] }), /no colour Mauve/);
  const sky = parseListingMd(SKY);
  assert.equal(planImages(sky, []).length, 2);
});

test("Etsy's field rules: long titles, repeated ':' and bad tags are caught before sending", () => {
  const l = parseListingMd(FIXTURE);
  assert.throws(() => validateListing({ ...l, title: "x".repeat(141) }), /max 140/);
  assert.throws(() => validateListing({ ...l, title: "A: b: c" }), /":" more than once/);
  assert.throws(() => validateListing({ ...l, tags: [...l.tags.slice(0, 12), "a tag that is way too long"] }), /max 20/);
  assert.throws(() => validateListing({ ...l, tags: [...l.tags.slice(0, 12), "50% off"] }), /character Etsy rejects/);
});

test("cleared to build: 01–03, 05–08, the Sky Tees 13–17, batch 2 (20–34) and the logo tee 99; 04 is hand-built, the city shirts 09–12 wait", () => {
  assert.deepEqual(READY_LISTINGS, [1, 2, 3, 5, 6, 7, 8, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 99]);
  for (const n of [4, 9, 10, 11, 12, 18, 19, 35]) assert.ok(!READY_LISTINGS.includes(n), String(n));
});

// ---- categories, size scales and the one-size snapback (batch 2, 10/25)

const withCategory = (md: string, category: string) =>
  md.replace("## Description", `## About this listing (Etsy)\n\n- Who made it? **Another company or person**\n- Category: ${category}\n- Renewal: automatic\n\n## Description`);

const CROP = withCategory(
  FIXTURE.replace("S–XL $38.27 · 2XL $40.27 · 3XL $42.27 · 4XL $44.27", "XS–XL $36.83")
    .replace(/Primary colour: .*\n/, "Primary colour: White, Bone · Size: XS–XL (one price)\n"),
  "Clothing › Women's Clothing › Tops & Tees › Crop & Tube Tops › Crop Tops",
);
const DRESS = withCategory(SKY.replace("XS–XL $48.67 · 2XL $48.67", "XS–3XL $58.73").replace("Size: XS, S, M, L, XL, 2XL (one price)", "Size: XS, S, M, L, XL, 2XL, 3XL (one price)"),
  "Clothing › Women's Clothing › Dresses");
const POLO = withCategory(
  FIXTURE.replace("S–XL $38.27 · 2XL $40.27 · 3XL $42.27 · 4XL $44.27", "S–4XL $45.56")
    .replace(/Primary colour: .*\n/, "Primary colour: White, Navy · Size: S–4XL (one price; 5XL left off: Etsy's size scale stops at 4X)\n"),
  "Clothing › Gender-Neutral Adult Clothing › Tops & Tees › Polos",
);
const SNAPBACK = withCategory(
  FIXTURE.replace("**Shop section:** Character tees\n", "")
    .replace("S–XL $38.27 · 2XL $40.27 · 3XL $42.27 · 4XL $44.27", "One size $36.62")
    .replace(/Primary colour: .*\n/, "Primary colour: Navy, Natural/Black (one size, one price)\n")
    .replace(/- `0[1-5].*\n/g, "")
    .replace("## Money", "- `01-navy-model.jpg`: Navy, on model (1600×1600)\n- `02-natural-black-flat.jpg`: Natural/Black, flat (1600×1600)\n\n## Money"),
  "Accessories › Hats & Head Coverings › Hats & Caps",
);

test("one size: 'One size $36.62' prices the single size; a colour-only Variations line means one size", () => {
  assert.deepEqual(expandSizeRange("One size"), [ONE_SIZE]);
  assert.deepEqual(parsePriceBySize("One size $36.62"), { [ONE_SIZE]: 3662 });
  assert.deepEqual(parseVariations("Primary colour: Navy, Natural/Black (one size, one price)"), { colors: ["Navy", "Natural/Black"], sizes: [ONE_SIZE] });
  assert.deepEqual(parseVariations("Primary colour: Navy · Size: One size"), { colors: ["Navy"], sizes: [ONE_SIZE] });
  assert.throws(() => parseVariations("Primary colour: Navy · Size: One size, S"), /can't be mixed/);
  assert.throws(() => parseVariations("Materials: cotton"), /unsupported variation/);
  // a tee file that lost its "Size:" part still fails: its prices name real sizes
  assert.throws(() => parseListingMd(FIXTURE.replace(" · Size: S–4XL (price varies by size)", "")), /size One size has no price/);
});

test("category line → Etsy taxonomy: T-shirts (default), Polos 480, Crop Tops 1839, Dresses 505, Hats & Caps 25; unknown refused", () => {
  assert.equal(parseListingMd(FIXTURE).category, null);
  assert.equal(categoryFor(parseListingMd(FIXTURE)).taxonomyId, TAXONOMY_TSHIRTS);
  const cases: [string, number][] = [[POLO, TAXONOMY_POLOS], [CROP, TAXONOMY_CROP_TOPS], [DRESS, TAXONOMY_DRESSES], [SNAPBACK, TAXONOMY_HATS]];
  for (const [md, id] of cases) {
    const l = parseListingMd(md);
    validateListing(l);
    assert.equal(formFields(buildDraftListing(l, SHOP)).taxonomy_id, String(id), l.category);
  }
  assert.deepEqual([TAXONOMY_POLOS, TAXONOMY_CROP_TOPS, TAXONOMY_DRESSES, TAXONOMY_HATS], [480, 1839, 505, 25]);
  assert.equal(parseListingMd(CROP).category, "Clothing › Women's Clothing › Tops & Tees › Crop & Tube Tops › Crop Tops");
  assert.equal(categoryFor({ number: 1, category: "clothing > women’s clothing > dresses" }).taxonomyId, 505, "arrow style, case and curly apostrophe don't matter");
  const odd = parseListingMd(withCategory(FIXTURE, "Clothing › Men's Clothing › Socks"));
  assert.throws(() => validateListing(odd), /no Etsy taxonomy mapped for category "Clothing › Men's Clothing › Socks"/);
  assert.throws(() => buildDraftListing(odd, SHOP), /no Etsy taxonomy mapped/);
});

test("crop tops and the dress use Etsy's women's size (US letter); polos keep the unisex scale, which has no 5X", () => {
  const crop = parseListingMd(CROP);
  const inv = buildInventory(crop, crop.colors, 333);
  assert.equal(inv.products.length, 10);
  assert.deepEqual(inv.price_on_property, []);
  const bone = inv.products.find((p: any) => p.property_values[0].values[0] === "Bone" && p.property_values[1].values[0] === "XS");
  assert.deepEqual(bone.property_values[1], { property_id: PROP_WOMENS_SIZE.id, property_name: "Women's clothing size", scale_id: 25, value_ids: [1678], values: ["XS"] });
  assert.equal(bone.offerings[0].price, 36.83);
  assert.deepEqual(inv.products.filter((p: any) => p.property_values[0].values[0] === "White").map((p: any) => p.property_values[1].value_ids[0]), [1678, 1694, 1709, 1724, 1733]);

  const dress = parseListingMd(DRESS);
  const dinv = buildInventory(dress, [], 333);
  assert.deepEqual(dinv.products.map((p: any) => p.property_values[0].values[0]), ["XS", "S", "M", "L", "XL", "2X", "3X"]);
  assert.deepEqual(dinv.products.slice(-2).map((p: any) => p.property_values[0].value_ids[0]), [WOMENS_SIZE_VALUES["2XL"].id, WOMENS_SIZE_VALUES["3XL"].id]);
  assert.ok(dinv.products.every((p: any) => p.property_values[0].property_id === 52047899294));

  const polo = parseListingMd(POLO);
  assert.deepEqual(polo.sizes, ["S", "M", "L", "XL", "2XL", "3XL", "4XL"], "the note in brackets doesn't leak into the sizes");
  const pinv = buildInventory(polo, polo.colors, 333);
  assert.equal(pinv.products.length, 14);
  assert.ok(pinv.products.every((p: any) => p.property_values[1].property_id === PROP_SIZE.id && p.property_values[1].scale_id === 51));
  const fivex = { ...polo, sizes: [...polo.sizes, "5XL"], pricesBySize: { ...polo.pricesBySize, "5XL": 4556 } };
  assert.throws(() => validateListing(fivex), /size 5XL has no Etsy value on "Unisex shirt size"/);
});

test("the snapback: one product per colour, no size property, one price, no section; its photos follow their colour", () => {
  const l = parseListingMd(SNAPBACK);
  validateListing(l);
  assert.equal(l.section, null);
  assert.deepEqual(l.sizes, [ONE_SIZE]);
  assert.deepEqual(l.pricesBySize, { [ONE_SIZE]: 3662 });
  const f = formFields(buildDraftListing(l, SHOP));
  assert.equal(f.price, "36.62");
  assert.ok(!("shop_section_id" in f));
  const inv = buildInventory(l, l.colors, 333);
  assert.deepEqual(inv.products.map((p: any) => p.property_values), [
    [{ property_id: PROP_COLOR.id, property_name: "Primary color", scale_id: null, value_ids: [], values: ["Navy"] }],
    [{ property_id: PROP_COLOR.id, property_name: "Primary color", scale_id: null, value_ids: [], values: ["Natural/Black"] }],
  ]);
  assert.deepEqual(inv.price_on_property, []);
  assert.ok(inv.products.every((p: any) => p.offerings[0].price === 36.62));
  assert.deepEqual(l.photos.map((p) => p.color), ["Navy", "Natural/Black"]);
  assert.deepEqual(planImages(l, ["Navy"]).map((i) => i.file), ["01-navy-model.jpg"]);
  // a hat can't take real sizes: Hats & Caps has no size property
  const sized = { ...l, sizes: ["S", "M"], pricesBySize: { S: 3662, M: 3662 } };
  assert.throws(() => validateListing(sized), /has no size property; list it as one size/);
  assert.throws(() => buildInventory(sized, l.colors, 333), /has no size property/);
});

// The real handoff files, when this machine has them (John's Mac).
const HANDOFF = path.join(os.homedir(), "code", "_handoff", "2026-10-25-mop-marketplaces", "etsy", "listings");
test("every real listing file parses and passes Etsy's checks", { skip: !existsSync(HANDOFF) && "no handoff folder here" }, () => {
  const files = readdirSync(HANDOFF).filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 12);
  for (const f of files) {
    const l = parseListingMd(readFileSync(path.join(HANDOFF, f), "utf8"));
    validateListing(l);
    assert.equal(l.tags.length, 13, f);
    assert.ok(l.photos.length > 0, f);
    // model shots come first (Nolli 22 has none: the site's only one is a smaller-print "-womens-2")
    const hasModel = l.photos.some((p) => p.desc.toLowerCase().includes("model"));
    // (99, the logo tee, leads with its flat front: the wordmark is the product)
    if (READY_LISTINGS.includes(l.number) && l.number !== 99 && hasModel) assert.ok(l.photos[0].desc.toLowerCase().includes("model"), `${f}: photo 01 is the model shot`);
    assert.ok(l.photos.length <= 20, `${f}: Etsy takes 20 photos at most`);
    if (l.number >= 20) {
      // batch 2 rules: no smaller-print "-womens-2" shots; with colours, every photo names its colour
      for (const p of l.photos) assert.ok(!p.file.includes("-womens-2"), `${f}: ${p.file} is a smaller-print -womens-2 shot`);
      if (l.colors.length) for (const p of l.photos) assert.ok(p.color, `${f}: ${p.file} names no colour, so it can't follow its colour`);
      assert.ok(l.printfulSourceId, `${f}: names its website sync product`);
    }
    const inv = buildInventory(l, l.colors, 1);
    assert.equal(inv.products.length, Math.max(1, l.colors.length) * l.sizes.length, f);
  }
});
