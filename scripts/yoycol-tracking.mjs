#!/usr/bin/env node
// Yoycol tracking check: emails customers "your order has shipped" once a Yoycol
// order (the all-over shorts / tee) has a tracking number. Yoycol has no webhooks,
// so cron runs this once or twice a day (DEPLOY.md, "Shipped emails").
//
//   node --env-file=/srv/mopclothing/.env scripts/yoycol-tracking.mjs             # check + email
//   ... scripts/yoycol-tracking.mjs --dry-run                                    # log the emails, send none
//   ... scripts/yoycol-tracking.mjs --order mop-<ref> --verbose --dry-run        # one order, print Yoycol's answer
//   --max-age-days N   only orders placed in the last N days (default 60)
//
// Reads $MOP_DATA_DIR/orders-state.json (never writes it) and appends to
// $MOP_DATA_DIR/shipments-emailed.jsonl, so each order is emailed once.
// Needs YOYCOL_ACCESS_KEY / YOYCOL_SECRET_KEY, MOP_RESEND_API_KEY (+ MOP_EMAIL_FROM /
// MOP_EMAIL_REPLY_TO) and PINGPIGEON_TOKEN (to tell John when an email fails).
// Imports the site's TypeScript (lib/orders), so it needs Node >= 22.18 (type stripping).
// Exit code 1 when something failed (a Yoycol call, an email), 0 otherwise.
import fs from "node:fs";
import path from "node:path";

const { checkYoycolTracking } = await import("../lib/orders/yoycol-tracking.ts");
const { shipmentLedger } = await import("../lib/orders/shipments.ts");
const { dataDir } = await import("../lib/orders/store.ts");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (flag("--help") || flag("-h")) {
  console.log("usage: yoycol-tracking.mjs [--dry-run] [--order mop-<ref>] [--verbose] [--max-age-days N]");
  process.exit(0);
}

const env = { ...process.env, ...(flag("--dry-run") ? { MOP_EMAIL_DRY_RUN: "1" } : {}) };
const dir = dataDir(env);
const statePath = path.join(dir, "orders-state.json");
let state = null;
try {
  state = JSON.parse(fs.readFileSync(statePath, "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") {
    console.error(`[yoycol-tracking] can't read ${statePath}: ${err.message}`);
    process.exit(1);
  }
}

const maxAge = Number(opt("--max-age-days") ?? 60);
const summary = await checkYoycolTracking({
  env,
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  log: (m) => console.log(m),
  ledger: shipmentLedger(dir),
  state,
  maxAgeDays: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 60,
  onlyRef: opt("--order"),
  verbose: flag("--verbose"),
});
const sent = summary.results.filter((r) => r.status === "emailed").length;
const dry = summary.results.filter((r) => r.status === "dry_run").length;
console.log(
  `[yoycol-tracking] ${new Date().toISOString()}: checked ${summary.checked} Yoycol order(s): ` +
    `${sent} emailed${dry ? `, ${dry} dry run` : ""}, ${summary.waiting} not shipped yet, ${summary.errors} error(s)`
);
process.exitCode = summary.errors ? 1 : 0;
