#!/usr/bin/env node
// Log shirts sold in person (from the car, at markets; cash or Venmo) so their
// artist royalties reach the monthly email like website orders do. Appends:
//   $MOP_DATA_DIR/royalties.jsonl     one row per royalty-bearing item, the same
//                                     format as the webhook's, marked source "street"
//                                     (royalty-summary.mjs / royalty-payout.mjs read it)
//   $MOP_DATA_DIR/street-sales.jsonl  one line per sale (price, place, payment), for analysis
// Both files are append-only. The royalty rules are the website's
// (lib/orders/royalties.ts rulesFor, MOP_ROYALTY_RATES overrides included):
// alpaca → austin, star → sunshine, Grind Beanie pelican → janette, $1.50 an item.
//
// On the box, as the app user:
//   sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/street-sale.mjs \
//     --product alpaca --size M --qty 1 --price 25 --place "Pacific Beach" --paid cash --dry-run
//
//   --product <slug>    a website product (alpaca-tee, pelican-tee, rabbit-tee, original-star-tee, …)
//                       or its short name: alpaca, pelican, rabbit, star
//   --style <s>         beanie | classic: required for the pelican (only the beanie pays Janette)
//   --size <s>          XS S M L XL 2XL 3XL 4XL 5XL, or "One size"
//   --qty <n>           how many of this one shirt (default 1)
//   --price <dollars>   what each one sold for, e.g. 25 (the total is price × qty)
//   --place <text>      where, e.g. "Pacific Beach" (optional)
//   --paid <how>        cash | venmo | … (optional)
//   --color <text>      the shirt colour, e.g. "Blue Jean" (optional)
//   --note <text>       anything else (optional)
//   --date YYYY-MM-DD   the day it sold (default: today, Pacific time)
//   --again             log it even though the same sale is already in the log today
//   --dry-run           print what would be written, write nothing
//
// Logged by mistake? Take its royalties back off with
//   royalty-payout.mjs --refund-order <the street-… ref it printed> --note "logged by mistake"
//
// Needs Node >= 22.18: it imports the website's TypeScript royalty rules directly.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROYALTIES_FILE, dataDir, dayOf, readJsonl } from "./royalty-summary.mjs";
import { appendEntries, parseDate } from "./royalty-payout.mjs";

export const STREET_SALES_FILE = "street-sales.jsonl";

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // Node's one-time "module type not specified" notice about the .ts files below is noise here.
  const printers = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w?.code !== "MODULE_TYPELESS_PACKAGE_JSON") for (const p of printers) p(w);
  });
}
const { royaltyRows, rulesFor } = await import("../lib/orders/royalties.ts");
const { catalogProducts } = await import("../lib/catalog/products.generated.ts");

/** Short names for the street stock. */
export const ALIASES = { alpaca: "alpaca-tee", pelican: "pelican-tee", rabbit: "rabbit-tee", star: "original-star-tee" };

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "One size"];
const SIZE_SPELLINGS = { XXL: "2XL", XXXL: "3XL", XXXXL: "4XL", XXXXXL: "5XL", OS: "One size", "ONE SIZE": "One size" };

export function normalizeSize(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  const size = SIZE_SPELLINGS[s] ?? SIZES.find((x) => x.toUpperCase() === s);
  if (!size) throw new Error(`bad --size ${raw} (want one of ${SIZES.join(", ")})`);
  return size;
}

export function findProduct(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) throw new Error("--product is required");
  const slug = ALIASES[key] ?? key;
  const p = catalogProducts.find((x) => x.slug === slug);
  if (!p)
    throw new Error(`unknown --product ${raw} (short names: ${Object.keys(ALIASES).join(", ")}; or a slug: ${catalogProducts.map((x) => x.slug).join(", ")})`);
  return p;
}

const parseQty = (raw) => {
  const s = String(raw ?? "1").trim();
  if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 100) throw new Error(`bad --qty ${raw} (want a whole number, 1–100)`);
  return Number(s);
};

const parsePrice = (raw) => {
  if (raw == null) throw new Error("--price is required (dollars each, e.g. 25)");
  const s = String(raw).trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`bad --price ${raw} (want dollars each, e.g. 25 or 22.50)`);
  return Number(s);
};

const text = (v) => (v == null || String(v).trim() === "" ? undefined : String(v).trim());
const round2 = (n) => Math.round(n * 100) / 100;

/** A ref like street-20261017-3f9a1c: what royalty-payout.mjs --refund-order takes. */
export const streetRef = (date, rand = crypto.randomBytes(3).toString("hex")) => `street-${date.replaceAll("-", "")}-${rand}`;

/**
 * The lines to append for one street sale: `rows` (royalties.jsonl, possibly none)
 * and `sale` (street-sales.jsonl). `sales` is the current street-sales log, to catch
 * the same sale logged twice; `now`, `ref`, `by` and `env` are for tests.
 */
export function streetSale(input, { sales = [], now = new Date(), ref, by, env = process.env } = {}) {
  const product = findProduct(input.product);
  const opts = {};
  const styles = product.options.style;
  if (styles) {
    const style = text(input.style)?.toLowerCase();
    if (!style) throw new Error(`--style is required for ${product.slug} (${styles.join(" or ")})`);
    if (!styles.includes(style)) throw new Error(`bad --style ${input.style} for ${product.slug} (want ${styles.join(" or ")})`);
    opts.style = style;
  } else if (text(input.style)) {
    throw new Error(`${product.slug} has no style to pick (leave --style out)`);
  }
  if (text(input.color)) opts.color = text(input.color);
  const onlySize = product.options.size?.length === 1 ? product.options.size[0] : undefined;
  opts.size = input.size == null && onlySize ? onlySize : normalizeSize(input.size);
  const qty = parseQty(input.qty);
  const price = parsePrice(input.price);
  const date = parseDate(text(input.date), now);
  const place = text(input.place);
  const paid = text(input.paid)?.toLowerCase();
  const note = text(input.note);

  const same = sales.find(
    (s) =>
      s.date === date &&
      s.slug === product.slug &&
      s.qty === qty &&
      s.price_each === price &&
      (s.place ?? "") === (place ?? "") &&
      JSON.stringify(s.options) === JSON.stringify(opts)
  );
  if (same && !input.again) throw new Error(`already logged: ${same.order_ref} (same shirt, price and place on ${date}); --again to log another`);

  const order_ref = ref ?? streetRef(date);
  // The day it sold, at midday Pacific (so the email's Pacific-time month is right),
  // or the actual time when it's today's sale.
  const at = date === dayOf(now) ? now.toISOString() : `${date}T20:00:00.000Z`;
  const record = {
    session_id: order_ref,
    order_ref,
    livemode: true,
    items: [{ slug: product.slug, title: product.title, qty, opts }],
  };
  const rows = royaltyRows(record, at, env, rulesFor).map((r) => ({ ...r, source: "street", ...(place ? { place } : {}) }));
  const sale = {
    type: "street_sale",
    date,
    at,
    order_ref,
    slug: product.slug,
    product: product.title,
    options: opts,
    qty,
    price_each: price,
    total: round2(price * qty),
    ...(place ? { place } : {}),
    ...(paid ? { paid } : {}),
    ...(note ? { note } : {}),
    royalties: rows.map((r) => ({ artist: r.artist, amount: r.amount })),
    recorded_at: now.toISOString(),
    ...(by ? { recorded_by: by } : {}),
  };
  return { rows, sale };
}

export function parseArgs(argv) {
  const out = {};
  const VALUED = ["product", "style", "size", "qty", "price", "place", "paid", "color", "note", "date"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--again") out.again = true;
    else if (a.startsWith("--") && VALUED.includes(a.slice(2))) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
      i++;
    } else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

function main(argv) {
  const input = parseArgs(argv);
  const dir = dataDir();
  if (!fs.existsSync(dir)) throw new Error(`no data dir ${dir} (set MOP_DATA_DIR)`);
  const salesFile = path.join(dir, STREET_SALES_FILE);
  const royaltiesFile = path.join(dir, ROYALTIES_FILE);
  let by;
  try {
    by = os.userInfo().username;
  } catch {}
  const { rows, sale } = streetSale(input, { sales: readJsonl(salesFile), by });
  const opts = Object.values(sale.options).join(" / ");
  console.log(`${sale.order_ref}: ${sale.qty} x ${sale.product} (${opts}) at $${sale.price_each.toFixed(2)} = $${sale.total.toFixed(2)}${sale.place ? `, ${sale.place}` : ""} on ${sale.date}`);
  if (rows.length) for (const r of rows) console.log(`  royalty: ${r.artist} $${r.amount.toFixed(2)} (${r.qty} x $${r.per_item.toFixed(2)})`);
  else console.log("  no royalty for this design");
  if (input.dryRun) {
    for (const r of rows) console.log(JSON.stringify(r));
    console.log(JSON.stringify(sale));
    console.log(`dry run: nothing written to ${dir}`);
    return;
  }
  // Royalties first: if the second write fails the money owed is still on the ledger.
  if (rows.length) appendEntries(royaltiesFile, rows);
  appendEntries(salesFile, [sale]);
  console.log(`appended ${rows.length} royalty line${rows.length === 1 ? "" : "s"} to ${royaltiesFile} and the sale to ${salesFile}`);
}

if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
