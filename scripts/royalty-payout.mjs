#!/usr/bin/env node
// Record a royalty payout (or a refunded order) in the append-only payouts log
// $MOP_DATA_DIR/royalty-payouts.jsonl. scripts/royalty-summary.mjs reads it for
// each artist's balance (lifetime owed − paid). Lines are only ever appended,
// never edited: a payout recorded by mistake is undone by recording a negative
// one (--correct, with a --note saying what it fixes).
//
// On the box, as the app user:
//   sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing \
//     node /srv/mopclothing/scripts/royalty-payout.mjs --artist janette --amount 3.00 --note "Venmo"
//
//   --artist <name>      as in royalties.jsonl (janette, austin, sunshine)
//   --amount <dollars>   e.g. 3 or 3.00
//   --date YYYY-MM-DD    when it was paid (default: today, Pacific time)
//   --note <text>        how / reference, e.g. "Venmo @janette"
//   --correct            allow a negative --amount, to undo a wrong payout
//   --refund-order <ref> instead of a payout: take a refunded order's royalties off
//                        (its order_ref from royalties.jsonl / John's order email);
//                        --artist / --slug limit it to part of the order
//   --dry-run            print the line(s) and the new balance, write nothing
//   --force              allow an artist the catalog doesn't know, or paying more than the balance
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PAYOUTS_FILE, ROYALTIES_FILE, balances, dataDir, dayOf, knownArtists, readJsonl } from "./royalty-summary.mjs";

const cents = (n) => Math.round(n * 100);

export function parseAmount(raw, { allowNegative = false } = {}) {
  const s = String(raw ?? "").trim().replace(/^\$/, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`bad --amount ${raw} (want dollars, e.g. 3.00)`);
  const n = Number(s);
  if (n === 0 || (n < 0 && !allowNegative)) throw new Error(`--amount must be more than $0${allowNegative ? " (or negative with --correct)" : ""}`);
  return n;
}

export function parseDate(raw, now = new Date()) {
  const today = dayOf(now);
  if (raw == null) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T12:00:00Z`)) || new Date(`${raw}T12:00:00Z`).toISOString().slice(0, 10) !== raw)
    throw new Error(`bad --date ${raw} (want YYYY-MM-DD)`);
  if (raw > today) throw new Error(`--date ${raw} is in the future`);
  return raw;
}

/**
 * The payout entry to append, after checking it against the ledger.
 * `known`: artists the catalog pays; `rows`/`payouts`: current files.
 */
export function payoutEntry({ artist, amount, date, note, correct = false, force = false }, { rows, payouts, known, now = new Date(), by } = {}) {
  const name = String(artist ?? "").trim().toLowerCase();
  if (!name) throw new Error("--artist is required");
  const seen = new Set([...(known ?? []), ...rows.map((r) => r.artist), ...payouts.map((p) => p.artist)]);
  if (!seen.has(name) && !force) throw new Error(`unknown artist "${name}" (known: ${[...seen].sort().join(", ") || "none"}); --force to record anyway`);
  const amt = parseAmount(amount, { allowNegative: correct });
  if (correct && !note) throw new Error("--correct needs a --note saying what it fixes");
  const bal = balances(rows, payouts).find((b) => b.artist === name)?.balance ?? 0;
  if (amt > 0 && cents(amt) > cents(bal) && !force)
    throw new Error(`$${amt.toFixed(2)} is more than ${name}'s balance ($${bal.toFixed(2)}); --force to record an advance`);
  return {
    type: "payout",
    artist: name,
    amount: amt,
    date: parseDate(date, now),
    ...(note ? { note: String(note) } : {}),
    ...(correct ? { correction: true } : {}),
    recorded_at: now.toISOString(),
    ...(by ? { recorded_by: by } : {}),
  };
}

/**
 * Refund entries for a refunded order: one per artist, the order's royalty rows
 * (optionally only one artist's / one product's) minus anything already refunded.
 */
export function refundEntries({ order, artist, slug, date, note }, { rows, payouts, now = new Date(), by } = {}) {
  const ref = String(order ?? "").trim();
  if (!ref) throw new Error("--refund-order needs an order_ref");
  const name = artist ? String(artist).trim().toLowerCase() : undefined;
  const mine = rows.filter((r) => r.order_ref === ref && typeof r.amount === "number" && (!name || r.artist === name) && (!slug || r.slug === slug));
  if (!mine.length) throw new Error(`no royalty rows for order ${ref}${name ? ` / ${name}` : ""}${slug ? ` / ${slug}` : ""} (nothing to refund)`);
  const when = parseDate(date, now);
  const out = [];
  for (const a of [...new Set(mine.map((r) => r.artist))].sort()) {
    const earned = mine.filter((r) => r.artist === a).reduce((n, r) => n + cents(r.amount), 0);
    const orderEarned = rows.filter((r) => r.order_ref === ref && r.artist === a).reduce((n, r) => n + cents(r.amount), 0);
    const done = payouts.filter((p) => p.type === "refund" && p.order_ref === ref && p.artist === a).reduce((n, p) => n + cents(p.amount), 0);
    const left = Math.min(earned, orderEarned - done);
    if (left <= 0) continue;
    out.push({
      type: "refund",
      artist: a,
      amount: left / 100,
      date: when,
      order_ref: ref,
      ...(slug ? { slug } : {}),
      livemode: mine.find((r) => r.artist === a).livemode !== false,
      ...(note ? { note: String(note) } : {}),
      recorded_at: now.toISOString(),
      ...(by ? { recorded_by: by } : {}),
    });
  }
  if (!out.length) throw new Error(`order ${ref} is already refunded`);
  return out;
}

/** Append-only write (the file is created 0640 if it isn't there). */
export function appendEntries(file, entries) {
  const fd = fs.openSync(file, "a", 0o640);
  try {
    fs.writeSync(fd, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  } finally {
    fs.closeSync(fd);
  }
}

function main(argv) {
  const flag = (n) => argv.includes(n);
  const opt = (n) => {
    const i = argv.indexOf(n);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith("--") && !/^-\d/.test(v))) throw new Error(`${n} needs a value`);
    return v;
  };
  const dir = dataDir();
  if (!fs.existsSync(dir)) throw new Error(`no data dir ${dir} (set MOP_DATA_DIR)`);
  const file = path.join(dir, PAYOUTS_FILE);
  const rows = readJsonl(path.join(dir, ROYALTIES_FILE));
  const payouts = readJsonl(file);
  let by;
  try {
    by = os.userInfo().username;
  } catch {}
  const ctx = { rows, payouts, known: knownArtists(), by };
  const entries = opt("--refund-order")
    ? refundEntries({ order: opt("--refund-order"), artist: opt("--artist"), slug: opt("--slug"), date: opt("--date"), note: opt("--note") }, ctx)
    : [payoutEntry({ artist: opt("--artist"), amount: opt("--amount"), date: opt("--date"), note: opt("--note"), correct: flag("--correct"), force: flag("--force") }, ctx)];
  for (const e of entries) console.log(JSON.stringify(e));
  const after = balances(rows, [...payouts, ...entries]);
  for (const a of new Set(entries.map((e) => e.artist))) {
    const b = after.find((x) => x.artist === a);
    console.log(`${a}: owed $${b.owed.toFixed(2)} · paid $${b.paid.toFixed(2)} · balance $${b.balance.toFixed(2)}`);
  }
  if (flag("--dry-run")) {
    console.log(`dry run: nothing written to ${file}`);
    return;
  }
  appendEntries(file, entries);
  console.log(`appended ${entries.length} line${entries.length === 1 ? "" : "s"} to ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
