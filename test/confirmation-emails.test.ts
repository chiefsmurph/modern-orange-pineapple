// "Thanks for your order" emails: the email itself (every section, totals from
// the session, the discount code, the timeline per supplier and for a mixed
// order), the Stripe webhook sending it once (retries, replays, the switch, dry
// runs, failures that alert John but never fail the order), the shared look with
// the shipped email, and scripts/send-confirmation-email.mjs.
// Every name and address is made up; the products are real catalog products.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleStripeEvent } from "../lib/orders/process.ts";
import { buildItem } from "../lib/orders/build-items.ts";
import { buildOrderRecord, orderRefFor } from "../lib/orders/session.ts";
import { RESEND_URL } from "../lib/orders/customer-email.ts";
import { buildTracking } from "../lib/orders/tracking.ts";
import { shippedEmail } from "../lib/orders/shipped-email.ts";
import { displayFromRecordItem, LOGO_URL } from "../lib/orders/item-display.ts";
import { emailFooter, emailHeader, textFooter } from "../lib/orders/email-layout.ts";
import { CARE_TIPS, CONFIRMATION_SUBJECT, confirmationEmail, timeline } from "../lib/orders/confirmation-email.ts";
import {
  arrivalText,
  confirmationInput,
  createConfirmationLedger,
  deliveryFor,
  sendOrderConfirmation,
} from "../lib/orders/confirmation.ts";
import { vendorDelivery } from "../public/products.ts";
import type { OrderItem, OrderRecord } from "../lib/orders/types.ts";
import { fakeFetch, happyResponder, makeDeps, makeEvent, makeSession, readJsonl, tmpDir, type Call } from "./helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Real catalog products: a Printful Pelican Tee and the Yoycol Blue Sky Cotton Shorts.
const tee = (over: Partial<OrderItem> = {}): OrderItem => ({ ...buildItem("pelican-tee", { version: "large", style: "beanie", color: "Ivory", size: "M" }, 1, {}).item, ...over });
const shorts = (over: Partial<OrderItem> = {}): OrderItem => ({ ...buildItem("blue-sky-cotton-shorts", { size: "L" }, 1, {}).item, ...over });

const ON = { MOP_CONFIRMATION_EMAIL_ENABLED: "1", MOP_RESEND_API_KEY: "re_test_key", STRIPE_SECRET_KEY: "sk_test_unit" };

type Answer = { status: number; json?: unknown } | Error;

/** Printful, Yoycol and PingPigeon as in helpers.ts, plus Resend and Stripe's promotion codes. */
function world(opts: { resend?: (n: number, call: Call) => Answer; promo?: (call: Call) => Answer } = {}) {
  let n = 0;
  return fakeFetch((call) => {
    if (call.url === RESEND_URL) return opts.resend ? opts.resend(++n, call) : { status: 200, json: { id: `re_${++n}` } };
    if (call.url.startsWith("https://api.stripe.com/v1/promotion_codes/"))
      return opts.promo ? opts.promo(call) : { status: 200, json: { id: call.url.split("/").pop(), object: "promotion_code", code: "WELCOME10", active: true } };
    return happyResponder(call);
  });
}

const sends = (calls: Call[]) => calls.filter((c) => c.url === RESEND_URL);
const alerts = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/email"));
const confirmAlerts = (calls: Call[]) => alerts(calls).filter((c) => /order confirmation email failed/.test(c.body.subject));
const ledgerRows = (dir: string) => readJsonl(path.join(dir, "confirmations-emailed.jsonl"));

function deps(dir: string, fetch: Parameters<typeof makeDeps>[1], env: Record<string, string | undefined> = ON, extra: Parameters<typeof makeDeps>[3] = {}) {
  const debugs: string[] = [];
  const d = makeDeps(dir, fetch, env, { debug: (m) => debugs.push(m), ...extra });
  return Object.assign(d, { debugs });
}

/** The mixed order: tee + shorts, WELCOME10 (10% off), free shipping. */
const mixedSession = (over: Record<string, unknown> = {}) =>
  makeSession([tee(), shorts()], {
    amount_subtotal: 8000,
    amount_total: 7200,
    total_details: { amount_shipping: 0, amount_discount: 800, amount_tax: 0 },
    discounts: [{ coupon: "welcome10pct", promotion_code: "promo_1TestWelcome10" }],
    ...over,
  });

const recordFor = (session: ReturnType<typeof makeSession>) => buildOrderRecord(session);

// --- the email ---------------------------------------------------------------------

test("the email: greeting, thanks, timeline, items (thumbnail, name, options, qty, price), totals, order number, care, help; HTML + text", async () => {
  const record = await recordFor(makeSession([tee(), tee({ opts: { version: "large", style: "beanie", color: "Ivory", size: "L" }, qty: 2 })]));
  const email = confirmationEmail(confirmationInput(record));
  const { html, text } = email;
  const ref = orderRefFor(record.session_id);

  assert.equal(email.subject, "Thanks for your MOP order! Here's what happens next");
  assert.equal(email.subject, CONFIRMATION_SUBJECT);
  assert.ok(html.includes(`src="${LOGO_URL}"`));
  assert.match(html, /Hi Ana,/); // the shipping name, "Ana Maria Diaz"
  assert.match(html, /Thanks for your order!/);
  assert.match(html, /What happens next/);
  for (const step of ["Made just for you", "Printed &amp; packed (2–5 business days)", "Shipped, with a tracking email from us", "At your door in about 1–2 weeks"])
    assert.ok(html.includes(step), step);
  assert.doesNotMatch(html, /may arrive in separate packages/); // one supplier

  // Items: thumbnail, name, options, qty, line price (unit x qty).
  assert.match(html, /src="https:\/\/mopclothing\.com\/images\/catalog\/pelican-tee\/large-beanie-ivory-model\.[0-9a-f]+-checkout\.jpg"/);
  assert.match(html, /Big · Grind Beanie · Ivory · M/);
  assert.match(html, /Qty 1</);
  assert.match(html, /Qty 2 · \$35\.00 each/);
  assert.match(html, />\$35\.00<\/td>/);
  assert.match(html, />\$70\.00<\/td>/);
  assert.match(html, /Subtotal<\/td><td[^>]*>\$105\.00</);
  assert.match(html, /Shipping<\/td><td[^>]*>Free</);
  assert.match(html, /Total paid<\/td><td[^>]*>\$105\.00</);
  assert.doesNotMatch(html, /Discount|Tax</);

  assert.match(html, /MOP-[0-9A-F]{8}/);
  assert.ok(html.includes(ref.slice(4, 12).toUpperCase()));
  assert.match(html, /Caring for it/);
  for (const tip of CARE_TIPS) assert.ok(html.includes(tip.replace(/'/g, "&#39;")), tip);
  assert.match(html, /Thank you for supporting original art\. We hope they become favorites\./);
  assert.match(html, /Questions\? Just reply to this email\./);
  assert.match(html, /href="https:\/\/mopclothing\.com\/shipping-returns"/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.doesNotMatch(html, /<link|@import|fonts\.googleapis/);
  for (const [, src] of Array.from(html.matchAll(/<img[^>]+src="([^"]+)"/g))) assert.match(src, /^https:\/\/mopclothing\.com\//);

  assert.match(text, /^Hi Ana,\n\nThanks for your order! We've got it\. Here's what happens next\.\n\nWhat happens next:\n1\. Made just for you\n/);
  assert.match(text, /2\. Printed & packed \(2–5 business days\)\n3\. Shipped, with a tracking email from us\n4\. At your door in about 1–2 weeks/);
  assert.match(text, /Your order:\n- Pelican Tee \(Big · Grind Beanie · Ivory · M\): \$35\.00\n- 2 x Pelican Tee \(Big · Grind Beanie · Ivory · L\): \$70\.00/);
  assert.match(text, /Subtotal: \$105\.00\nShipping: Free\nTotal paid: \$105\.00/);
  assert.match(text, /Caring for it:\n- Wash cold, inside out\. Hang dry or tumble dry low\.\n- Don't iron directly on the print\./);
  assert.match(text, /Questions\? Just reply to this email\.\nHow delivery and replacements work: https:\/\/mopclothing\.com\/shipping-returns/);
  assert.match(text, new RegExp(`Order ref: ${ref}$`));
});

test("names and item text are escaped; no name = 'Hi there'; a hat-only order gets no washing tips", async () => {
  const record = await recordFor(makeSession([tee()]));
  record.customer.name = `<img src=x onerror=alert(1)> Doe`;
  record.items[0].title = `Tee "<b>"`;
  const { html } = confirmationEmail(confirmationInput(record));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Tee &quot;&lt;b&gt;&quot;/);
  record.customer.name = "";
  assert.match(confirmationEmail(confirmationInput(record)).text, /^Hi there,/);

  const hat = await recordFor(makeSession([{ ...buildItem("star-snapback", { color: "Navy" }, 1, {}).item }]));
  const hatEmail = confirmationEmail(confirmationInput(hat));
  assert.match(hatEmail.html, /Star Snapback/);
  assert.doesNotMatch(hatEmail.html, /Caring for it|Wash cold/);
});

// --- totals ------------------------------------------------------------------------

test("totals are the session's own: subtotal, discount, shipping, tax and the total paid", async () => {
  // Odd numbers on purpose: the email shows what Stripe charged, it doesn't add anything up.
  const record = await recordFor(
    makeSession([tee(), shorts()], {
      amount_subtotal: 8000,
      amount_total: 10354,
      total_details: { amount_shipping: 399, amount_discount: 0, amount_tax: 1955 },
    })
  );
  const { html, text } = confirmationEmail(confirmationInput(record));
  assert.match(text, /Subtotal: \$80\.00\nShipping: \$3\.99\nTax: \$19\.55\nTotal paid: \$103\.54/);
  assert.match(html, /Total paid<\/td><td[^>]*>\$103\.54</);
  assert.match(html, /Tax<\/td><td[^>]*>\$19\.55</);
  assert.match(html, />\$35\.00<\/td>/);
  assert.match(html, />\$45\.00<\/td>/);

  // Items that don't add up to the session's subtotal: no per-line prices, only the session's totals.
  const off = await recordFor(makeSession([tee(), shorts()], { amount_subtotal: 6500, amount_total: 6500 }));
  const input = confirmationInput(off);
  assert.equal(input.linePricesShown, false);
  const e = confirmationEmail(input);
  assert.doesNotMatch(e.html, />\$35\.00<\/td>|>\$45\.00<\/td>/);
  assert.match(e.text, /- Pelican Tee \(Big · Grind Beanie · Ivory · M\)\n- Blue Sky Cotton Shorts \(L\)\n/);
  assert.match(e.text, /Subtotal: \$65\.00\nShipping: Free\nTotal paid: \$65\.00/);
});

test("a discount: the line names the code (looked up from the session's promotion code id); unreadable = plain 'Discount'", async () => {
  const dir = tmpDir();
  const { fetch, calls } = world();
  const d = deps(dir, fetch);
  const record = await recordFor(mixedSession());
  assert.deepEqual(record.discounts, [{ promotion_code: "promo_1TestWelcome10", coupon: "welcome10pct" }]);
  const r = await sendOrderConfirmation(record, { ...d, dir });
  assert.equal(r.status, "emailed");
  const promo = calls.find((c) => c.url.startsWith("https://api.stripe.com"))!;
  assert.equal(promo.url, "https://api.stripe.com/v1/promotion_codes/promo_1TestWelcome10");
  assert.equal(promo.method, "GET");
  assert.equal(promo.headers.Authorization, "Bearer sk_test_unit");
  const [send] = sends(calls);
  assert.match(send.body.text, /Subtotal: \$80\.00\nDiscount \(WELCOME10\): -\$8\.00\nShipping: Free\nTotal paid: \$72\.00/);
  assert.match(send.body.html, /Discount \(WELCOME10\)<\/td><td[^>]*>&minus;\$8\.00</);

  // Stripe sent the promotion code expanded: no lookup.
  const expanded = await recordFor(mixedSession({ discounts: [{ coupon: { id: "c1" }, promotion_code: { id: "promo_X", code: "THANKS10" } }] }));
  const w2 = world();
  await sendOrderConfirmation(expanded, { ...deps(tmpDir(), w2.fetch), dir: tmpDir() });
  assert.equal(w2.calls.filter((c) => c.url.startsWith("https://api.stripe.com")).length, 0);
  assert.match(sends(w2.calls)[0].body.text, /Discount \(THANKS10\): -\$8\.00/);

  // The key can't read promotion codes: still sent, "Discount" without a name.
  const w3 = world({ promo: () => ({ status: 403, json: { error: { message: "The provided key does not have the required permissions" } } }) });
  const d3 = deps(tmpDir(), w3.fetch);
  const r3 = await sendOrderConfirmation(record, { ...d3, dir: tmpDir() });
  assert.equal(r3.status, "emailed");
  assert.match(sends(w3.calls)[0].body.text, /\nDiscount: -\$8\.00\n/);
  assert.match(d3.logs.join("\n"), /promotion code promo_1TestWelcome10: HTTP 403: The provided key does not have the required permissions; the email shows "Discount" without the code/);
  assert.doesNotMatch(d3.logs.join("\n"), /sk_test_unit/);

  // No discount: no line, no lookup.
  const plain = world();
  await sendOrderConfirmation(await recordFor(makeSession([tee()])), { ...deps(tmpDir(), plain.fetch), dir: tmpDir() });
  assert.doesNotMatch(sends(plain.calls)[0].body.text, /Discount/);
  assert.equal(plain.calls.filter((c) => c.url.startsWith("https://api.stripe.com")).length, 0);
});

// --- the timeline -----------------------------------------------------------------

test("timeline: each item's own delivery estimate (Printful 1–2 weeks, Yoycol 3–4 weeks); a mixed order may ship separately", async () => {
  assert.equal(arrivalText(vendorDelivery.printful), "about 1–2 weeks");
  assert.equal(arrivalText(vendorDelivery.yoycol), "about 3–4 weeks");
  assert.equal(arrivalText({ text: "Something else", minBusinessDays: 5, maxBusinessDays: 9, production: "x" }), "5–9 business days");
  assert.equal(deliveryFor(tee()), vendorDelivery.printful);
  assert.equal(deliveryFor(shorts()), vendorDelivery.yoycol);
  assert.equal(deliveryFor({ slug: "clouds-skater-dress", supplier: "manual" }), vendorDelivery.printful); // older product, placed by hand

  const steps = (items: OrderItem[]) => timeline(confirmationInput({ ...baseRecord, items, amount_subtotal: items.reduce((n, i) => n + i.unitAmount * i.qty, 0) }).items);
  const baseRecord = await recordFor(makeSession([tee()]));

  assert.deepEqual(steps([tee()]).map((s) => s.title), ["Made just for you", "Printed & packed (2–5 business days)", "Shipped, with a tracking email from us", "At your door in about 1–2 weeks"]);
  assert.deepEqual(steps([shorts()]).map((s) => s.title), ["Made just for you", "Printed & packed (about 10–12 days)", "Shipped, with a tracking email from us", "At your door in about 3–4 weeks"]);

  const mixed = steps([tee(), shorts()]);
  assert.deepEqual(mixed.map((s) => s.title), ["Made just for you", "Printed & packed", "Shipped, with a tracking email from us", "At your door"]);
  assert.deepEqual(mixed[1].detail, ["Pelican Tee: 2–5 business days", "Blue Sky Cotton Shorts: about 10–12 days"]);
  assert.deepEqual(mixed[3].detail, ["Pelican Tee: about 1–2 weeks", "Blue Sky Cotton Shorts: about 3–4 weeks"]);
  assert.match(mixed[2].detail.join(" "), /may arrive in separate packages, each with its own tracking email/);

  // Same times from two supplier orders (a by-hand Printful item): may ship separately, one estimate.
  const twoOrders = steps([tee(), { slug: "clouds-skater-dress", title: "All‑Over Clouds Skater Dress", supplier: "manual", qty: 1, opts: { size: "M" }, unitAmount: 5500 }]);
  assert.equal(twoOrders[3].title, "At your door in about 1–2 weeks");
  assert.match(twoOrders[2].detail.join(" "), /separate packages/);

  const e = confirmationEmail(confirmationInput(await recordFor(mixedSession())));
  assert.match(e.text, /2\. Printed & packed\n   Pelican Tee: 2–5 business days\n   Blue Sky Cotton Shorts: about 10–12 days\n3\. Shipped, with a tracking email from us\n   Your pieces are made by different print partners/);
  assert.match(e.text, /4\. At your door\n   Pelican Tee: about 1–2 weeks\n   Blue Sky Cotton Shorts: about 3–4 weeks/);
  assert.match(e.html, /Blue Sky Cotton Shorts: <span style="white-space:nowrap;">about 3–4 weeks<\/span>/); // never split on a phone
  assert.match(e.html, /src="https:\/\/mopclothing\.com\/images\/blue-sky-cotton-shorts\/worn-front-shorts-crop-v2\.webp"/);
  assert.match(e.preheader, /your pieces may ship separately/);
});

// --- the webhook ---------------------------------------------------------------------

test("the webhook sends it once, after the order is recorded and the supplier orders are placed", async () => {
  const dir = tmpDir();
  const { fetch, calls } = world();
  const d = deps(dir, fetch);
  const session = mixedSession();
  const ref = orderRefFor(session.id);
  const res = await handleStripeEvent(makeEvent(session), d);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "done");

  const order = calls.map((c) => (c.url === RESEND_URL ? "resend" : c.url.includes("printful") ? "printful" : c.url.includes("yoycol") ? "yoycol" : c.url.endsWith("/email") ? "john" : "stripe"));
  assert.deepEqual(order, ["printful", "yoycol", "john", "stripe", "resend"]);
  const [send] = sends(calls);
  assert.deepEqual(send.body.to, ["ana@example.com"]); // the Stripe session's customer_details.email, as in our record
  assert.equal(readJsonl(path.join(dir, "orders.jsonl"))[0].customer.email, "ana@example.com");
  assert.equal(send.body.from, "MOP Clothing <orders@mopclothing.com>");
  assert.equal(send.body.reply_to, "orders@mopclothing.com");
  assert.equal(send.body.subject, CONFIRMATION_SUBJECT);
  assert.equal(send.headers["Idempotency-Key"], `mop-confirmation/${ref}`);
  assert.equal(send.headers.Authorization, "Bearer re_test_key");
  assert.match(send.body.text, /^Hi Ana,/);

  const rows = ledgerRows(dir);
  assert.deepEqual(rows.map((r) => r.status), ["sending", "emailed"]);
  assert.equal(rows[1].key, ref);
  assert.equal(rows[1].to, "ana@example.com");
  assert.equal(rows[1].total, 7200);
  assert.equal(rows[1].resend_id, "re_1");
  assert.match(d.logs.join("\n"), new RegExp(`\\[confirm\\] ${ref}: confirmation email sent to a\\*\\*\\*@example\\.com, Resend re_1`));
});

test("Stripe's retries and replays never send it twice (repeat, async success, resumed run, fresh process)", async () => {
  const dir = tmpDir();
  const { fetch, calls } = world();
  const d = deps(dir, fetch);
  const session = mixedSession();
  await handleStripeEvent(makeEvent(session), d);
  assert.equal(sends(calls).length, 1);

  assert.equal((await handleStripeEvent(makeEvent(session), d)).body.duplicate, true);
  assert.equal((await handleStripeEvent(makeEvent(session, "checkout.session.async_payment_succeeded"), d)).body.duplicate, true);

  // A run that crashed after the email (state left in "error") is resumed by Stripe's retry: nothing is re-sent.
  await d.store.update(session.id, d.now(), (e) => {
    e.status = "error";
  });
  const resumed = await handleStripeEvent(makeEvent(session), { ...d, confirmations: createConfirmationLedger(dir) });
  assert.equal(resumed.status, 200);
  assert.equal(sends(calls).length, 1);
  assert.match(d.logs.join("\n"), /already emailed, not sending again/);
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.printful.com")).length, 1); // suppliers weren't re-ordered either
  assert.equal(ledgerRows(dir).filter((r) => r.status === "emailed").length, 1);
});

test("a send abandoned mid-way (crash) is resumed on Stripe's retry with the same idempotency key", async () => {
  const dir = tmpDir();
  const session = mixedSession();
  const ref = orderRefFor(session.id);
  const ledger = createConfirmationLedger(dir);
  await ledger.claim({ key: ref, order_ref: ref, session_id: session.id }, new Date("2026-10-12T17:40:00Z")); // 20 minutes before "now"
  const { fetch, calls } = world();
  const d = deps(dir, fetch, ON, { confirmations: ledger });
  await handleStripeEvent(makeEvent(session), d);
  assert.equal(sends(calls).length, 1);
  assert.equal(sends(calls)[0].headers["Idempotency-Key"], `mop-confirmation/${ref}`);
  assert.match(d.logs.join("\n"), /stopped mid-send/);
});

test("off by default: nothing sent, nothing in the ledger, one debug line with the subject and only the address's domain", async () => {
  for (const env of [{ MOP_RESEND_API_KEY: "re_test_key" }, { MOP_RESEND_API_KEY: "re_test_key", MOP_CONFIRMATION_EMAIL_ENABLED: "0" }, { MOP_RESEND_API_KEY: "re_test_key", MOP_CONFIRMATION_EMAIL_ENABLED: "true" }]) {
    const dir = tmpDir();
    const { fetch, calls } = world();
    const d = deps(dir, fetch, env);
    const res = await handleStripeEvent(makeEvent(mixedSession()), d);
    assert.equal(res.body.status, "done");
    assert.equal(sends(calls).length, 0);
    assert.equal(calls.filter((c) => c.url.startsWith("https://api.stripe.com")).length, 0);
    assert.equal(existsSync(path.join(dir, "confirmations-emailed.jsonl")), false);
    assert.equal(d.debugs.length, 1);
    assert.match(d.debugs[0], /confirmation email is off \(MOP_CONFIRMATION_EMAIL_ENABLED is not 1\); would have sent "Thanks for your MOP order! Here's what happens next" to an address at example\.com/);
    assert.doesNotMatch(d.debugs.join("\n") + d.logs.join("\n"), /ana@|ana\*/);
  }
});

test("MOP_EMAIL_DRY_RUN=1 logs the email and sends nothing (not marked emailed); ORDER_DRY_RUN=1 does the same", async () => {
  const dir = tmpDir();
  const { fetch, calls } = world();
  const d = deps(dir, fetch, { ...ON, MOP_EMAIL_DRY_RUN: "1" });
  const res = await handleStripeEvent(makeEvent(mixedSession()), d);
  assert.equal(res.status, 200);
  assert.equal(sends(calls).length, 0);
  const log = d.logs.join("\n");
  assert.match(log, /\[confirm\] DRY-RUN customer email \(not sent\)\nFrom: MOP Clothing <orders@mopclothing\.com>\nTo: ana@example\.com\nReply-To: orders@mopclothing\.com\nSubject: Thanks for your MOP order! Here's what happens next/);
  assert.match(log, /Discount \(WELCOME10\): -\$8\.00/);
  assert.doesNotMatch(log, /re_test_key|sk_test_unit/);
  assert.deepEqual(ledgerRows(dir).map((r) => r.status), ["sending", "dry_run"]);
  // Not done: the same order can still be sent for real later (the by-hand script).
  const r = await sendOrderConfirmation(readJsonl(path.join(dir, "orders.jsonl"))[0], { ...deps(dir, fetch), dir });
  assert.equal(r.status, "emailed");

  const dir2 = tmpDir();
  const w2 = world();
  const d2 = deps(dir2, w2.fetch, { ...ON, ORDER_DRY_RUN: "1" });
  await handleStripeEvent(makeEvent(mixedSession()), d2);
  assert.equal(sends(w2.calls).length, 0);
  assert.match(d2.logs.join("\n"), /\[confirm\] DRY-RUN customer email \(not sent\)/);
});

test("a failed send never fails the webhook: 200, suppliers placed, John told once, and it can be resent by hand", async () => {
  const dir = tmpDir();
  let down = true;
  const { fetch, calls } = world({ resend: (n) => (down ? { status: 503, json: { statusCode: 503, message: "Service unavailable", name: "application_error" } } : { status: 200, json: { id: `re_${n}` } }) });
  const d = deps(dir, fetch);
  const session = mixedSession();
  const ref = orderRefFor(session.id);
  const res = await handleStripeEvent(makeEvent(session), d);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "done");
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.printful.com")).length, 1);
  assert.equal(calls.filter((c) => c.url.startsWith("https://www.yoycol.com")).length, 1);
  assert.equal(sends(calls).length, 2); // retried once
  const [alert] = confirmAlerts(calls);
  assert.equal(confirmAlerts(calls).length, 1);
  assert.equal(alert.url, "http://127.0.0.1:3141/email"); // PingPigeon, like every alert to John
  assert.equal(alert.body.subject, `ACTION NEEDED: order confirmation email failed for ${ref}`);
  assert.match(alert.body.body, /Why: Resend HTTP 503: Service unavailable/);
  assert.match(alert.body.body, /To: ana@example\.com \(from the Stripe checkout\)/);
  assert.match(alert.body.body, /\$72\.00 paid/);
  assert.match(alert.body.body, new RegExp(`scripts/send-confirmation-email\\.mjs --order-ref ${ref}`));
  assert.match(d.logs.join("\n"), /CONFIRMATION EMAIL FAILED/);
  assert.deepEqual(ledgerRows(dir).map((r) => r.status), ["sending", "failed"]);

  // Resend is back: the by-hand path sends it, with a fresh idempotency key.
  down = false;
  const again = await sendOrderConfirmation(readJsonl(path.join(dir, "orders.jsonl"))[0], { ...d, dir });
  assert.equal(again.status, "emailed");
  assert.equal(sends(calls).at(-1)!.headers["Idempotency-Key"], `mop-confirmation/${ref}/retry-1`);
  assert.equal(confirmAlerts(calls).length, 1);
});

test("a network error, no customer address, or an unwritable ledger: still 200 and John is told", async () => {
  const net = world({ resend: () => new Error("getaddrinfo ENOTFOUND api.resend.com") });
  const r1 = await handleStripeEvent(makeEvent(mixedSession()), deps(tmpDir(), net.fetch));
  assert.equal(r1.status, 200);
  assert.equal(r1.body.status, "done");
  assert.match(confirmAlerts(net.calls)[0].body.body, /ENOTFOUND/);

  const noAddr = world();
  const r2 = await handleStripeEvent(makeEvent(mixedSession({ customer_details: { name: "Ana Diaz", email: "", phone: "+13105550100", address: {} } })), deps(tmpDir(), noAddr.fetch));
  assert.equal(r2.status, 200);
  assert.equal(sends(noAddr.calls).length, 0);
  assert.match(confirmAlerts(noAddr.calls)[0].body.body, /no customer email address on the order/);

  const broken = world();
  const ledger = createConfirmationLedger(tmpDir());
  ledger.claim = async () => {
    throw new Error("EACCES: permission denied, open '/var/lib/mopclothing/confirmations-emailed.jsonl'");
  };
  const d3 = deps(tmpDir(), broken.fetch, ON, { confirmations: ledger });
  const r3 = await handleStripeEvent(makeEvent(mixedSession()), d3);
  assert.equal(r3.status, 200);
  assert.equal(r3.body.status, "done");
  assert.equal(sends(broken.calls).length, 0); // no ledger, no send (it couldn't be kept to one)
  assert.match(confirmAlerts(broken.calls)[0].body.body, /EACCES/);
  assert.match(d3.logs.join("\n"), /CONFIRMATION EMAIL ERROR \(nothing sent\)/);

  // No Resend key: logged and skipped, like the shipped email; the order is unaffected.
  const noKey = world();
  const d4 = deps(tmpDir(), noKey.fetch, { MOP_CONFIRMATION_EMAIL_ENABLED: "1" });
  assert.equal((await handleStripeEvent(makeEvent(mixedSession()), d4)).body.status, "done");
  assert.equal(confirmAlerts(noKey.calls).length, 0);
  assert.match(d4.logs.join("\n"), /MOP_RESEND_API_KEY is not set: confirmation email NOT sent/);
});

test("a slow send doesn't hold the webhook: it answers after the budget and the email still goes out once", async () => {
  const dir = tmpDir();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { fetch, calls } = world();
  const slow = async (url: string, init?: RequestInit) => {
    if (url === RESEND_URL) await gate;
    return fetch(url, init);
  };
  const d = deps(dir, slow, ON, { confirmationBudgetMs: 20 });
  const res = await handleStripeEvent(makeEvent(mixedSession()), d);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "done");
  assert.match(d.logs.join("\n"), /still sending after 20 ms; answering Stripe now/);
  assert.deepEqual(ledgerRows(dir).map((r) => r.status), ["sending"]);
  release();
  for (let i = 0; i < 50 && ledgerRows(dir).length < 2; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(ledgerRows(dir).map((r) => r.status), ["sending", "emailed"]);
  assert.equal(sends(calls).length, 1);
});

test("an order whose items couldn't be read gets no confirmation (John's email already says ACTION NEEDED)", async () => {
  const { fetch, calls } = world();
  const d = deps(tmpDir(), fetch, ON, { listLineItems: async () => [] });
  const res = await handleStripeEvent(makeEvent(makeSession([], { metadata: {} })), d);
  assert.equal(res.status, 200);
  assert.equal(sends(calls).length, 0);
  assert.match(d.logs.join("\n"), /no items on the order record; confirmation email not sent/);
});

// --- one set with the shipped email -------------------------------------------------------

test("the confirmation and the shipped email share the same head, header band and footer", async () => {
  const record = await recordFor(mixedSession());
  const ref = record.order_ref;
  const conf = confirmationEmail(confirmationInput(record, ["WELCOME10"]));
  const ship = shippedEmail({
    name: record.customer.name,
    orderRef: ref,
    kind: "part",
    shipDate: "2026-10-16",
    tracking: buildTracking({ number: "9400111899223817364905", carrier: "USPS" }),
    items: record.items.filter((i) => i.supplier === "printful").map((i) => displayFromRecordItem(i)),
  });
  const head = (h: string) => h.slice(0, h.indexOf("</head>")).replace(/<title>[^<]*<\/title>/, "");
  const band = (h: string) => h.slice(h.indexOf("</head>"), h.indexOf('<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:0 0 18px 18px;')).replace(/(mso-hide:all[^>]*>)[^&]*/, "$1");
  const foot = (h: string) => h.slice(h.lastIndexOf("\n</table>\n</td></tr>\n\n<tr><td align=\"center\""));
  assert.equal(head(conf.html), head(ship.html));
  assert.equal(band(conf.html), band(ship.html));
  assert.equal(foot(conf.html), foot(ship.html));
  assert.ok(foot(conf.html).includes(`Ref ${ref}`));
  for (const h of [conf.html, ship.html]) {
    assert.ok(h.includes(emailHeader()));
    assert.ok(h.includes(emailFooter(ref)));
  }
  assert.ok(conf.text.endsWith(textFooter(ref).join("\n")));
  assert.ok(ship.text.endsWith(textFooter(ref).join("\n")));
  // The same order number and item rows (thumbnail tile, name, options) in both.
  assert.match(conf.html, /Order <b[^>]*>MOP-[0-9A-F]{8}<\/b>/);
  assert.equal(conf.html.match(/Order <b[^>]*>(MOP-[0-9A-F]{8})/)![1], ship.html.match(/Order <b[^>]*>(MOP-[0-9A-F]{8})/)![1]);
  const teeImg = /<img src="https:\/\/mopclothing\.com\/images\/catalog\/pelican-tee\/[^"]+" width="72" height="72" alt="Pelican Tee" style="[^"]+" class="mop-tile">/;
  assert.equal(conf.html.match(teeImg)![0], ship.html.match(teeImg)![0]);
});

// --- the script ------------------------------------------------------------------------------

test("scripts/send-confirmation-email.mjs: arguments, a preview with the email off, refuses a resend without --force", () => {
  const dir = tmpDir();
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(ROOT, "scripts", "send-confirmation-email.mjs"), ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", MOP_DATA_DIR: dir } as unknown as NodeJS.ProcessEnv,
    });
  const help = run("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--order-ref mop-<ref> \[--dry-run\] \[--force\] \[--html <file>\]/);
  assert.equal(run().status, 2);
  assert.equal(run("--order-ref", "abc").status, 2);

  const ref = "mop-b25662f98fbdbf6d77984351dfca";
  const missing = run("--order-ref", ref, "--dry-run");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No order mop-b25662f98fbdbf6d77984351dfca/);

  const record = JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/shipping/order-record-mop-b25662f9.json"), "utf8")) as OrderRecord & { type: string };
  writeFileSync(path.join(dir, "orders.jsonl"), JSON.stringify(record) + "\n");
  const htmlFile = path.join(dir, "preview.html");
  const dry = run("--order-ref", ref, "--dry-run", "--html", htmlFile);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /DRY-RUN customer email \(not sent\)[\s\S]*To: jordan\.sample@example\.com[\s\S]*Subject: Thanks for your MOP order! Here's what happens next/);
  assert.match(dry.stdout, /- Pelican Tee \(Big · Grind Beanie · Ivory · M\): \$29\.00\n- Alpaca Tee \(Big · Blue Jean · L\): \$29\.00\n- Day · Pelican All-Over \(Grind Beanie · M\): \$44\.00/);
  assert.match(dry.stdout, /Total paid: \$102\.00/);
  assert.match(dry.stdout, /DRY RUN \(printed above, not sent\)/);
  assert.match(readFileSync(htmlFile, "utf8"), /What happens next/);

  const off = run("--order-ref", ref);
  assert.equal(off.status, 1);
  assert.match(off.stderr, /Confirmation emails are off: MOP_CONFIRMATION_EMAIL_ENABLED isn't 1/);

  // Already emailed: refused, unless --force.
  writeFileSync(path.join(dir, "confirmations-emailed.jsonl"), JSON.stringify({ at: "2026-10-13T18:27:00.000Z", status: "emailed", key: ref, order_ref: ref, session_id: record.session_id }) + "\n");
  const refused = run("--order-ref", ref, "--dry-run");
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /REFUSED: already emailed \(confirmations-emailed\.jsonl\); add --force to send it again/);
  const forced = run("--order-ref", ref, "--dry-run", "--force");
  assert.equal(forced.status, 0, forced.stdout);
  assert.match(forced.stdout, /already emailed 1 time\(s\); sending again because it was forced/);
  assert.equal(readJsonl(path.join(dir, "confirmations-emailed.jsonl")).at(-1).forced, true);
});
