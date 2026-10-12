#!/usr/bin/env node
// Monthly royalty summary: per-artist totals from $MOP_DATA_DIR/royalties.jsonl,
// emailed to John through PingPigeon (PINGPIGEON_URL, PINGPIGEON_TOKEN).
// Meant to run on the 1st of each month for the month before (Pacific time).
//
//   node --env-file=/srv/mopclothing/.env scripts/royalty-summary.mjs            # last month, email
//   node scripts/royalty-summary.mjs --month 2026-10 --dry-run                  # print only
//   --include-test   also count Stripe test-mode orders (skipped by default)
//
// Plain Node (no dependencies, no TypeScript) so it runs anywhere on the box.
// It does not know about refunds: subtract any refunded orders by hand.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const TZ = "America/Los_Angeles";
const monthOf = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(date);

/** The month before `now`, as YYYY-MM in Pacific time. */
export function previousMonth(now = new Date()) {
  const [y, m] = monthOf(now).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function summarize(rows, month, { includeTest = false } = {}) {
  const byArtist = new Map();
  for (const r of rows) {
    if (!r || typeof r.amount !== "number" || !r.at) continue;
    if (!includeTest && r.livemode === false) continue;
    if (monthOf(new Date(r.at)) !== month) continue;
    const a = byArtist.get(r.artist) ?? { artist: r.artist, items: 0, amount: 0, lines: [] };
    a.items += r.qty ?? 1;
    a.amount = Math.round((a.amount + r.amount) * 100) / 100;
    a.lines.push(r);
    byArtist.set(r.artist, a);
  }
  return [...byArtist.values()].sort((x, y) => y.amount - x.amount || x.artist.localeCompare(y.artist));
}

const monthName = (month) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function summaryEmail(month, artists) {
  const total = artists.reduce((n, a) => n + a.amount, 0);
  const subject = `MOP royalties for ${monthName(month)}: ${
    artists.length ? artists.map((a) => `${a.artist} $${a.amount.toFixed(2)}`).join(", ") : "none"
  }`;
  const lines = [`Royalties owed for ${monthName(month)} (orders paid that month, Pacific time).`, ""];
  if (!artists.length) lines.push("No royalty-bearing items sold.");
  for (const a of artists) {
    lines.push(`${a.artist}: $${a.amount.toFixed(2)} for ${a.items} item${a.items === 1 ? "" : "s"}`);
    for (const r of a.lines) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(r.at));
      lines.push(`  ${day}  ${r.qty ?? 1} x ${r.product} (${Object.values(r.options ?? {}).join(" / ")})  $${r.amount.toFixed(2)}  ${r.order_ref}`);
    }
    lines.push("");
  }
  lines.push(`Total: $${total.toFixed(2)}`, "", "Refunds are not subtracted: check Stripe for any refunded orders above.");
  return { subject, body: lines.join("\n") };
}

async function main() {
  const month = opt("--month") ?? previousMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`bad --month ${month} (want YYYY-MM)`);
  const dir = path.resolve(process.env.MOP_DATA_DIR || path.join(process.cwd(), "data"));
  const file = path.join(dir, "royalties.jsonl");
  const rows = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          console.error(`skipping unreadable line: ${l.slice(0, 80)}`);
          return [];
        }
      })
    : [];
  const artists = summarize(rows, month, { includeTest: flag("--include-test") });
  const email = summaryEmail(month, artists);

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
