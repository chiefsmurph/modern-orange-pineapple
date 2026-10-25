// scripts/etsy: the listing-file parser and the Etsy payload builders (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  expandSizeRange,
  parseListingMd,
  parsePriceBySize,
  parseVariations,
} from "../scripts/etsy/lib/listing-md.mjs";
import {
  PROP_COLOR,
  PROP_SIZE,
  READY_LISTINGS,
  TAXONOMY_TSHIRTS,
  buildDraftListing,
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

test("only 01, 02, 03, 05, 06 and the Sky Tees 13–17 are cleared to build (04 is hand-built; 07–12 wait)", () => {
  assert.deepEqual(READY_LISTINGS, [1, 2, 3, 5, 6, 13, 14, 15, 16, 17]);
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
    if (READY_LISTINGS.includes(l.number)) assert.ok(l.photos[0].desc.toLowerCase().includes("model"), `${f}: photo 01 is the model shot`);
    const inv = buildInventory(l, l.colors, 1);
    assert.equal(inv.products.length, Math.max(1, l.colors.length) * l.sizes.length, f);
  }
});
