#!/usr/bin/env node
// End-to-end dry run of the Stripe webhook against a LOCAL server. Nothing real
// happens: the server must run with ORDER_DRY_RUN=1, which logs the exact
// Printful / Yoycol / email payloads instead of sending them.
//
//   npm run build
//   STRIPE_SECRET_KEY=sk_test_unused ORDER_DRY_RUN=1 STRIPE_WEBHOOK_SECRET=whsec_local_dry_run \
//     MOP_DATA_DIR=/tmp/mop-dry-run npx next start -p 3100
//   node scripts/webhook-dry-run.mjs http://127.0.0.1:3100/api/stripe-webhook
//
// It signs a fake checkout.session.completed (built with the same code the
// checkout route uses) with the local secret and posts it three times:
//   1. the real delivery           -> 200, order recorded, payloads in the server log
//   2. the same event again         -> 200 duplicate (idempotent)
//   3. a tampered copy              -> 400 (signature)
// Needs Node >= 22.18 (it imports the TypeScript order code directly).
import Stripe from "stripe";
import { buildItem } from "../lib/orders/build-items.ts";
import { sessionMetadata } from "../lib/orders/metadata.ts";
import { catalogProducts } from "../lib/catalog/products.generated.ts";

const url = process.argv[2] ?? "http://127.0.0.1:3100/api/stripe-webhook";
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`refusing to post to ${host}: local servers only`);
  process.exit(2);
}
const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_local_dry_run";

// One Printful line-up item (a Grind Beanie one if there is one), plus the
// Yoycol clouds tee, as separate sessions so each supplier path shows up.
const pick = () => {
  const p = catalogProducts.find((x) => x.options.style?.includes("beanie")) ?? catalogProducts[0];
  if (!p) return null;
  const v = p.variants.find((x) => x.opts.style === "beanie") ?? p.variants[0];
  return buildItem(p.slug, v.opts, 1, {}).item;
};
const scenarios = [
  ["printful", pick()],
  ["yoycol", buildItem("clouds-in-sky-shirt", { size: "L" }, 1, {}).item],
].filter(([, item]) => item);

let n = 0;
const sessionFor = (item) => {
  n += 1;
  const id = `cs_test_dryrun_${Date.now()}_${n}_${"x".repeat(30)}`;
  return {
    id,
    object: "checkout.session",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    payment_status: "paid",
    payment_intent: `pi_test_dryrun_${n}`,
    currency: "usd",
    amount_total: item.unitAmount * item.qty,
    amount_subtotal: item.unitAmount * item.qty,
    total_details: { amount_shipping: 0, amount_discount: 0, amount_tax: 0 },
    metadata: sessionMetadata([item]),
    customer_details: {
      name: "Dry Run Customer",
      email: "dry-run@example.com",
      phone: "+13105550100",
      address: { line1: "123 Main St", city: "Los Angeles", state: "CA", postal_code: "90026", country: "US" },
    },
    collected_information: {
      shipping_details: {
        name: "Dry Run Customer",
        address: { line1: "123 Main St", line2: "Apt 4", city: "Los Angeles", state: "CA", postal_code: "90026", country: "US" },
      },
    },
  };
};

const post = async (payload, header) => {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
  return `${r.status} ${await r.text()}`;
};

let failed = false;
const expect = (label, got, re) => {
  const ok = re.test(got);
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${got}`);
};

for (const [name, item] of scenarios) {
  const event = {
    id: `evt_dryrun_${Date.now()}_${name}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: sessionFor(item) },
  };
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  console.log(`\n== ${name}: ${item.title} (${Object.values(item.opts).join(" / ")})`);
  expect("delivery", await post(payload, header), /^200 .*"status":"done"/);
  expect("repeat", await post(payload, header), /^200 .*"duplicate":true/);
  expect("tampered", await post(payload.replace('"paid"', '"PAID"'), header), /^400 /);
}
console.log(failed ? "\nSOME CHECKS FAILED" : "\nall checks passed; the payloads are in the server log");
process.exit(failed ? 1 : 0);
