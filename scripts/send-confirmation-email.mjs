#!/usr/bin/env node
// Preview or send the "thanks for your order" email for one order by hand: to
// look at it before turning it on, or when the webhook's send failed. The same
// path as the webhook (lib/orders/confirmation.ts): the order comes from
// $MOP_DATA_DIR/orders.jsonl (exact ref), the email goes to the address typed at
// checkout, and $MOP_DATA_DIR/confirmations-emailed.jsonl keeps it to one.
//
//   sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing \
//     node --env-file=/srv/mopclothing/.env /srv/mopclothing/scripts/send-confirmation-email.mjs \
//     --order-ref mop-b25662f98fbdbf6d77984351dfca --dry-run --html /tmp/confirm.html
//
//   --dry-run      print the email, send nothing (works with the email still off)
//   --html <file>  also write the HTML there, to open in a browser
//   --force        send it even though it was already emailed (refused otherwise)
//
// A real send needs MOP_CONFIRMATION_EMAIL_ENABLED=1 (the same switch as the
// webhook) and MOP_RESEND_API_KEY; PINGPIGEON_TOKEN to tell John if it fails;
// STRIPE_SECRET_KEY to show the discount code's name. Imports the site's
// TypeScript (lib/orders), so it needs Node >= 22.18.
// Exit code: 0 sent (or previewed), 1 not sent, 2 bad arguments.
import fs from "node:fs";

const { sendOrderConfirmation, confirmationEnabled, confirmationLedger } = await import("../lib/orders/confirmation.ts");
const { findOrderRecord } = await import("../lib/orders/shipments.ts");
const { isSiteRef } = await import("../lib/orders/printful-shipped.ts");
const { dataDir } = await import("../lib/orders/store.ts");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ref = opt("--order-ref");
const htmlOut = opt("--html");
if (flag("--help") || !ref || !isSiteRef(ref) || (flag("--html") && !htmlOut)) {
  console.log("usage: send-confirmation-email.mjs --order-ref mop-<ref> [--dry-run] [--force] [--html <file>]");
  process.exit(flag("--help") ? 0 : 2);
}
const dryRun = flag("--dry-run");

const dir = dataDir(process.env);
const record = findOrderRecord(dir, ref);
if (!record) {
  console.error(`No order ${ref} in ${dir}/orders.jsonl.`);
  process.exit(1);
}
if (!["paid", "no_payment_required"].includes(record.payment_status)) {
  console.error(`Order ${ref} isn't paid (payment ${record.payment_status}); not sending a confirmation.`);
  process.exit(1);
}
if (!dryRun && !confirmationEnabled(process.env)) {
  console.error("Confirmation emails are off: MOP_CONFIRMATION_EMAIL_ENABLED isn't 1. Use --dry-run to preview, or turn them on (DEPLOY.md).");
  process.exit(1);
}

// A dry run never sends (MOP_EMAIL_DRY_RUN wins over everything), so it doesn't need the switch on.
const env = { ...process.env, ...(dryRun ? { MOP_EMAIL_DRY_RUN: "1", MOP_CONFIRMATION_EMAIL_ENABLED: "1" } : {}) };
console.log(`Order ${ref}: ${record.items.length} item(s), ${record.amount_total} ${record.currency} paid, ${record.created}`);
const r = await sendOrderConfirmation(record, {
  env,
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  log: (m) => console.log(m),
  dir,
  ledger: confirmationLedger(dir),
  force: flag("--force"),
  retryNote: `run scripts/send-confirmation-email.mjs --order-ref ${ref} again once it's fixed.`,
});
if (htmlOut && r.email) {
  fs.writeFileSync(htmlOut, r.email.html);
  console.log(`HTML written to ${htmlOut}`);
}
const what =
  {
    emailed: `emailed (Resend ${r.resendId ?? ""})`,
    dry_run: "DRY RUN (printed above, not sent)",
    duplicate: "REFUSED: already emailed (confirmations-emailed.jsonl); add --force to send it again",
    in_progress: "REFUSED: another delivery is sending it right now; try again in 10 minutes",
    skipped: "NOT SENT: MOP_RESEND_API_KEY is not set",
    failed: `FAILED: ${r.error ?? ""}`,
    no_items: "NOT SENT: the order record has no items",
    disabled: "NOT SENT: confirmation emails are off",
    error: `FAILED: ${r.error ?? ""}`,
  }[r.status] ?? r.status;
console.log(`${ref}: ${what}`);
process.exitCode = r.status === "emailed" || r.status === "dry_run" ? 0 : 1;
