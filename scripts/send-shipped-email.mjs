#!/usr/bin/env node
// Send the "your order has shipped" email for one Printful order by hand: for
// orders that shipped before the webhook existed, or when the webhook's email
// failed. The same path as the webhook (lib/orders/printful-shipped.ts): the
// order is re-fetched from Printful, the customer comes from orders.jsonl (exact
// ref) or else the Printful order's recipient, one email per shipment, and every
// shipment already in $MOP_DATA_DIR/shipments-emailed.jsonl is refused.
//
//   sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing \
//     node --env-file=/srv/mopclothing/.env /srv/mopclothing/scripts/send-shipped-email.mjs \
//     --printful-order 180742757 --dry-run          # prints the email(s); then again without --dry-run
//
// Unlike the webhook, there's no age limit on the shipments. Needs PRINTFUL_API_TOKEN
// (+ PRINTFUL_STORE_ID if the token is account-wide), MOP_RESEND_API_KEY, PINGPIGEON_TOKEN.
// Imports the site's TypeScript (lib/orders), so it needs Node >= 22.18.
// Exit code 1 when nothing could be sent (or something failed).
const { emailPrintfulShipments, fetchPrintfulOrder } = await import("../lib/orders/printful-shipped.ts");
const { shipmentLedger } = await import("../lib/orders/shipments.ts");
const { dataDir } = await import("../lib/orders/store.ts");

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const orderId = opt("--printful-order");
if (args.includes("--help") || !orderId || !/^\d{1,15}$/.test(orderId)) {
  console.log("usage: send-shipped-email.mjs --printful-order <Printful order id> [--dry-run]");
  process.exit(args.includes("--help") ? 0 : 2);
}

const env = { ...process.env, ...(args.includes("--dry-run") ? { MOP_EMAIL_DRY_RUN: "1" } : {}) };
const dir = dataDir(env);
const deps = {
  env,
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  log: (m) => console.log(m),
  dir,
  ledger: shipmentLedger(dir),
};

const fetched = await fetchPrintfulOrder(orderId, deps);
if (!fetched.ok) {
  console.error(`Couldn't read Printful order ${orderId}: ${fetched.error}`);
  process.exit(1);
}
const o = fetched.order;
console.log(`Printful order ${o.id} (${o.status}), external_id ${o.external_id}, ${(o.shipments ?? []).length} shipment(s)`);
const { ref, source, results, ignored } = await emailPrintfulShipments(o, deps, {
  retryNote: `run scripts/send-shipped-email.mjs --printful-order ${orderId} again once it's fixed.`,
});
if (ignored) {
  console.error(`Not sent: ${ignored}.`);
  process.exit(1);
}
console.log(`Customer from: ${source === "order_record" ? "our order record (orders.jsonl)" : "the Printful order's recipient"}`);
for (const r of results) {
  const what = {
    emailed: "emailed",
    dry_run: "DRY RUN (logged above, not sent)",
    duplicate: "REFUSED: already emailed (shipments-emailed.jsonl)",
    in_progress: "REFUSED: another delivery is sending it right now",
    skipped: "NOT SENT: MOP_RESEND_API_KEY is not set",
    failed: `FAILED: ${r.error ?? ""}`,
  }[r.status] ?? r.status;
  console.log(`  ${r.key}: ${what}`);
}
if (!results.length) console.log("  (no shipments on this order yet)");
process.exitCode = results.some((r) => r.status === "emailed" || r.status === "dry_run") && !results.some((r) => r.status === "failed") ? 0 : 1;
console.log(`Order ref ${ref}.`);
