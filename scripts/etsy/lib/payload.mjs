// Builds the exact Etsy Open API v3 request bodies for one parsed listing file.
// No network, no ids baked in: shop-specific ids (shipping profile, processing
// profile, return policy, production partner, section) come from `shop`, which
// etsy.mjs resolves live by name.
//
// Etsy's public taxonomy ids below were read from getSellerTaxonomyNodes /
// getPropertiesByTaxonomyId (10/25/2026); they're Etsy's catalogue, not ours.

export const TAXONOMY_TSHIRTS = 482; // Clothing › Gender-Neutral Adult Clothing › Tops & Tees › T-shirts
export const PROP_COLOR = { id: 200, name: "Primary color" };
export const PROP_SIZE = { id: 62809790533, name: "Unisex shirt size", scaleId: 51 }; // scale "Unisex letter size"

// Etsy's own values for that size scale. Etsy writes 2X/3X/4X (buyers see that label).
export const SIZE_VALUES = {
  XXS: { id: 2133, label: "XXS" },
  XS: { id: 2135, label: "XS" },
  S: { id: 2137, label: "S" },
  M: { id: 2139, label: "M" },
  L: { id: 2141, label: "L" },
  XL: { id: 2144, label: "XL" },
  "2XL": { id: 2147, label: "2X" },
  "3XL": { id: 2149, label: "3X" },
  "4XL": { id: 2151, label: "4X" },
};

// Etsy's predefined Primary color values. A colour named exactly like one of these
// uses its id (buyers can filter on it); any other name (Lagoon Blue, Butter, …) is
// sent as a custom value with value_ids [] (Etsy's third-variation tutorial).
export const COLOR_VALUE_IDS = {
  Beige: 1213, Black: 1, Blue: 2, Bronze: 1216, Brown: 3, Clear: 1219, Copper: 1218,
  Gold: 1214, Gray: 5, Green: 4, Orange: 6, Pink: 7, Purple: 8, Rainbow: 1220, Red: 9,
  "Rose gold": 1217, Silver: 1215, White: 10, Yellow: 11,
};

// Colours that take the "-dark" print file on the website's Printful products.
export const DARK_COLORS = ["Black", "Pepper", "True Navy"];

// Listings cleared for building (10/25): 04 was built by hand, 07/08 lack current
// print files, 09–12 (city shirts) wait for John's OK.
export const READY_LISTINGS = [1, 2, 3, 5, 6];

export const OFFERING_QUANTITY = 999; // made to order; Etsy's per-offering maximum

const TITLE_CHARS = /[^\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]/u;
const TAG_CHARS = /[^\p{L}\p{Nd}\p{Zs}\-'™©®]/u;
const MATERIAL_CHARS = /[^\p{L}\p{Nd}\p{Zs}]/u;

/** Etsy's documented field rules, checked before anything is sent. */
export function validateListing(l) {
  const errs = [];
  if (l.title.length > 140) errs.push(`title is ${l.title.length} chars (max 140)`);
  if (TITLE_CHARS.test(l.title)) errs.push("title has a character Etsy rejects");
  for (const ch of ["%", ":", "&", "+"]) {
    if (l.title.split(ch).length - 1 > 1) errs.push(`title uses "${ch}" more than once`);
  }
  if (l.tags.length > 13) errs.push(`${l.tags.length} tags (max 13)`);
  for (const t of l.tags) {
    if (t.length > 20) errs.push(`tag "${t}" is ${t.length} chars (max 20)`);
    if (TAG_CHARS.test(t)) errs.push(`tag "${t}" has a character Etsy rejects`);
  }
  for (const m of l.materials) if (MATERIAL_CHARS.test(m)) errs.push(`material "${m}" has a character Etsy rejects`);
  for (const s of l.sizes) if (!SIZE_VALUES[s]) errs.push(`size ${s} has no Etsy unisex size value`);
  for (const [s, c] of Object.entries(l.pricesBySize)) if (c % 10 === 0) errs.push(`price for ${s} ends in 0`);
  if (errs.length) throw new Error(`listing ${l.number} fails Etsy checks:\n  - ${errs.join("\n  - ")}`);
}

/** The colour set to list: all of the file's colours, or a chosen subset. */
export function chooseColors(l, { colors, lightOnly } = {}) {
  let out = l.colors.slice();
  if (colors?.length) {
    const unknown = colors.filter((c) => !l.colors.some((x) => x.toLowerCase() === c.toLowerCase()));
    if (unknown.length) throw new Error(`listing ${l.number} has no colour ${unknown.join(", ")} (it has ${l.colors.join(", ")})`);
    out = l.colors.filter((x) => colors.some((c) => c.toLowerCase() === x.toLowerCase()));
  }
  if (lightOnly) out = out.filter((c) => !DARK_COLORS.includes(c));
  if (l.colors.length && !out.length) throw new Error(`listing ${l.number}: no colours left to list`);
  return out;
}

const dollars = (cents) => Number((cents / 100).toFixed(2));

/**
 * createDraftListing fields, as Etsy receives them (application/x-www-form-urlencoded;
 * array fields comma-joined, as in Etsy's tutorial). Never carries `state`: the
 * endpoint only makes drafts, and publishing stays John's click.
 */
export function buildDraftListing(l, shop) {
  const section = shop.sections?.[l.section];
  if (l.section && section == null) throw new Error(`shop has no section "${l.section}"`);
  const minCents = Math.min(...l.sizes.map((s) => l.pricesBySize[s]));
  const fields = {
    quantity: OFFERING_QUANTITY,
    title: l.title,
    description: l.description,
    price: dollars(minCents),
    who_made: "someone_else",
    when_made: "made_to_order",
    is_supply: false,
    taxonomy_id: TAXONOMY_TSHIRTS,
    type: "physical",
    shipping_profile_id: shop.shippingProfileId,
    readiness_state_id: shop.readinessStateId,
    return_policy_id: shop.returnPolicyId,
    production_partner_ids: [shop.productionPartnerId],
    shop_section_id: section,
    tags: l.tags,
    materials: l.materials,
    should_auto_renew: true,
  };
  for (const [k, v] of Object.entries(fields)) if (v == null) delete fields[k];
  return fields;
}

/** The fields exactly as they go on the wire: strings, arrays comma-joined. */
export function formFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = Array.isArray(v) ? v.join(",") : String(v);
  if ("state" in out) throw new Error("refusing to send a listing state: drafts only");
  return out;
}

export function formEncode(fields) {
  return new URLSearchParams(formFields(fields)).toString();
}

function colorValue(name) {
  const id = COLOR_VALUE_IDS[name];
  return {
    property_id: PROP_COLOR.id,
    property_name: PROP_COLOR.name,
    scale_id: null,
    value_ids: id ? [id] : [],
    values: [name],
  };
}

function sizeValue(size) {
  const v = SIZE_VALUES[size];
  if (!v) throw new Error(`no Etsy size value for ${size}`);
  return {
    property_id: PROP_SIZE.id,
    property_name: PROP_SIZE.name,
    scale_id: PROP_SIZE.scaleId,
    value_ids: [v.id],
    values: [v.label],
  };
}

/**
 * updateListingInventory body: one product per colour × size (or per size when
 * the listing has no colour), each with its size's price. Price varies on size
 * only when the sizes differ in price.
 */
export function buildInventory(l, colors, readinessStateId) {
  const offering = (size) => ({
    price: dollars(l.pricesBySize[size]),
    quantity: OFFERING_QUANTITY,
    is_enabled: true,
    readiness_state_id: readinessStateId,
  });
  const products = [];
  if (colors.length) {
    for (const c of colors) {
      for (const s of l.sizes) {
        products.push({ sku: "", property_values: [colorValue(c), sizeValue(s)], offerings: [offering(s)] });
      }
    }
  } else {
    for (const s of l.sizes) products.push({ sku: "", property_values: [sizeValue(s)], offerings: [offering(s)] });
  }
  const priceVaries = new Set(l.sizes.map((s) => l.pricesBySize[s])).size > 1;
  return {
    products,
    price_on_property: priceVaries ? [PROP_SIZE.id] : [],
    quantity_on_property: [],
    sku_on_property: [],
    readiness_state_on_property: [],
  };
}

/**
 * Photos in the file's order, minus photos of colours not being listed. Photos
 * that name no colour (the all-over tees) always go. Ranks run 1, 2, 3, …
 */
export function planImages(l, colors, folder = l.photoFolder) {
  const keep = l.photos.filter((p) => p.color == null || colors.includes(p.color));
  if (keep.length > 20) throw new Error(`${keep.length} photos (Etsy max 20)`);
  if (!keep.length) throw new Error(`listing ${l.number}: no photos to upload`);
  return keep.map((p, i) => ({
    rank: i + 1,
    path: folder ? `${folder.replace(/\/$/, "")}/${p.file}` : p.file,
    file: p.file,
    alt_text: `${l.name}: ${p.desc}`.slice(0, 500),
  }));
}

export function skippedImages(l, colors) {
  return l.photos.filter((p) => p.color != null && !colors.includes(p.color));
}
