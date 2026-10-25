#!/usr/bin/env node
// MOP Listing Tool: builds MOP Clothing's Etsy listings through Etsy's official
// Open API v3 (no website automation). It only ever makes DRAFTS; John reviews
// and publishes on Etsy.
//
//   node scripts/etsy/etsy.mjs auth                  connect the Etsy shop (OAuth, PKCE on localhost)
//   node scripts/etsy/etsy.mjs whoami                shop id, shipping/return/processing profiles, sections, partners
//   node scripts/etsy/etsy.mjs create 3 --dry-run    print every request it would send; no writes
//   node scripts/etsy/etsy.mjs create 3              make the draft: listing, colour × size prices, photos
//   node scripts/etsy/etsy.mjs link 3 --dry-run      the per-variant plan for connecting listing 03 to Printful; no writes
//   node scripts/etsy/etsy.mjs link 3                connect it: Etsy orders for its variants then fulfil on their own
//   node scripts/etsy/etsy.mjs orders-check          Etsy-store Printful orders that need a look (draft, failed, on hold, unsynced)
//
// create options:
//   --dry-run              print the payloads; no network writes (reads the shop if tokens exist)
//   --light-only           leave out the dark colours (Black, Pepper, True Navy) and their photos
//   --colors "A,B"         list only these colours (from the listing file's set) and their photos
//   --dir <path>           the handoff's etsy/ folder (default ~/code/_handoff/2026-10-25-mop-marketplaces/etsy,
//                          or $MOP_ETSY_LISTINGS_DIR)
//   --resume <listing_id>  finish a draft whose create stopped part-way (inventory, missing photos)
//
// link: Printful imports each Etsy listing into the Etsy store (active listings at once,
// drafts about daily). For every unsynced variant, link copies the website product's
// variant of the same colour + size (catalog variant, print files, options) from the
// website product the listing file names under "Printful source", and sets retail_price
// to the listing's price. Any variant without an exact match stops the whole listing.
// Variants already synced are left alone. Re-running is safe.
//   --dry-run              print the plan; nothing is written to Printful
//
// Credentials: ~/.config/mop-etsy/etsy.env, tokens.json and printful.env (see lib/config.mjs).
// Nothing here prints them. Shop ids are looked up by name at run time, never stored in the
// repo; listing ids go to ~/.config/mop-etsy/listings.json. The website store's Printful
// token never leaves the server (lib/printful-client.mjs reads its products over ssh).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { STATE_FILE, hasTokens, listingIdFor, recordListingId, redact } from "./lib/config.mjs";
import { createClient } from "./lib/etsy-client.mjs";
import { parseListingMd } from "./lib/listing-md.mjs";
import { runAuth } from "./lib/oauth.mjs";
import { PrintfulError, createPrintfulClient, fetchWebsiteProduct } from "./lib/printful-client.mjs";
import { orderAttention, planLink } from "./lib/printful-link.mjs";
import {
  READY_LISTINGS,
  buildDraftListing,
  buildInventory,
  chooseColors,
  formFields,
  planImages,
  skippedImages,
  validateListing,
} from "./lib/payload.mjs";

// The shop settings every MOP listing uses, matched by name.
const SHIPPING_PROFILE = "MOP free US shipping";
const PROCESSING = { readiness_state: "made_to_order", min: 2, max: 6 }; // "Made to order (2-6 days)"
const PRODUCTION_PARTNER = /printful/i;
const LISTING_STATES_CHECKED = ["draft", "active", "inactive", "expired"];

const DEFAULT_DIR = process.env.MOP_ETSY_LISTINGS_DIR || path.join(os.homedir(), "code", "_handoff", "2026-10-25-mop-marketplaces", "etsy");

const sameTitle = (a, b) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

function findListingFile(dir, n) {
  const listingsDir = path.join(dir, "listings");
  const prefix = `${String(n).padStart(2, "0")}-`;
  const hit = fs.existsSync(listingsDir) && fs.readdirSync(listingsDir).find((f) => f.startsWith(prefix) && f.endsWith(".md"));
  if (!hit) throw new Error(`no listings/${prefix}*.md in ${dir}`);
  return path.join(listingsDir, hit);
}

function loadListing(dir, n) {
  const file = findListingFile(dir, n);
  const listing = parseListingMd(fs.readFileSync(file, "utf8"));
  if (listing.number !== n) throw new Error(`${file} is headed #${listing.number}, not #${n}`);
  validateListing(listing);
  // The file names an absolute photo folder; fall back to photos/<same name> beside it.
  const fallback = path.join(dir, "photos", path.basename(file, ".md"));
  listing.photoFolder = listing.photoFolder && fs.existsSync(listing.photoFolder) ? listing.photoFolder : fallback;
  return { file, listing };
}

async function resolveShop(client) {
  const me = await client.request("GET", "/application/users/me");
  const shopId = me.shop_id;
  if (!shopId) throw new Error("this Etsy account has no shop");
  const shop = await client.request("GET", `/application/shops/${shopId}`);
  const shipping = (await client.request("GET", `/application/shops/${shopId}/shipping-profiles`)).results ?? [];
  const returns = (await client.request("GET", `/application/shops/${shopId}/policies/return`)).results ?? [];
  const readiness = await client.all(`/application/shops/${shopId}/readiness-state-definitions`);
  const sections = (await client.request("GET", `/application/shops/${shopId}/sections`)).results ?? [];
  const partners = (await client.request("GET", `/application/shops/${shopId}/production-partners`)).results ?? [];
  return { shopId, shopName: shop.shop_name, shipping, returns, readiness, sections, partners };
}

/** Picks the ids every MOP listing uses; throws naming whatever is missing. */
function pickShopSettings(raw) {
  const problems = [];
  const ship = raw.shipping.filter((p) => p.title?.trim() === SHIPPING_PROFILE);
  if (ship.length !== 1) problems.push(`${ship.length} shipping profiles titled "${SHIPPING_PROFILE}" (need exactly 1)`);
  const ready = raw.readiness.filter(
    (r) => r.readiness_state === PROCESSING.readiness_state && r.min_processing_days === PROCESSING.min && r.max_processing_days === PROCESSING.max,
  );
  if (!ready.length) problems.push(`no processing profile "made to order, ${PROCESSING.min}-${PROCESSING.max} days"`);
  const partner = raw.partners.filter((p) => PRODUCTION_PARTNER.test(p.partner_name ?? ""));
  if (partner.length !== 1) problems.push(`${partner.length} production partners named like Printful (need exactly 1)`);
  let ret = raw.returns.filter((r) => !r.accepts_returns && !r.accepts_exchanges);
  if (ret.length !== 1 && raw.returns.length === 1) ret = raw.returns;
  if (ret.length > 1) problems.push(`${ret.length} no-returns return policies; can't tell which to use`);
  if (problems.length) throw new Error(`shop settings not found:\n  - ${problems.join("\n  - ")}\n(run whoami to see what the shop has)`);
  return {
    shopId: raw.shopId,
    shopName: raw.shopName,
    shippingProfileId: ship[0].shipping_profile_id,
    readinessStateId: ready[0].readiness_state_id,
    productionPartnerId: partner[0].production_partner_id,
    returnPolicyId: ret[0]?.return_policy_id ?? null,
    sections: Object.fromEntries(raw.sections.map((s) => [s.title, s.shop_section_id])),
  };
}

/** Stand-ins for the dry run when no tokens exist yet. */
function placeholderShop(listing) {
  return {
    shopId: "<shop_id>",
    shopName: "<shop>",
    shippingProfileId: `<id of shipping profile "${SHIPPING_PROFILE}">`,
    readinessStateId: `<id of processing profile "made to order, ${PROCESSING.min}-${PROCESSING.max} days">`,
    productionPartnerId: "<id of production partner Printful>",
    returnPolicyId: "<id of the no-returns return policy>",
    sections: listing.section ? { [listing.section]: `<id of section "${listing.section}">` } : {},
  };
}

async function findSameTitle(client, shopId, title) {
  const hits = [];
  for (const state of LISTING_STATES_CHECKED) {
    for (const l of await client.all(`/application/shops/${shopId}/listings`, { state })) {
      if (sameTitle(l.title ?? "", title)) hits.push({ listing_id: l.listing_id, state: l.state ?? state });
    }
  }
  return hits;
}

/** JSON with one product per line, so a 49-variant inventory stays readable. */
function inventoryJson(inv) {
  const { products, ...rest } = inv;
  const lines = products.map((p) => "    " + JSON.stringify(p));
  const tail = Object.entries(rest).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n  "products": [\n${lines.join(",\n")}\n  ],\n${tail.join(",\n")}\n}`;
}

const money = (c) => `$${(c / 100).toFixed(2)}`;

function describe(listing, colors, images, skipped) {
  const bySize = listing.sizes.map((s) => `${s} ${money(listing.pricesBySize[s])}`).join(" · ");
  console.log(`#${listing.number} ${listing.name}`);
  console.log(`  title    ${listing.title}`);
  console.log(`  section  ${listing.section}`);
  console.log(`  colours  ${colors.length ? colors.join(", ") : "(none: size only)"}`);
  console.log(`  prices   ${bySize}`);
  console.log(`  photos   ${images.length} to upload${skipped.length ? `; skipping ${skipped.map((p) => p.file).join(", ")}` : ""}`);
}

async function uploadImages(client, shopId, listingId, images, alreadyThere = 0) {
  for (const img of images) {
    if (img.rank <= alreadyThere) continue;
    const fd = new FormData();
    fd.append("image", new Blob([fs.readFileSync(img.path)], { type: "image/jpeg" }), img.file);
    fd.append("rank", String(img.rank));
    fd.append("alt_text", img.alt_text);
    await client.request("POST", `/application/shops/${shopId}/listings/${listingId}/images`, { multipart: fd });
    console.log(`  photo ${img.rank}/${images.length} ${img.file}`);
  }
}

async function cmdWhoami() {
  const client = createClient();
  const raw = await resolveShop(client);
  console.log(`shop        ${raw.shopName}  (shop_id ${raw.shopId})`);
  console.log("shipping profiles");
  for (const p of raw.shipping) console.log(`  ${p.shipping_profile_id}  ${p.title}`);
  console.log("return policies");
  for (const r of raw.returns) console.log(`  ${r.return_policy_id}  returns ${r.accepts_returns ? "on" : "off"}, exchanges ${r.accepts_exchanges ? "on" : "off"}${r.return_deadline ? `, ${r.return_deadline} days` : ""}`);
  console.log("processing profiles");
  for (const r of raw.readiness) console.log(`  ${r.readiness_state_id}  ${r.readiness_state} (${r.processing_days_display_label ?? `${r.min_processing_days}-${r.max_processing_days} days`})`);
  console.log("sections");
  for (const s of raw.sections) console.log(`  ${s.shop_section_id}  ${s.title}`);
  console.log("production partners");
  for (const p of raw.partners) console.log(`  ${p.production_partner_id}  ${p.partner_name}`);
  try {
    const s = pickShopSettings(raw);
    console.log(`\ncreate will use: shipping ${s.shippingProfileId}, processing ${s.readinessStateId}, partner ${s.productionPartnerId}, return policy ${s.returnPolicyId ?? "(none)"}`);
  } catch (e) {
    console.log(`\n${e.message}`);
  }
}

async function cmdCreate(n, opts) {
  if (!Number.isInteger(n)) throw new Error("usage: create <listing-number> [--dry-run]");
  if (!READY_LISTINGS.includes(n)) {
    throw new Error(`listing ${n} isn't cleared for building (ready: ${READY_LISTINGS.join(", ")}; 04 is already a hand-built draft, 07/08 need print files, 09–12 need John's OK)`);
  }
  const { file, listing } = loadListing(opts.dir, n);
  const colorList = opts.colors ? opts.colors.split(",").map((c) => c.trim()).filter(Boolean) : null;
  const colors = chooseColors(listing, { colors: colorList, lightOnly: opts["light-only"] });
  const images = planImages(listing, colors);
  for (const img of images) if (!fs.existsSync(img.path)) throw new Error(`photo missing: ${img.path}`);
  const skipped = skippedImages(listing, colors);

  const live = hasTokens();
  const client = live ? createClient() : null;
  const shop = live ? pickShopSettings(await resolveShop(client)) : placeholderShop(listing);
  const draft = buildDraftListing(listing, shop);
  const inventory = buildInventory(listing, colors, shop.readinessStateId);

  if (opts["dry-run"]) {
    console.log(`DRY RUN: nothing is written to Etsy. Source: ${file}`);
    if (!live) console.log("(no tokens yet, so shop ids are placeholders and the duplicate-title check is skipped)");
    describe(listing, colors, images, skipped);
    if (live) {
      const dupes = await findSameTitle(client, shop.shopId, listing.title);
      console.log(dupes.length ? `\n!! would REFUSE: same title already on Etsy: ${dupes.map((d) => `${d.listing_id} (${d.state})`).join(", ")}` : "\nno listing with this title yet");
    }
    console.log(`\n1) createDraftListing  POST /v3/application/shops/${shop.shopId}/listings  (application/x-www-form-urlencoded)`);
    console.log(JSON.stringify(formFields(draft), null, 2));
    console.log(`\n2) updateListingInventory  PUT /v3/application/listings/<new listing_id>/inventory  (application/json, ${inventory.products.length} products)`);
    console.log(inventoryJson(inventory));
    console.log(`\n3) uploadListingImage ×${images.length}  POST /v3/application/shops/${shop.shopId}/listings/<new listing_id>/images  (multipart: image, rank, alt_text)`);
    for (const img of images) console.log(`  rank ${img.rank}  ${img.path}  alt "${img.alt_text}"`);
    return;
  }

  if (!live) throw new Error("no Etsy tokens yet — run: node scripts/etsy/etsy.mjs auth");
  describe(listing, colors, images, skipped);

  let listingId;
  let photosThere = 0;
  if (opts.resume) {
    listingId = Number(opts.resume);
    const existing = await client.request("GET", `/application/listings/${listingId}`);
    if (existing.shop_id !== shop.shopId) throw new Error(`listing ${listingId} isn't in this shop`);
    if (existing.state !== "draft") throw new Error(`listing ${listingId} is ${existing.state}, not a draft; not touching it`);
    if (!sameTitle(existing.title, listing.title)) throw new Error(`listing ${listingId} has a different title; not touching it`);
    photosThere = (await client.request("GET", `/application/listings/${listingId}/images`)).count ?? 0;
    console.log(`resuming draft ${listingId} (${photosThere} photos already there)`);
  } else {
    const dupes = await findSameTitle(client, shop.shopId, listing.title);
    if (dupes.length) {
      throw new Error(`refusing: a listing with this title already exists: ${dupes.map((d) => `${d.listing_id} (${d.state})`).join(", ")}`);
    }
    const created = await client.request("POST", `/application/shops/${shop.shopId}/listings`, { form: formFields(draft) });
    listingId = created.listing_id;
    console.log(`draft ${listingId} created (state: ${created.state})`);
  }
  recordListingId(n, listingId);

  try {
    await client.request("PUT", `/application/listings/${listingId}/inventory`, { json: inventory });
    console.log(`  inventory: ${inventory.products.length} variants priced`);
    await uploadImages(client, shop.shopId, listingId, images, photosThere);
  } catch (e) {
    e.message += `\n\nDraft ${listingId} exists but isn't finished. Fix the cause, then: node scripts/etsy/etsy.mjs create ${n} --resume ${listingId}${opts["light-only"] ? " --light-only" : ""}${opts.colors ? ` --colors "${opts.colors}"` : ""}`;
    throw e;
  }
  const final = await client.request("GET", `/application/listings/${listingId}`);
  console.log(`\ndone: draft ${listingId} (state: ${final.state}). Review and publish it on Etsy:`);
  console.log(`  https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`);
}

/** The Etsy listing_id for listing n: listings.json, else the one Etsy listing with its title (then recorded). */
async function resolveListingId(n, listing) {
  const known = listingIdFor(n);
  if (known) return known;
  if (!hasTokens()) throw new Error(`no Etsy listing id for #${n} in ${STATE_FILE}, and no Etsy tokens to look it up by title`);
  const client = createClient();
  const me = await client.request("GET", "/application/users/me");
  const hits = await findSameTitle(client, me.shop_id, listing.title);
  if (hits.length !== 1) {
    throw new Error(
      hits.length
        ? `${hits.length} Etsy listings have #${n}'s title (${hits.map((h) => `${h.listing_id} ${h.state}`).join(", ")}); put the right one in ${STATE_FILE}`
        : `no Etsy listing has #${n}'s title yet; run create ${n} first`,
    );
  }
  recordListingId(n, hits[0].listing_id);
  console.log(`(found #${n} on Etsy by title: ${hits[0].listing_id}, ${hits[0].state}; recorded in ${STATE_FILE})`);
  return hits[0].listing_id;
}

function printPlan(plan) {
  const w = Math.max(4, ...plan.rows.map((r) => (r.label ?? r.name).length));
  for (const r of plan.rows) {
    const label = (r.label ?? r.name).padEnd(w);
    if (r.action === "link") {
      console.log(`  link     ${label}  → catalog ${r.variant_id}  ${r.files.join(" + ")}${r.retail_price ? `  $${r.retail_price}` : ""}${r.note ? `  (${r.note})` : ""}`);
    } else if (r.action === "synced") {
      console.log(`  synced   ${label}  = catalog ${r.variant_id}  ${r.files.join(" + ")}${r.differs ? `  !! differs from the website: ${r.differs}` : ""}`);
    } else if (r.action === "ignored") {
      console.log(`  ignored  ${label}  (ignored in Printful; left alone)`);
    } else {
      console.log(`  NO MATCH ${label}  ${r.problem}`);
    }
  }
}

async function cmdLink(n, opts) {
  if (!Number.isInteger(n)) throw new Error("usage: link <listing-number> [--dry-run]");
  const dry = opts["dry-run"];
  const { listing } = loadListing(opts.dir, n);
  if (!listing.printfulSourceId) throw new Error(`listing ${n}'s file names no website "(sync product NNN)" under Printful source; can't tell which design to copy`);
  const listingId = await resolveListingId(n, listing);
  const pf = createPrintfulClient({ readOnly: dry });

  let etsy;
  try {
    etsy = (await pf.request("GET", `/sync/products/@${listingId}`)).result;
  } catch (e) {
    if (e instanceof PrintfulError && e.status === 404) {
      console.log(`#${n} (Etsy listing ${listingId}) is not in Printful yet; publish it on Etsy, then re-run.`);
      console.log("(Printful imports active listings right away; drafts only about once a day.)");
      return;
    }
    throw e;
  }
  const web = fetchWebsiteProduct(listing.printfulSourceId, { allowCache: dry });
  if (web.warning) console.log(`!! website product read from ${web.from}: ${web.warning}`);
  const plan = planLink(etsy, web.product, listing.pricesBySize);
  const c = plan.counts;

  console.log(`${dry ? "DRY RUN: nothing is written to Printful.\n" : ""}#${n} ${listing.name}`);
  console.log(`  Etsy listing ${listingId} → Printful sync product ${etsy.sync_product.id} (Etsy store): ${etsy.sync_product.synced}/${etsy.sync_product.variants} synced`);
  console.log(`  design from website product ${web.product.sync_product.id} "${web.product.sync_product.name}" (${web.from})`);
  printPlan(plan);
  console.log(`  ${c.total} variants: ${c.synced} already synced, ${c.link} to link, ${c.ignored} ignored, ${c.problem} without a match${c.differs ? `; ${c.differs} synced variant(s) differ from the website` : ""}`);

  if (plan.problems.length) {
    throw new Error(`stopping #${n}: ${plan.problems.length} variant(s) have no exact website match, so nothing is linked:\n  - ${plan.problems.join("\n  - ")}`);
  }
  if (!plan.toLink.length) {
    console.log("nothing to do.");
    return;
  }
  if (dry) {
    const one = plan.toLink[0];
    console.log(`\nwould send ${plan.toLink.length} × PUT /sync/variant/{id} (X-PF-Store-Id ${pf.storeId}); the first:`);
    console.log(`PUT /sync/variant/${one.id}  ${JSON.stringify(one.body)}`);
    return;
  }

  let done = 0;
  let withPrice = true;
  const unpriced = ({ retail_price, ...rest }) => rest;
  for (const step of plan.toLink) {
    let body = withPrice ? step.body : unpriced(step.body);
    try {
      try {
        await pf.request("PUT", `/sync/variant/${step.id}`, { json: body });
      } catch (e) {
        // A PUT is idempotent; if this store won't take a retail price, link the rest without one.
        if (!(e instanceof PrintfulError && e.status === 400 && /price/i.test(e.message) && body.retail_price)) throw e;
        withPrice = false;
        body = unpriced(body);
        await pf.request("PUT", `/sync/variant/${step.id}`, { json: body });
        console.log(`  (Printful refused retail_price: ${e.message}; linking without it)`);
      }
    } catch (e) {
      e.message += `\n\n${done} of ${plan.toLink.length} linked before this. Re-run link ${n} to finish (synced variants are skipped).`;
      throw e;
    }
    done++;
    console.log(`  linked ${done}/${plan.toLink.length}  ${step.label}  → catalog ${body.variant_id}`);
  }
  const after = (await pf.request("GET", `/sync/products/${etsy.sync_product.id}`)).result;
  const left = after.sync_variants.filter((v) => !v.synced && !v.is_ignored);
  console.log(`\ndone: ${after.sync_product.synced}/${after.sync_product.variants} synced in Printful.`);
  if (left.length) console.log(`still unsynced: ${left.map((v) => v.name).join("; ")}`);
}

async function cmdOrdersCheck() {
  const pf = createPrintfulClient({ readOnly: true });
  const orders = await pf.all("/orders");
  const flagged = orders.map((o) => ({ o, why: orderAttention(o) })).filter((x) => x.why.length);
  const when = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") : "?");
  console.log(`Printful Etsy store ${pf.storeId}: ${orders.length} order(s) read.`);
  if (!flagged.length) {
    console.log("none need attention.");
    return;
  }
  console.log(`${flagged.length} need attention:`);
  for (const { o, why } of flagged) {
    const items = (o.items ?? []).map((i) => `${i.quantity}× ${i.name}`).join("; ");
    console.log(`  #${o.id}  Etsy ${o.external_id ?? "?"}  ${o.status}  ${when(o.created)}  ${o.recipient?.name ?? ""}`);
    console.log(`      ${why.join(" · ")}`);
    if (items) console.log(`      ${items}`);
  }
  console.log("Printful → Stores → the Etsy store → Orders to fix or confirm them.");
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      "light-only": { type: "boolean", default: false },
      colors: { type: "string" },
      dir: { type: "string", default: DEFAULT_DIR },
      resume: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [cmd, arg] = positionals;
  if (values.help || !cmd) {
    const src = fs.readFileSync(new URL(import.meta.url), "utf8");
    console.log(src.split("\n").slice(1).filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return;
  }
  if (cmd === "auth") {
    const t = await runAuth();
    console.log(`Saved tokens (scopes: ${t.scope}). Next: node scripts/etsy/etsy.mjs whoami`);
  } else if (cmd === "whoami") {
    await cmdWhoami();
  } else if (cmd === "create") {
    await cmdCreate(Number(arg), values);
  } else if (cmd === "link") {
    await cmdLink(Number(arg), values);
  } else if (cmd === "orders-check") {
    await cmdOrdersCheck();
  } else {
    throw new Error(`unknown command "${cmd}" (auth | whoami | create | link | orders-check)`);
  }
}

main().catch((e) => {
  console.error(redact(e?.message ?? e));
  process.exit(1);
});
