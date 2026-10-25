// Changing a LIVE listing without disturbing what's there: adding colours to its
// inventory, and planning its photos. No network here.
//
// updateListingInventory replaces the listing's whole product set, and its body has no
// product_id or offering_id field (Etsy's listings tutorial: send the getListingInventory
// answer back minus product_id, offering_id, scale_name and is_deleted, with each price
// as a decimal). So every existing product goes back exactly as Etsy returned it (sku,
// property values, price, quantity, enabled, processing profile) and new ones are
// appended. Printful keys each Etsy-store sync variant on the Etsy product_id (its
// external_id). Etsy kept every existing product_id when colours were appended this
// way (listings 03, 04, 05 on 10/25), but the docs don't promise it, so `add-colors`
// compares the ids before and after and says when variants need linking again.
import { COLOR_VALUE_IDS, SIZE_VALUES } from "./payload.mjs";

export const PROP_COLOR_ID = 200;

/** Etsy Money { amount, divisor } → the decimal the PUT takes; throws unless it's exact to the cent. */
export function moneyToDecimal(m) {
  if (typeof m === "number") return m;
  if (!m || !Number.isInteger(m.amount) || !Number.isInteger(m.divisor) || m.divisor <= 0) throw new Error(`price ${JSON.stringify(m)} is not Etsy Money`);
  const d = Number((m.amount / m.divisor).toFixed(2));
  if (Math.round(d * m.divisor) !== m.amount) throw new Error(`price ${m.amount}/${m.divisor} isn't a whole number of cents`);
  return d;
}

const cents = (m) => Math.round(moneyToDecimal(m) * 100);

const pvToRequest = (pv) => ({
  property_id: pv.property_id,
  property_name: pv.property_name,
  scale_id: pv.scale_id ?? null,
  value_ids: [...(pv.value_ids ?? [])],
  values: [...(pv.values ?? [])],
});

/** One getListingInventory product as updateListingInventory takes it, unchanged. */
export function productToRequest(p) {
  if (p.is_deleted) throw new Error(`product ${p.product_id} is marked deleted; not sending it back`);
  const offerings = (p.offerings ?? []).filter((o) => !o.is_deleted);
  if (!offerings.length) throw new Error(`product ${p.product_id} has no offering`);
  return {
    sku: p.sku ?? "",
    property_values: (p.property_values ?? []).map(pvToRequest),
    offerings: offerings.map((o) => {
      if (o.readiness_state_id == null) throw new Error(`offering ${o.offering_id} has no processing profile (readiness_state_id)`);
      return { price: moneyToDecimal(o.price), quantity: o.quantity, is_enabled: o.is_enabled, readiness_state_id: o.readiness_state_id };
    }),
  };
}

/** The whole live inventory as a PUT body that changes nothing. */
export function liveToRequest(inv) {
  return {
    products: inv.products.map(productToRequest),
    price_on_property: [...(inv.price_on_property ?? [])],
    quantity_on_property: [...(inv.quantity_on_property ?? [])],
    sku_on_property: [...(inv.sku_on_property ?? [])],
    readiness_state_on_property: [...(inv.readiness_state_on_property ?? [])],
  };
}

/** A product's colour and size labels as Etsy shows them: { color: "Lagoon Blue" | null, size: "2X" | null }. */
export function productLabels(p) {
  const color = p.property_values.find((v) => v.property_id === PROP_COLOR_ID)?.values?.[0] ?? null;
  const size = p.property_values.find((v) => v.property_id !== PROP_COLOR_ID)?.values?.[0] ?? null;
  return { color, size };
}

export const productKey = (p) => {
  const { color, size } = productLabels(p);
  return color ? `${color} / ${size}` : String(size);
};

const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export function liveColors(inv) {
  const out = [];
  for (const p of inv.products) {
    const { color } = productLabels(p);
    if (color && !out.some((c) => sameText(c, color))) out.push(color);
  }
  return out;
}

/**
 * The PUT body that keeps every live product exactly and appends `colors` × the listing
 * file's sizes. Each new product copies the size value and the quantity / processing
 * profile of a live product of the same size, and takes the listing file's price for
 * that size, which must equal the live price of that size (otherwise it stops: the
 * file and the shop disagree, and nothing is guessed). Colours already live are skipped.
 * → { body, kept, added: [{ key, color, size, price }], alreadyLive: [colour] }
 */
export function appendColors(inv, listing, colors) {
  const body = liveToRequest(inv);
  const alreadyLive = colors.filter((c) => liveColors(inv).some((x) => sameText(x, c)));
  const toAdd = colors.filter((c) => !alreadyLive.includes(c));
  if (!toAdd.length) return { body, kept: body.products.length, added: [], alreadyLive };
  if (!body.products.every((p) => p.property_values.some((v) => v.property_id === PROP_COLOR_ID))) {
    throw new Error("the live listing has products without a colour; adding colours would change its variations");
  }
  const added = [];
  for (const color of toAdd) {
    for (const size of listing.sizes) {
      const label = SIZE_VALUES[size]?.label;
      if (!label) throw new Error(`no Etsy size value for ${size}`);
      const same = body.products.filter((p) => sameText(productLabels(p).size, label));
      if (!same.length) throw new Error(`the live listing has no ${label} product to copy the size from`);
      const tpl = same[0];
      const want = listing.pricesBySize[size];
      const livePrices = [...new Set(same.map((p) => Math.round(p.offerings[0].price * 100)))];
      if (livePrices.length !== 1 || livePrices[0] !== want) {
        throw new Error(`size ${label}: the listing file says $${(want / 100).toFixed(2)}, the live listing has ${livePrices.map((c) => `$${(c / 100).toFixed(2)}`).join(" / ")}; stopping`);
      }
      const colorPv = tpl.property_values.find((v) => v.property_id === PROP_COLOR_ID);
      const id = COLOR_VALUE_IDS[color];
      const product = {
        sku: "",
        property_values: tpl.property_values.map((v) =>
          v.property_id === PROP_COLOR_ID
            ? { property_id: PROP_COLOR_ID, property_name: colorPv.property_name, scale_id: null, value_ids: id ? [id] : [], values: [color] }
            : pvToRequest(v),
        ),
        offerings: [{ price: want / 100, quantity: tpl.offerings[0].quantity, is_enabled: true, readiness_state_id: tpl.offerings[0].readiness_state_id }],
      };
      body.products.push(product);
      added.push({ key: productKey(product), color, size: label, price: want });
    }
  }
  return { body, kept: inv.products.length, added, alreadyLive };
}

/** Throws unless `body` starts with every live product exactly as it is and keeps the *_on_property fields. */
export function assertKeepsLive(inv, body) {
  const live = liveToRequest(inv);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of ["price_on_property", "quantity_on_property", "sku_on_property", "readiness_state_on_property"]) {
    if (!same(live[k], body[k])) throw new Error(`${k} would change (${JSON.stringify(live[k])} → ${JSON.stringify(body[k])})`);
  }
  live.products.forEach((p, i) => {
    if (!same(p, body.products[i])) throw new Error(`live product ${productKey(p)} would change`);
  });
  const keys = body.products.map(productKey);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw new Error(`two products would be ${dup}`);
}

/**
 * Before vs after an inventory PUT, product by product (matched on colour + size).
 * → { missing: [key], changed: ["key: what"], unexpected: [key], idsKept: n, idsChanged: n }
 * `added` is appendColors' list ({ key, price } in cents): each must be there at its price.
 */
export function compareInventories(before, after, added = []) {
  const expectedNew = added.map((a) => a.key);
  const byKey = new Map(after.products.map((p) => [productKey(p), p]));
  const out = { missing: [], changed: [], unexpected: [], idsKept: 0, idsChanged: 0 };
  for (const b of before.products) {
    const k = productKey(b);
    const a = byKey.get(k);
    if (!a) { out.missing.push(k); continue; }
    const diffs = [];
    if ((a.sku ?? "") !== (b.sku ?? "")) diffs.push(`sku ${b.sku} → ${a.sku}`);
    const [ao, bo] = [a.offerings[0], b.offerings[0]];
    if (cents(ao.price) !== cents(bo.price)) diffs.push(`price ${cents(bo.price)} → ${cents(ao.price)} cents`);
    if (ao.quantity !== bo.quantity) diffs.push(`quantity ${bo.quantity} → ${ao.quantity}`);
    if (ao.is_enabled !== bo.is_enabled) diffs.push(`enabled ${bo.is_enabled} → ${ao.is_enabled}`);
    if (diffs.length) out.changed.push(`${k}: ${diffs.join(", ")}`);
    if (a.product_id === b.product_id) out.idsKept++;
    else out.idsChanged++;
  }
  const beforeKeys = new Set(before.products.map(productKey));
  for (const k of byKey.keys()) if (!beforeKeys.has(k) && !expectedNew.includes(k)) out.unexpected.push(k);
  for (const a of added) {
    const p = byKey.get(a.key);
    if (!p) out.missing.push(a.key);
    else if (cents(p.offerings[0].price) !== a.price) out.changed.push(`${a.key}: added at ${cents(p.offerings[0].price)} cents, not ${a.price}`);
  }
  return out;
}

/** Alt text the tool gives a listing photo (matches planImages). */
export const altText = (listing, photo) => `${listing.name}: ${photo.desc}`.slice(0, 500);

/**
 * Photos of `colors` from the listing file that the listing doesn't have yet (by alt
 * text), ranked after the photos already there. Etsy allows 20 per listing.
 */
export function planAddedImages(listing, colors, existingImages, folder = listing.photoFolder) {
  const have = new Set(existingImages.map((i) => i.alt_text ?? ""));
  const todo = listing.photos.filter((p) => p.color && colors.some((c) => sameText(c, p.color)) && !have.has(altText(listing, p)));
  const total = existingImages.length + todo.length;
  if (total > 20) throw new Error(`${existingImages.length} photos on the listing + ${todo.length} new = ${total} (Etsy max 20); replace-photos first`);
  return todo.map((p, i) => ({
    rank: existingImages.length + i + 1,
    path: `${String(folder).replace(/\/$/, "")}/${p.file}`,
    file: p.file,
    alt_text: altText(listing, p),
  }));
}

/**
 * Replacing a listing's photos with the planned set without ever leaving it short:
 * the new photo k goes in with overwrite at rank k (Etsy swaps out whatever is there,
 * so the count never passes 20), skipped when rank k already holds it (a re-run); after
 * all of them, every other image is deleted. Deleted Etsy images stay re-attachable by id.
 * → { uploads: [{ rank, overwrite, replaces, ...img }], skip: [img], deleteAfter: [image id] }
 */
export function planReplaceImages(planned, existingImages) {
  const byRank = new Map(existingImages.map((i) => [i.rank, i]));
  const uploads = [];
  const skip = [];
  for (const img of planned) {
    const there = byRank.get(img.rank);
    if (there && there.alt_text === img.alt_text) skip.push({ ...img, listing_image_id: there.listing_image_id });
    else uploads.push({ ...img, overwrite: Boolean(there), replaces: there?.listing_image_id ?? null });
  }
  const keepIds = new Set(skip.map((s) => s.listing_image_id));
  const replaced = new Set(uploads.map((u) => u.replaces).filter(Boolean));
  const deleteAfter = existingImages.map((i) => i.listing_image_id).filter((id) => !keepIds.has(id) && !replaced.has(id));
  return { uploads, skip, deleteAfter };
}
