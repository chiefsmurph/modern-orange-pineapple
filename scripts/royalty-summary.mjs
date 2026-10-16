#!/usr/bin/env node
// Monthly royalty summary: per-artist totals for the month from
// $MOP_DATA_DIR/royalties.jsonl, plus each artist's running balance (lifetime
// owed − paid) using the payouts log $MOP_DATA_DIR/royalty-payouts.jsonl
// (written by scripts/royalty-payout.mjs). Emailed to John through PingPigeon
// (PINGPIGEON_URL, PINGPIGEON_TOKEN). Meant to run on the 1st of each month for
// the month before (Pacific time).
//
//   node --env-file=/srv/mopclothing/.env scripts/royalty-summary.mjs            # last month, email
//   node scripts/royalty-summary.mjs --month 2026-10 --dry-run                  # print only
//   --include-test   also count Stripe test-mode orders (skipped by default)
//
// Street sales (shirts sold in person, logged with scripts/street-sale.mjs) are
// rows in the same file with source "street"; the email counts them apart.
//
// Plain Node (no dependencies, no TypeScript) so it runs anywhere on the box.
// Refunds: the order ledger doesn't see them (the webhook only records paid
// orders). Record one with `royalty-payout.mjs --refund-order <order_ref>` and
// it comes off the artist's balance here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROYALTIES_FILE = "royalties.jsonl";
export const PAYOUTS_FILE = "royalty-payouts.jsonl";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export const TZ = "America/Los_Angeles";
const monthOf = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(date);
/** YYYY-MM-DD in Pacific time. */
export const dayOf = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);

/** The month before `now`, as YYYY-MM in Pacific time. */
export function previousMonth(now = new Date()) {
  const [y, m] = monthOf(now).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export const dataDir = (env = process.env) => path.resolve(env.MOP_DATA_DIR || path.join(process.cwd(), "data"));

/** One JSON object per line; unreadable lines are reported and skipped. A missing file is empty. */
export function readJsonl(file, warn = (l) => console.error(`skipping unreadable line in ${path.basename(file)}: ${l.slice(0, 80)}`)) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      warn(l);
      return [];
    }
  });
}

/**
 * Artists the catalog pays royalties to (the `artist` of every rule in
 * lib/catalog/fulfilment.generated.ts and lib/orders/royalties.ts), read as text
 * so this stays plain Node. Used to show $0 balances and to check payout names.
 */
export function knownArtists(root = ROOT) {
  const out = new Set();
  for (const rel of ["lib/catalog/fulfilment.generated.ts", "lib/orders/royalties.ts"]) {
    const f = path.join(root, rel);
    if (!fs.existsSync(f)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/\bartist"?:\s*"([a-z0-9-]+)"/g)) out.add(m[1]);
  }
  return [...out].sort();
}

const cents = (n) => Math.round(n * 100);
const money = (c) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;
const counts = (r, includeTest) => !!r && typeof r.amount === "number" && !!r.artist && (includeTest || r.livemode !== false);

export function summarize(rows, month, { includeTest = false } = {}) {
  const byArtist = new Map();
  for (const r of rows) {
    if (!counts(r, includeTest) || !r.at) continue;
    if (monthOf(new Date(r.at)) !== month) continue;
    const a = byArtist.get(r.artist) ?? { artist: r.artist, items: 0, street: 0, amount: 0, lines: [] };
    a.items += r.qty ?? 1;
    // sold in person (scripts/street-sale.mjs), not through the website
    if (r.source === "street") a.street += r.qty ?? 1;
    a.amount = Math.round((a.amount + r.amount) * 100) / 100;
    a.lines.push(r);
    byArtist.set(r.artist, a);
  }
  return [...byArtist.values()].sort((x, y) => y.amount - x.amount || x.artist.localeCompare(y.artist));
}

/**
 * Lifetime balance per artist, up to now: earned (every royalties.jsonl row
 * since the ledger began) − refunded (refund entries in the payouts log) −
 * paid (payout entries). Amounts in dollars, computed in cents. `artists`
 * adds names with nothing yet (shown as $0).
 */
export function balances(rows, payouts, { includeTest = false, artists = [] } = {}) {
  const by = new Map();
  const get = (artist) => {
    if (!by.has(artist)) by.set(artist, { artist, items: 0, earned: 0, refunded: 0, paid: 0, since: undefined });
    return by.get(artist);
  };
  for (const name of artists) get(name);
  for (const r of rows) {
    if (!counts(r, includeTest) || !r.at) continue;
    const a = get(r.artist);
    a.items += r.qty ?? 1;
    a.earned += cents(r.amount);
    const day = dayOf(new Date(r.at));
    if (!a.since || day < a.since) a.since = day;
  }
  for (const p of payouts) {
    if (!counts(p, includeTest)) continue;
    if (p.type === "payout") get(p.artist).paid += cents(p.amount);
    else if (p.type === "refund") get(p.artist).refunded += cents(p.amount);
  }
  return [...by.values()]
    .map((a) => ({
      artist: a.artist,
      items: a.items,
      since: a.since,
      earned: a.earned / 100,
      refunded: a.refunded / 100,
      owed: (a.earned - a.refunded) / 100,
      paid: a.paid / 100,
      balance: (a.earned - a.refunded - a.paid) / 100,
    }))
    .sort((x, y) => y.balance - x.balance || y.owed - x.owed || x.artist.localeCompare(y.artist));
}

/** Payouts and refunds recorded with a date in `month` (YYYY-MM), oldest first. */
export const entriesInMonth = (payouts, month, { includeTest = false } = {}) =>
  payouts
    .filter((p) => counts(p, includeTest) && (p.type === "payout" || p.type === "refund") && String(p.date ?? "").slice(0, 7) === month)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

const monthName = (month) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * `extra.balances` (from balances()) adds the running balance per artist;
 * `extra.entries` (entriesInMonth) lists the month's payouts and refunds.
 */
export function summaryEmail(month, artists, extra = {}) {
  const { balances: bal, entries = [], asOf } = extra;
  const total = artists.reduce((n, a) => n + cents(a.amount), 0);
  const due = bal ? bal.reduce((n, b) => n + cents(b.balance), 0) : undefined;
  const subject =
    `MOP royalties for ${monthName(month)}: ${
      artists.length ? artists.map((a) => `${a.artist} $${a.amount.toFixed(2)}`).join(", ") : "none"
    }` + (bal ? ` (due now: ${money(due)})` : "");
  const lines = [`Royalties earned in ${monthName(month)} (website orders paid and street sales made that month, Pacific time).`, ""];
  if (!artists.length) lines.push("No royalty-bearing items sold.", "");
  const plural = (n) => `${n} item${n === 1 ? "" : "s"}`;
  for (const a of artists) {
    const street = a.street ?? 0;
    lines.push(`${a.artist}: $${a.amount.toFixed(2)} for ${plural(a.items)}${street ? ` (street sales: ${plural(street)})` : ""}`);
    for (const r of a.lines) {
      const where = r.source === "street" ? `  street sale${r.place ? `, ${r.place}` : ""}` : "";
      lines.push(`  ${dayOf(new Date(r.at))}  ${r.qty ?? 1} x ${r.product} (${Object.values(r.options ?? {}).join(" / ")})  $${r.amount.toFixed(2)}  ${r.order_ref}${where}`);
    }
    lines.push("");
  }
  lines.push(`Total for ${monthName(month)}: ${money(total)}`);
  // In-person sales (car, markets) logged with scripts/street-sale.mjs, shown apart from the website's.
  const streetItems = artists.reduce((n, a) => n + (a.street ?? 0), 0);
  if (streetItems) {
    const streetTotal = artists.reduce((n, a) => n + a.lines.filter((r) => r.source === "street").reduce((m, r) => m + cents(r.amount), 0), 0);
    lines.push(`Of which street sales: ${plural(streetItems)}, ${money(streetTotal)} (the rest are website orders)`);
  }
  if (entries.length) {
    lines.push("", `Payouts and refunds recorded in ${monthName(month)}:`);
    for (const p of entries) {
      const what = p.type === "refund" ? `refund −$${p.amount.toFixed(2)}${p.order_ref ? `  ${p.order_ref}` : ""}` : `paid $${p.amount.toFixed(2)}`;
      lines.push(`  ${p.date}  ${p.artist}  ${what}${p.note ? `  (${p.note})` : ""}`);
    }
  }
  if (bal) {
    const since = bal.map((b) => b.since).filter(Boolean).sort()[0];
    lines.push("", `Balance per artist as of ${asOf ?? dayOf(new Date())} (lifetime: every royalty${since ? ` since the first, ${since}` : ""}):`);
    const refunds = bal.some((b) => b.refunded);
    const w = Math.max(6, ...bal.map((b) => b.artist.length));
    const cols = ["owed (lifetime)", ...(refunds ? ["of which refunded"] : []), "paid", "balance"];
    lines.push(`  ${"artist".padEnd(w)}  ${cols.map((c) => c.padStart(15)).join("  ")}`);
    for (const b of bal) {
      const vals = [cents(b.owed), ...(refunds ? [-cents(b.refunded)] : []), cents(b.paid), cents(b.balance)];
      lines.push(`  ${b.artist.padEnd(w)}  ${vals.map((v) => money(v).padStart(15)).join("  ")}`);
    }
    lines.push(`Total due now: ${money(due)}`);
    if (bal.some((b) => b.balance < 0)) lines.push("A negative balance means that artist was paid more than they've earned so far.");
  }
  lines.push(
    "",
    "Refunds only count once recorded: royalty-payout.mjs --refund-order <order_ref>. Check Stripe for refunded orders above.",
    "Log a shirt sold in person: sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/street-sale.mjs --product alpaca --size M --price 25 --place <where>",
    "Record a payout: sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/royalty-payout.mjs --artist <name> --amount <dollars> --note <how>"
  );
  return { subject, body: lines.join("\n") };
}

async function main() {
  const month = opt("--month") ?? previousMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`bad --month ${month} (want YYYY-MM)`);
  const dir = dataDir();
  const includeTest = flag("--include-test");
  const rows = readJsonl(path.join(dir, ROYALTIES_FILE));
  const payouts = readJsonl(path.join(dir, PAYOUTS_FILE));
  const artists = summarize(rows, month, { includeTest });
  const email = summaryEmail(month, artists, {
    balances: balances(rows, payouts, { includeTest, artists: knownArtists() }),
    entries: entriesInMonth(payouts, month, { includeTest }),
  });

  if (flag("--dry-run")) {
    console.log(`Subject: ${email.subject}\n\n${email.body}`);
    return;
  }
  const token = process.env.PINGPIGEON_TOKEN;
  if (!token) throw new Error("PINGPIGEON_TOKEN is not set");
  const base = (process.env.PINGPIGEON_URL || "http://127.0.0.1:3141").replace(/\/+$/, "");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(`${base}/email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "mopclothing-royalties/1" },
        body: JSON.stringify(email),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) {
        console.log(`sent: ${email.subject}`);
        return;
      }
      console.error(`attempt ${attempt}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    } catch (err) {
      console.error(`attempt ${attempt}: ${err.message}`);
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 5000));
  }
  // Leave the summary in the journal so nothing is lost.
  console.log(`Subject: ${email.subject}\n\n${email.body}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
