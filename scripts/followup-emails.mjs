#!/usr/bin/env node
// The daily follow-up emails (lib/orders/followups.ts; DEPLOY.md "Follow-up emails"):
//   "How's it fit?"                         a few days after an order's last package arrived
//   "Your Blue Sky Cotton Shorts are being made"   Yoycol orders, 12–14 days in, not shipped yet
// Cron runs it once a day. Each is off unless switched on in .env:
//   MOP_FOLLOWUP_FIT_ENABLED=1, MOP_FOLLOWUP_YOYCOL_ENABLED=1
// Off, it only logs what it would send (the address's domain, never the address).
//
//   node --env-file=/srv/mopclothing/.env scripts/followup-emails.mjs               # the daily run
//   ... scripts/followup-emails.mjs --dry-run                                       # print the emails, send none (on or off)
//   ... scripts/followup-emails.mjs --include-before 2026-10-01                     # also orders from Oct 1 that came
//                                                                                   #   before the switch went on
//   --verbose   print what Printful / Yoycol answered
//
// Reads $MOP_DATA_DIR/orders.jsonl, orders-state.json and shipments-emailed.jsonl (never
// writes them); appends to followups-emailed.jsonl (one email per order, ever) and writes
// followups-start.json the first time a switch is on (no backfill before that).
// Needs PRINTFUL_API_TOKEN (+ PRINTFUL_STORE_ID), YOYCOL_ACCESS_KEY / YOYCOL_SECRET_KEY,
// MOP_RESEND_API_KEY (+ MOP_EMAIL_FROM / MOP_EMAIL_REPLY_TO) and PINGPIGEON_TOKEN (to tell
// John when an email fails). Imports the site's TypeScript (lib/orders): Node >= 22.18.
// Exit code: 0 fine, 1 something failed (a supplier call, an email), 2 bad arguments.
import fs from "node:fs";
import path from "node:path";

const { runFollowups } = await import("../lib/orders/followups.ts");
const { dataDir } = await import("../lib/orders/store.ts");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = "usage: followup-emails.mjs [--dry-run] [--include-before YYYY-MM-DD] [--verbose]";
if (flag("--help") || flag("-h")) {
  console.log(usage);
  process.exit(0);
}
const known = new Set(["--dry-run", "--include-before", "--verbose"]);
const unknown = args.filter((a, i) => a.startsWith("-") && !known.has(a) && args[i - 1] !== "--include-before");
const before = opt("--include-before");
// A calendar date (UTC midnight); 2026-02-30 and the like are refused, not rolled over.
const beforeDate = before && /^\d{4}-\d{2}-\d{2}$/.test(before) ? new Date(`${before}T00:00:00Z`) : undefined;
const validBefore = !!beforeDate && !Number.isNaN(beforeDate.getTime()) && beforeDate.toISOString().slice(0, 10) === before;
if (unknown.length || (flag("--include-before") && !validBefore)) {
  console.error(unknown.length ? `unknown option ${unknown[0]}` : "--include-before needs a date: YYYY-MM-DD");
  console.error(usage);
  process.exit(2);
}

const env = process.env;
const dir = dataDir(env);
const statePath = path.join(dir, "orders-state.json");
let state = null;
try {
  state = JSON.parse(fs.readFileSync(statePath, "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") {
    console.error(`[followup] can't read ${statePath}: ${err.message}`);
    process.exit(1);
  }
}

let summary;
try {
  summary = await runFollowups({
    env,
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
    log: (m) => console.log(m),
    dir,
    state,
    dryRun: flag("--dry-run"),
    includeBefore: beforeDate,
    verbose: flag("--verbose"),
  });
} catch (err) {
  console.error(`[followup] ${new Date().toISOString()}: FAILED: ${err.stack ?? err.message}`);
  process.exit(1);
}
const count = (type, outcome) => summary.results.filter((r) => r.type === type && r.outcome === outcome).length;
for (const [type, label] of [["fit", `"How's it fit?"`], ["being_made", `"being made"`]]) {
  const parts = [
    ["sent", "sent"],
    ["dry_run", "dry run"],
    ["would_send", "would send (off)"],
    ["waiting", "waiting"],
    ["held", "held"],
    ["skipped", "skipped"],
    ["failed", "FAILED"],
  ]
    .map(([o, name]) => [count(type, o), name])
    .filter(([n]) => n)
    .map(([n, name]) => `${n} ${name}`);
  console.log(`[followup] ${new Date().toISOString()}: ${label}: ${parts.join(", ") || "nothing due"}`);
}
if (summary.errors) console.log(`[followup] ${summary.errors} error(s): see the lines above`);
process.exitCode = summary.errors ? 1 : 0;
