// "Your order has shipped" emails: the Printful webhook (token, re-fetch, who gets
// it, one email per box), the Yoycol tracking check, tracking links, the Resend
// send (dry run, missing key, failures that alert John) and the email itself.
//
// Fixtures (test/fixtures/shipping): every name, email and address is made up.
// printful-order-180742757.json is shaped like the site's first order (3 items,
// one DHL GlobalMail box, external_id mop-b25662f98fbdbf6d77984351dfca); the
// Yoycol tracking responses are built from Yoycol's OpenAPI schema, not captured.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlePrintfulWebhook, emailPrintfulShipments, tokenMatches, type PrintfulShippedDeps } from "../lib/orders/printful-shipped.ts";
import { createShipmentLedger } from "../lib/orders/shipments.ts";
import { RESEND_URL } from "../lib/orders/customer-email.ts";
import { buildTracking } from "../lib/orders/tracking.ts";
import { checkYoycolTracking, parseYoycolTracking } from "../lib/orders/yoycol-tracking.ts";
import { firstName, shippedEmail, shortOrderNumber } from "../lib/orders/shipped-email.ts";
import { LOGO_URL } from "../lib/orders/item-display.ts";
import { fakeFetch, readJsonl, tmpDir, type Call } from "./helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/shipping", name), "utf8"));

const TOKEN = "pfwh_test_0123456789abcdef0123456789abcdef";
const FIRST_REF = "mop-b25662f98fbdbf6d77984351dfca";
const firstOrder = () => fixture("printful-order-180742757.json").result;
const firstRecord = () => fixture("order-record-mop-b25662f9.json");
const shippedEvent = (orderId: number | string = 180742757, shipmentId: number | string = 61000001, over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...fixture("printful-package-shipped.json"), ...over, data: { ...fixture("printful-package-shipped.json").data, order: { id: orderId }, shipment: { id: shipmentId } } });

type Answer = { status: number; json?: unknown } | Error;

/** Printful (orders by id), Resend, PingPigeon and Yoycol (tracking by order id). */
function world(opts: { orders?: Record<string, any>; resend?: (n: number, call: Call) => Answer; printful?: (call: Call) => Answer | undefined; yoycol?: Record<string, unknown> } = {}) {
  let resendN = 0;
  return fakeFetch((call) => {
    if (call.url.startsWith("https://api.printful.com/orders/")) {
      const custom = opts.printful?.(call);
      if (custom) return custom;
      const order = opts.orders?.[decodeURIComponent(call.url.split("/orders/")[1])];
      return order ? { status: 200, json: { code: 200, result: order } } : { status: 404, json: { code: 404, result: "Not Found", error: { message: "Not Found" } } };
    }
    if (call.url === RESEND_URL) return opts.resend ? opts.resend(++resendN, call) : { status: 200, json: { id: `re_${++resendN}` } };
    if (call.url.endsWith("/email")) return { status: 200, json: { ok: true } };
    const y = /^https:\/\/www\.yoycol\.com\/api\/2025\/open\/v4\/orders\/(\d+)\/tracking$/.exec(call.url);
    if (y) return { status: 200, json: opts.yoycol?.[y[1]] ?? fixture("yoycol-tracking-pending.json") };
    return { status: 404, json: { error: "unexpected" } };
  });
}

function deps(dir: string, fetch: PrintfulShippedDeps["fetch"], env: Record<string, string | undefined> = {}) {
  const logs: string[] = [];
  return {
    env: {
      PRINTFUL_API_TOKEN: "pf_test_token",
      PRINTFUL_WEBHOOK_TOKEN: TOKEN,
      MOP_RESEND_API_KEY: "re_test_key",
      PINGPIGEON_TOKEN: "pp_test_token",
      YOYCOL_ACCESS_KEY: "AK_TEST",
      YOYCOL_SECRET_KEY: "SK_TEST",
      ...env,
    },
    fetch,
    now: () => new Date("2026-10-17T18:00:00Z"),
    log: (m: string) => logs.push(m),
    dir,
    ledger: createShipmentLedger(dir),
    retryDelayMs: 0,
    logs,
  };
}

const withRecords = (dir: string, ...records: unknown[]) => {
  writeFileSync(path.join(dir, "orders.jsonl"), records.map((r) => JSON.stringify(r) + "\n").join(""));
  return dir;
};
const ledgerRows = (dir: string) => readJsonl(path.join(dir, "shipments-emailed.jsonl"));
const sends = (calls: Call[]) => calls.filter((c) => c.url === RESEND_URL);
const alerts = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/email"));

// --- token -------------------------------------------------------------------

test("the URL token must match exactly; a wrong or missing one is a 404 and touches nothing", async () => {
  assert.equal(tokenMatches(TOKEN, TOKEN), true);
  assert.equal(tokenMatches(TOKEN + "x", TOKEN), false);
  assert.equal(tokenMatches(TOKEN.slice(0, -1), TOKEN), false);
  assert.equal(tokenMatches("", TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
  assert.equal(tokenMatches(TOKEN, undefined), false);
  assert.equal(tokenMatches(TOKEN, ""), false);

  const dir = tmpDir();
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  const d = deps(dir, fetch);
  const res = await handlePrintfulWebhook("not-the-token", shippedEvent(), d);
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
  assert.equal(ledgerRows(dir).length, 0);

  const unset = deps(dir, fetch, { PRINTFUL_WEBHOOK_TOKEN: undefined });
  assert.equal((await handlePrintfulWebhook(TOKEN, shippedEvent(), unset)).status, 404);
  assert.match(unset.logs.join("\n"), /PRINTFUL_WEBHOOK_TOKEN is not set/);
  assert.equal(calls.length, 0);
});

// --- events --------------------------------------------------------------------

test("only package_shipped is acted on; everything else gets a 200 and no calls", async () => {
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  const d = deps(tmpDir(), fetch);
  for (const type of ["order_created", "order_updated", "package_returned", "order_canceled", "stock_updated"]) {
    const res = await handlePrintfulWebhook(TOKEN, JSON.stringify({ type, data: { order: { id: 180742757 } } }), d);
    assert.equal(res.status, 200);
    assert.equal(res.body.ignored, type);
  }
  assert.equal((await handlePrintfulWebhook(TOKEN, "{not json", d)).status, 400);
  const noId = await handlePrintfulWebhook(TOKEN, JSON.stringify({ type: "package_shipped", data: { order: { id: "1; DROP" } } }), d);
  assert.equal(noId.status, 200);
  assert.equal(noId.body.ignored, "no order id");
  assert.equal(calls.length, 0);
});

// --- re-fetch ------------------------------------------------------------------

test("the payload is never trusted: the order is re-fetched and only its tracking, items and customer are used", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  // The payload's shipment, tracking, external_id and recipient are all forged.
  const res = await handlePrintfulWebhook(TOKEN, JSON.stringify(fixture("printful-package-shipped.json")), deps(dir, fetch, { PRINTFUL_STORE_ID: "18891329" }));
  assert.equal(res.status, 200);
  assert.equal(res.body.order_ref, FIRST_REF);

  const get = calls.find((c) => c.url.startsWith("https://api.printful.com"))!;
  assert.equal(get.url, "https://api.printful.com/orders/180742757");
  assert.equal(get.method, "GET");
  assert.equal(get.headers.Authorization, "Bearer pf_test_token");
  assert.equal(get.headers["X-PF-Store-Id"], "18891329");

  const [send] = sends(calls);
  assert.equal(sends(calls).length, 1);
  assert.equal(send.headers.Authorization, "Bearer re_test_key");
  assert.equal(send.headers["Idempotency-Key"], "mop-shipped/printful:180742757:61000001");
  assert.deepEqual(send.body.to, ["jordan.sample@example.com"]); // our order record
  assert.equal(send.body.from, "MOP Clothing <orders@mopclothing.com>");
  assert.equal(send.body.reply_to, "orders@mopclothing.com");
  assert.equal(send.body.subject, "Your MOP order has shipped 📦");
  const all = JSON.stringify(calls);
  assert.doesNotMatch(all, /FORGED|evil\.example|Forged Person/);
  assert.match(send.body.text, /GM6056178201234567/);
  assert.match(send.body.text, /Track your package: https:\/\/www\.dhl\.com\/us-en\/home\/tracking\/tracking-ecommerce\.html\?submit=1&tracking-id=GM6056178201234567/);
  assert.match(send.body.text, /Carrier: DHL · GlobalMail Packet Plus/);
  for (const line of ["Pelican Tee (Big · Grind Beanie · Ivory · M)", "Alpaca Tee (Big · Blue Jean · L)", "Day · Pelican All-Over (Grind Beanie · M)"])
    assert.ok(send.body.text.includes(`- ${line}`), line);

  const rows = ledgerRows(dir);
  assert.deepEqual(rows.map((r) => r.status), ["sending", "emailed"]);
  assert.equal(rows[1].key, "printful:180742757:61000001");
  assert.equal(rows[1].to, "jordan.sample@example.com");
  assert.equal(rows[1].to_source, "order_record");
  assert.equal(rows[1].resend_id, "re_1");
});

test("custom MOP_EMAIL_FROM / MOP_EMAIL_REPLY_TO are used", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, fetch, { MOP_EMAIL_FROM: "MOP <hi@mopclothing.com>", MOP_EMAIL_REPLY_TO: "help@mopclothing.com" }));
  assert.equal(sends(calls)[0].body.from, "MOP <hi@mopclothing.com>");
  assert.equal(sends(calls)[0].body.reply_to, "help@mopclothing.com");
});

// --- who gets it -----------------------------------------------------------------

test("a hand re-placed order (…r1) with no exact record goes to the Printful recipient, never to the similar ref's customer", async () => {
  // Shaped like the real case: "…a82c" re-placed by hand as "…a8r1" (last two hex -> r1).
  const original = { ...firstRecord(), order_ref: "mop-0123456789abcdef01234567892c", customer: { ...firstRecord().customer, email: "original@example.com", name: "Original Buyer" } };
  const replaced = {
    ...firstOrder(),
    id: 181000001,
    external_id: "mop-0123456789abcdef0123456789r1",
    recipient: { ...firstOrder().recipient, name: "Casey Placed", email: "replaced@example.com" },
  };
  assert.equal(replaced.external_id, `${original.order_ref.slice(0, -2)}r1`);
  const dir = withRecords(tmpDir(), original);
  const { fetch, calls } = world({ orders: { "181000001": replaced } });
  const d = deps(dir, fetch);
  const res = await handlePrintfulWebhook(TOKEN, shippedEvent(181000001), d);
  assert.equal(res.status, 200);
  assert.deepEqual(sends(calls).map((c) => c.body.to), [["replaced@example.com"]]);
  assert.match(sends(calls)[0].body.text, /^Hi Casey,/);
  assert.match(sends(calls)[0].body.text, /Order MOP-01234567/); // same short number as the original order
  assert.doesNotMatch(JSON.stringify(calls), /original@example\.com/);
  assert.match(d.logs.join("\n"), /no exact order record/);
  assert.equal(ledgerRows(dir).at(-1).to_source, "printful_recipient");
});

test("an exact ref match wins over the Printful recipient", async () => {
  const dir = withRecords(tmpDir(), { type: "fulfilment", order_ref: FIRST_REF }, firstRecord());
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, fetch));
  assert.deepEqual(sends(calls)[0].body.to, ["jordan.sample@example.com"]);
  assert.match(sends(calls)[0].body.text, /^Hi Jordan,/);
  assert.doesNotMatch(JSON.stringify(sends(calls)), /recipient-on-printful@example\.com/);
});

test("orders that aren't site orders (no mop- external_id: samples, dashboard orders) get no email", async () => {
  for (const external_id of [null, "", "sample-1", "mop-"]) {
    const dir = tmpDir();
    const { fetch, calls } = world({ orders: { "180742757": { ...firstOrder(), external_id } } });
    const res = await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, fetch));
    assert.equal(res.status, 200);
    assert.equal(res.body.ignored, "not a site order");
    assert.equal(sends(calls).length, 0);
  }
});

// --- idempotency ---------------------------------------------------------------------

test("Printful's retries and repeats send one email per shipment", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  const d = deps(dir, fetch);
  const first = await handlePrintfulWebhook(TOKEN, shippedEvent(), d);
  const again = await handlePrintfulWebhook(TOKEN, shippedEvent(180742757, 61000001, { retries: 1 }), d);
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.shipments, [{ package: "61000001", status: "duplicate" }]);
  assert.equal(sends(calls).length, 1);
  // A fresh process (new ledger object) reads the same file.
  await handlePrintfulWebhook(TOKEN, shippedEvent(), { ...d, ledger: createShipmentLedger(dir) });
  assert.equal(sends(calls).length, 1);
  assert.equal(ledgerRows(dir).filter((r) => r.status === "emailed").length, 1);
});

test("two deliveries at once: one sends, the other is told to come back (409)", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  const slow = async (url: string, init?: RequestInit) => {
    if (url === RESEND_URL) await gate;
    return fetch(url, init);
  };
  const d = deps(dir, slow);
  const first = handlePrintfulWebhook(TOKEN, shippedEvent(), d);
  await new Promise((r) => setTimeout(r, 30));
  const second = await handlePrintfulWebhook(TOKEN, shippedEvent(), d);
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(sends(calls).length, 1);
});

test("a send abandoned mid-way (crash) is resumed after 10 minutes with the same idempotency key", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  const ledger = createShipmentLedger(dir);
  await ledger.claim({ key: "printful:180742757:61000001", supplier: "printful", order_id: "180742757", shipment: "61000001", order_ref: FIRST_REF }, new Date("2026-10-17T17:00:00Z"));
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  const d = deps(dir, fetch);
  const res = await handlePrintfulWebhook(TOKEN, shippedEvent(), { ...d, ledger });
  assert.equal(res.status, 200);
  assert.equal(sends(calls).length, 1);
  assert.equal(sends(calls)[0].headers["Idempotency-Key"], "mop-shipped/printful:180742757:61000001");
  assert.match(d.logs.join("\n"), /stopped mid-send/);
});

// --- partial shipments ------------------------------------------------------------------

test("partial shipments: each box gets its own email listing only what's in it", async () => {
  const order = firstOrder();
  order.items[1].quantity = 2;
  const box1 = { ...order.shipments[0], id: 61000001, items: [{ item_id: 111000001, quantity: 1 }] };
  const box2 = {
    ...order.shipments[0],
    id: 61000002,
    tracking_number: "1Z999AA10123456784",
    carrier: "UPS",
    service: "UPS Ground",
    tracking_url: "",
    shipped_at: 1792198800,
    created: 1792198800,
    ship_date: "2026-10-17",
    items: [
      { item_id: 111000002, quantity: 2 },
      { item_id: 111000003, quantity: 1 },
    ],
  };
  const record = firstRecord();
  record.items[1].qty = 2;
  const dir = withRecords(tmpDir(), record);
  const orders: Record<string, any> = { "180742757": { ...order, shipments: [box1] } };
  const { fetch, calls } = world({ orders });
  const d = deps(dir, fetch);

  await handlePrintfulWebhook(TOKEN, shippedEvent(180742757, 61000001), d);
  const [first] = sends(calls);
  assert.equal(first.body.subject, "Part of your MOP order has shipped 📦");
  assert.match(first.body.text, /In this box:\n- Pelican Tee \(Big · Grind Beanie · Ivory · M\)\n\nThe rest of your order ships separately\./);
  assert.doesNotMatch(first.body.text, /Alpaca|Day ·/);
  assert.match(first.body.html, /Part of your order is on its way\./);

  // Box 2 ships: the order now lists both; only box 2 is emailed.
  orders["180742757"] = { ...order, shipments: [box1, box2] };
  const res = await handlePrintfulWebhook(TOKEN, shippedEvent(180742757, 61000002), d);
  assert.deepEqual(res.body.shipments, [
    { package: "61000001", status: "duplicate" },
    { package: "61000002", status: "emailed" },
  ]);
  const second = sends(calls)[1];
  assert.equal(sends(calls).length, 2);
  assert.equal(second.body.subject, "The rest of your MOP order has shipped 📦");
  assert.match(second.body.text, /- 2 x Alpaca Tee \(Big · Blue Jean · L\)\n- Day · Pelican All-Over \(Grind Beanie · M\)/);
  assert.doesNotMatch(second.body.text, /Pelican Tee/);
  assert.match(second.body.text, /https:\/\/www\.ups\.com\/track\?tracknum=1Z999AA10123456784/); // no Printful URL: built from the number
  assert.match(second.body.text, /Carrier: UPS · Ground/);
  assert.match(second.body.html, /Qty 2/);

  // A reshipment (lost package) is a new box with its own email.
  const box3 = { ...box1, id: 61000003, reshipment: true, tracking_number: "9400111899223817364905", carrier: "USPS", service: "USPS Ground Advantage", tracking_url: "" };
  orders["180742757"] = { ...order, shipments: [box1, box2, box3] };
  await handlePrintfulWebhook(TOKEN, shippedEvent(180742757, 61000003), d);
  assert.equal(sends(calls)[2].body.subject, "Your MOP replacement has shipped 📦");
  assert.equal(sends(calls).length, 3);
});

test("a Printful box in a checkout that also had Yoycol items says the rest is coming", async () => {
  const record = firstRecord();
  record.items.push({ slug: "blue-sky-cotton-shorts", title: "Blue Sky Cotton Shorts", supplier: "yoycol", qty: 1, opts: { size: "M" }, unitAmount: 4000, yoycol: { designCode: "LRWGN", skuCode: "ADS-3MPXZT40-00000-FFFFFF-M" } });
  const dir = withRecords(tmpDir(), record);
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, fetch));
  assert.equal(sends(calls)[0].body.subject, "Part of your MOP order has shipped 📦");
  assert.doesNotMatch(sends(calls)[0].body.text, /Shorts/);
});

test("the event's shipment not on the re-fetched order yet: the others are emailed and Printful is asked to retry", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  const res = await handlePrintfulWebhook(TOKEN, shippedEvent(180742757, 61009999), deps(dir, fetch));
  assert.equal(res.status, 503);
  assert.equal(sends(calls).length, 1);
});

test("the webhook leaves boxes shipped over 30 days ago alone; the by-hand path (send-shipped-email.mjs) sends them", async () => {
  const old = firstOrder();
  old.shipments[0] = { ...old.shipments[0], ship_date: "2026-08-01", shipped_at: 1785542400, created: 1785542400 };
  const dir = withRecords(tmpDir(), firstRecord());
  const { fetch, calls } = world({ orders: { "180742757": old } });
  const d = deps(dir, fetch);
  const res = await handlePrintfulWebhook(TOKEN, shippedEvent(), d);
  assert.deepEqual(res.body.shipments, [{ package: "61000001", status: "too_old" }]);
  assert.equal(sends(calls).length, 0);

  const byHand = await emailPrintfulShipments(old, d);
  assert.deepEqual(byHand.results.map((r) => r.status), ["emailed"]);
  assert.equal(byHand.source, "order_record");
  // ...and refuses to send it again.
  const again = await emailPrintfulShipments(old, d);
  assert.deepEqual(again.results.map((r) => r.status), ["duplicate"]);
  assert.equal(sends(calls).length, 1);
});

// --- sending: dry run, missing key, failures ---------------------------------------------

test("MOP_EMAIL_DRY_RUN=1 logs the email, sends nothing and doesn't mark it emailed", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  const d = deps(dir, fetch, { MOP_EMAIL_DRY_RUN: "1" });
  const res = await handlePrintfulWebhook(TOKEN, shippedEvent(), d);
  assert.equal(res.status, 200);
  assert.equal(sends(calls).length, 0);
  const log = d.logs.join("\n");
  assert.match(log, /DRY-RUN customer email \(not sent\)\nFrom: MOP Clothing <orders@mopclothing\.com>\nTo: jordan\.sample@example\.com\nReply-To: orders@mopclothing\.com\nSubject: Your MOP order has shipped 📦/);
  assert.match(log, /Tracking number: GM6056178201234567/);
  assert.doesNotMatch(log, /re_test_key|pf_test_token/);
  assert.deepEqual(ledgerRows(dir).map((r) => r.status), ["sending", "dry_run"]);
  // Not done: without the dry run it really sends.
  await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, fetch));
  assert.equal(sends(calls).length, 1);
});

test("no MOP_RESEND_API_KEY: still a 200, a clear log line, nothing sent, nothing marked emailed", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  const { fetch, calls } = world({ orders: { "180742757": firstOrder() } });
  const d = deps(dir, fetch, { MOP_RESEND_API_KEY: undefined });
  const res = await handlePrintfulWebhook(TOKEN, shippedEvent(), d);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.shipments, [{ package: "61000001", status: "skipped" }]);
  assert.equal(sends(calls).length, 0);
  assert.equal(alerts(calls).length, 0);
  assert.match(d.logs.join("\n"), /MOP_RESEND_API_KEY is not set: shipped email NOT sent/);
  assert.deepEqual(ledgerRows(dir).map((r) => r.status), ["sending", "skipped"]);
});

test("a failed send (Resend 5xx, retried once) is not marked emailed, John is told once, and Printful's retry sends it", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  let down = true;
  const { fetch, calls } = world({
    orders: { "180742757": firstOrder() },
    resend: (n) => (down ? { status: 503, json: { statusCode: 503, message: "Service unavailable", name: "application_error" } } : { status: 200, json: { id: `re_${n}` } }),
  });
  const d = deps(dir, fetch);
  const r1 = await handlePrintfulWebhook(TOKEN, shippedEvent(), d);
  assert.equal(r1.status, 500); // Printful will retry
  assert.equal(sends(calls).length, 2);
  assert.equal(sends(calls)[1].headers["Idempotency-Key"], sends(calls)[0].headers["Idempotency-Key"]);
  assert.equal(alerts(calls).length, 1);
  const alert = alerts(calls)[0];
  assert.equal(alert.body.subject, `ACTION NEEDED: shipped email failed for ${FIRST_REF}`);
  assert.match(alert.body.body, /Resend HTTP 503: Service unavailable/);
  assert.match(alert.body.body, /To: jordan\.sample@example\.com \(from our order record\)/);
  assert.match(alert.body.body, /GM6056178201234567/);
  assert.match(alert.body.body, /Printful retries the webhook/);
  assert.match(d.logs.join("\n"), /SHIPPED EMAIL FAILED/);
  assert.ok(!ledgerRows(dir).some((r) => r.status === "emailed"));

  // Still down on Printful's next try: no second alert.
  await handlePrintfulWebhook(TOKEN, shippedEvent(180742757, 61000001, { retries: 1 }), d);
  assert.equal(alerts(calls).length, 1);
  down = false;
  const r3 = await handlePrintfulWebhook(TOKEN, shippedEvent(180742757, 61000001, { retries: 2 }), d);
  assert.equal(r3.status, 200);
  // After recorded failures the retry gets a fresh Resend idempotency key (the email may differ).
  assert.equal(sends(calls).at(-1)!.headers["Idempotency-Key"], "mop-shipped/printful:180742757:61000001/retry-2");
  assert.equal(ledgerRows(dir).filter((r) => r.status === "emailed").length, 1);
  assert.equal(alerts(calls).length, 1);
});

test("a send Resend refuses (422) or no customer address: 200, nothing marked emailed, John is told", async () => {
  const dir = withRecords(tmpDir(), firstRecord());
  const { fetch, calls } = world({
    orders: { "180742757": firstOrder() },
    resend: () => ({ status: 422, json: { statusCode: 422, message: "Invalid `to` field.", name: "validation_error" } }),
  });
  const res = await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, fetch));
  assert.equal(res.status, 200); // retrying can't fix it
  assert.equal(sends(calls).length, 1);
  assert.match(alerts(calls)[0].body.body, /Invalid `to` field\.[\s\S]*retrying won't fix this one/);

  // No record and no recipient email on the Printful order.
  const dir2 = tmpDir();
  const noEmail = { ...firstOrder(), recipient: { ...firstOrder().recipient, email: "" } };
  const w2 = world({ orders: { "180742757": noEmail } });
  const r2 = await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir2, w2.fetch));
  assert.equal(r2.status, 200);
  assert.equal(sends(w2.calls).length, 0);
  assert.equal(alerts(w2.calls).length, 1);
  assert.match(alerts(w2.calls)[0].body.body, /no customer email address/);
  assert.deepEqual(ledgerRows(dir2).map((r) => r.status), ["sending", "failed"]);
});

test("Printful can't be read: a token/setup problem alerts John now; a blip is retried by Printful and alerts only on its last try", async () => {
  const dir = tmpDir();
  const unauthorized = world({ printful: () => ({ status: 401, json: { code: 401, error: { message: "Invalid token" } } }) });
  const r1 = await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, unauthorized.fetch));
  assert.equal(r1.status, 502);
  assert.equal(alerts(unauthorized.calls).length, 1);
  assert.match(alerts(unauthorized.calls)[0].body.subject, /^ACTION NEEDED: shipped email failed for Printful order 180742757/);

  const blip = world({ printful: () => ({ status: 503, json: { code: 503, result: "Service Unavailable" } }) });
  const r2 = await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, blip.fetch));
  assert.equal(r2.status, 502);
  assert.equal(blip.calls.filter((c) => c.url.startsWith("https://api.printful.com")).length, 2); // retried once
  assert.equal(alerts(blip.calls).length, 0);
  await handlePrintfulWebhook(TOKEN, shippedEvent(180742757, 61000001, { retries: 6 }), deps(dir, blip.fetch));
  assert.equal(alerts(blip.calls).length, 1);

  const noToken = world({ orders: { "180742757": firstOrder() } });
  const r3 = await handlePrintfulWebhook(TOKEN, shippedEvent(), deps(dir, noToken.fetch, { PRINTFUL_API_TOKEN: undefined }));
  assert.equal(r3.status, 502);
  assert.match(alerts(noToken.calls)[0].body.body, /PRINTFUL_API_TOKEN is not set/);
  assert.equal(sends(noToken.calls).length, 0);
});

// --- tracking links ---------------------------------------------------------------------------

test("tracking links: the supplier's https URL, else the carrier the number names, else the named carrier, else 17track", () => {
  const t = (number: unknown, carrier?: string, url?: string, service?: string) => buildTracking({ number, carrier, url, service });
  assert.equal(t("9400 1118 9922 3817 3649 05")!.url, "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223817364905");
  assert.equal(t("9400111899223817364905")!.carrier, "USPS");
  assert.equal(t("420900019400111899223817364905")!.carrierId, "usps"); // 420 + ZIP prefix
  assert.equal(t("RA123456789US")!.carrierId, "usps");
  assert.equal(t("1Z999AA10123456784")!.url, "https://www.ups.com/track?tracknum=1Z999AA10123456784");
  assert.equal(t("YT2412345678901234")!.url, "https://www.yuntrack.com/parcelTracking?id=YT2412345678901234");
  assert.equal(t("YT2412345678901234")!.carrier, "YunExpress");
  assert.equal(t("123456789012", "FEDEX")!.url, "https://www.fedex.com/fedextrack/?trknbr=123456789012");
  assert.equal(t("123456789012", "FEDEX")!.carrier, "FedEx");
  assert.equal(t("123456789012")!.url, "https://t.17track.net/en#nums=123456789012"); // 12 digits alone could be anyone's
  assert.equal(t("1234567890", "DHL Express")!.url, "https://www.dhl.com/us-en/home/tracking.html?tracking-id=1234567890&submit=1");
  assert.equal(t("GM6056178201234567", "dhl_ecommerce")!.carrierId, "dhl");
  assert.equal(t("LP00123456789CN")!.url, "https://t.17track.net/en#nums=LP00123456789CN");
  assert.equal(t("LP00123456789CN", "4PX Worldwide")!.carrier, "4PX Worldwide");
  // A DHL eCommerce number USPS delivers: labelled DHL (the supplier says so), linked to USPS (the number says so).
  const dhl = t("9261290100830000000000", "DHL")!;
  assert.equal(dhl.carrier, "DHL");
  assert.match(dhl.url, /^https:\/\/tools\.usps\.com\//);
  // The supplier's link wins, but only an https one.
  assert.equal(t("9400111899223817364905", "USPS", "https://printful.example/track/1")!.url, "https://printful.example/track/1");
  assert.match(t("9400111899223817364905", "USPS", "http://insecure.example/x")!.url, /^https:\/\/tools\.usps\.com\//);
  assert.match(t("9400111899223817364905", "USPS", "javascript:alert(1)")!.url, /^https:\/\/tools\.usps\.com\//);
  // "USPS · USPS Ground Advantage" -> "USPS · Ground Advantage"
  assert.equal(t("9400111899223817364905", "USPS", undefined, "USPS Ground Advantage")!.service, "Ground Advantage");
  assert.equal(t("9400111899223817364905", "USPS", undefined, "USPS")!.service, undefined);
  for (const junk of ["", "0", 0, "abc def!", null, undefined, "<script>"]) assert.equal(t(junk), null, String(junk));
});

// --- Yoycol ----------------------------------------------------------------------------------------

test("Yoycol tracking (fixture from the API schema): the last-mile number when there is one, else the waybill; none yet = null", () => {
  const shipped = parseYoycolTracking(fixture("yoycol-tracking-shipped.json"))!;
  assert.equal(shipped.number, "9400111899223817364905");
  assert.equal(shipped.carrier, "USPS");
  assert.equal(shipped.url, "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223817364905");
  assert.equal(shipped.service, "Standard Shipping");
  assert.equal(shipped.waybill, "YT2629012345678901");
  assert.equal(shipped.deliveryStatus, 2);

  const headOnly = fixture("yoycol-tracking-shipped.json");
  headOnly.data.tailTrackCode = "";
  headOnly.data.carrier = "";
  headOnly.data.deliveryLevel = "KnoKgcyh";
  const yt = parseYoycolTracking(headOnly)!;
  assert.equal(yt.number, "YT2629012345678901");
  assert.equal(yt.carrier, "YunExpress");
  assert.equal(yt.url, "https://www.yuntrack.com/parcelTracking?id=YT2629012345678901");

  const unknown = fixture("yoycol-tracking-shipped.json");
  unknown.data = { ...unknown.data, tailTrackCode: "", waybillCode: "LP00123456789CN", lpName: "云途物流", carrier: "", deliveryLevel: "xYz123" };
  const u = parseYoycolTracking(unknown)!;
  assert.equal(u.url, "https://t.17track.net/en#nums=LP00123456789CN");
  assert.equal(u.carrier, undefined); // no Chinese-only carrier names in the customer's email
  assert.equal(u.service, undefined); // an unknown level code isn't shown

  assert.equal(parseYoycolTracking(fixture("yoycol-tracking-pending.json")), null);
  assert.equal(parseYoycolTracking({ code: "320001", msg: "order not found", data: null }), null);
  assert.equal(parseYoycolTracking({ code: "100000", msg: "success", data: null }), null);
  assert.equal(parseYoycolTracking(null), null);
});

const yoycolState = (over: Record<string, any> = {}): any => {
  const record = {
    ...firstRecord(),
    session_id: "cs_yoycol",
    order_ref: "mop-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    created: "2026-10-10T18:00:00.000Z",
    customer: { ...firstRecord().customer, name: "Riley Shorts", email: "riley@example.com" },
    items: [{ slug: "blue-sky-cotton-shorts", title: "Blue Sky Cotton Shorts", supplier: "yoycol", qty: 1, opts: { size: "L" }, unitAmount: 4000, yoycol: { designCode: "LRWGN", skuCode: "ADS-3MPXZT40-00000-FFFFFF-L" } }],
  };
  const entry = (rec: any, yoycol: any) => ({ status: "done", started_at: rec.created, updated_at: rec.created, attempts: 1, record: rec, suppliers: { yoycol } });
  return {
    sessions: {
      cs_yoycol: entry(record, { supplier: "yoycol", ok: true, id: "5551", number: "YC2610170001", at: record.created }),
      cs_dry: entry({ ...record, order_ref: "mop-dddddddddddddddddddddddddddd" }, { supplier: "yoycol", ok: true, dryRun: true, id: "DRY-RUN", at: record.created }),
      cs_failed: entry({ ...record, order_ref: "mop-ffffffffffffffffffffffffffff" }, { supplier: "yoycol", ok: false, error: "HTTP 500", at: record.created }),
      cs_old: entry({ ...record, order_ref: "mop-oooooooooooooooooooooooooooo", created: "2026-06-01T00:00:00.000Z" }, { supplier: "yoycol", ok: true, id: "4441", at: "2026-06-01T00:00:00.000Z" }),
      cs_printful: { ...entry(firstRecord(), undefined), suppliers: { printful: { supplier: "printful", ok: true, id: "180742757", at: record.created } } },
      ...over,
    },
  };
};

test("the Yoycol check emails a shipped order once (signed GET of /orders/{id}/tracking) and skips the rest", async () => {
  const dir = tmpDir();
  const { fetch, calls } = world({ yoycol: { "5551": fixture("yoycol-tracking-shipped.json") } });
  const d = deps(dir, fetch);
  const summary = await checkYoycolTracking({ ...d, state: yoycolState() });
  assert.equal(summary.checked, 1);
  assert.deepEqual(summary.results.map((r) => [r.ref, r.status]), [["mop-aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "emailed"]]);
  const yc = calls.filter((c) => c.url.startsWith("https://www.yoycol.com"));
  assert.equal(yc.length, 1);
  assert.equal(yc[0].url, "https://www.yoycol.com/api/2025/open/v4/orders/5551/tracking");
  assert.equal(yc[0].method, "GET");
  assert.equal(yc[0].headers["X-API-Access-Key"], "AK_TEST");
  assert.ok(yc[0].headers["X-API-Signature"]);

  const [send] = sends(calls);
  assert.deepEqual(send.body.to, ["riley@example.com"]);
  assert.equal(send.body.subject, "Your MOP order has shipped 📦");
  assert.equal(send.headers["Idempotency-Key"], "mop-shipped/yoycol:5551:9400111899223817364905");
  assert.match(send.body.text, /^Hi Riley,/);
  assert.match(send.body.text, /- Blue Sky Cotton Shorts \(L\)/);
  assert.match(send.body.text, /Carrier: USPS · Standard Shipping/);
  assert.match(send.body.html, /src="https:\/\/mopclothing\.com\/images\/blue-sky-cotton-shorts\/worn-front-shorts-crop-v2\.webp"/);

  // Next run: already emailed, so Yoycol isn't even asked.
  const again = await checkYoycolTracking({ ...d, ledger: createShipmentLedger(dir), state: yoycolState() });
  assert.equal(again.checked, 0);
  assert.equal(calls.filter((c) => c.url.startsWith("https://www.yoycol.com")).length, 1);
  assert.equal(sends(calls).length, 1);
});

test("the Yoycol check: no tracking yet = wait; an API error is counted; a failed email alerts John once", async () => {
  const dir = tmpDir();
  const pending = world({});
  const s1 = await checkYoycolTracking({ ...deps(dir, pending.fetch), state: yoycolState() });
  assert.equal(s1.waiting, 1);
  assert.equal(s1.errors, 0);
  assert.equal(sends(pending.calls).length, 0);

  const broken = fakeFetch((call) => (call.url.startsWith("https://www.yoycol.com") ? { status: 500, json: { code: "500", msg: "busy" } } : { status: 200, json: { ok: true } }));
  const s2 = await checkYoycolTracking({ ...deps(dir, broken.fetch), state: yoycolState() });
  assert.equal(s2.errors, 1);

  const failing = world({ yoycol: { "5551": fixture("yoycol-tracking-shipped.json") }, resend: () => ({ status: 500, json: { message: "down" } }) });
  const d = deps(dir, failing.fetch);
  const s3 = await checkYoycolTracking({ ...d, state: yoycolState() });
  assert.equal(s3.errors, 1);
  assert.equal(alerts(failing.calls).length, 1);
  assert.equal(alerts(failing.calls)[0].body.subject, "ACTION NEEDED: shipped email failed for mop-aaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.match(alerts(failing.calls)[0].body.body, /Yoycol tracking check \(cron/);
  await checkYoycolTracking({ ...d, state: yoycolState() });
  assert.equal(alerts(failing.calls).length, 1); // told once

  const noKeys = await checkYoycolTracking({ ...deps(dir, pending.fetch, { YOYCOL_SECRET_KEY: undefined }), state: yoycolState() });
  assert.equal(noKeys.errors, 1);
});

test("a Yoycol parcel from a checkout that also had Printful items: 'part', then 'the rest' once the Printful box was emailed", async () => {
  const dir = withRecords(tmpDir());
  const state = yoycolState();
  const rec = state.sessions.cs_yoycol.record;
  rec.items = [...firstRecord().items.slice(0, 1), ...rec.items];
  const { fetch, calls } = world({ yoycol: { "5551": fixture("yoycol-tracking-shipped.json") } });
  const d = deps(dir, fetch);
  await checkYoycolTracking({ ...d, state: { sessions: { cs_yoycol: state.sessions.cs_yoycol } } });
  assert.equal(sends(calls)[0].body.subject, "Part of your MOP order has shipped 📦");
  assert.doesNotMatch(sends(calls)[0].body.text, /Pelican/);

  const dir2 = tmpDir();
  const l2 = createShipmentLedger(dir2);
  await l2.record({ at: "2026-10-15T00:00:00Z", status: "emailed", key: "printful:1:1", supplier: "printful", order_id: "1", shipment: "1", order_ref: rec.order_ref });
  const w2 = world({ yoycol: { "5551": fixture("yoycol-tracking-shipped.json") } });
  await checkYoycolTracking({ ...deps(dir2, w2.fetch), ledger: l2, state: { sessions: { cs_yoycol: state.sessions.cs_yoycol } } });
  assert.equal(sends(w2.calls)[0].body.subject, "The rest of your MOP order has shipped 📦");
});

// --- the email ------------------------------------------------------------------------------------------

test("the email: branded header, greeting, items with thumbnails, tracking button, order number, help; HTML + text", () => {
  const email = shippedEmail({
    name: "jordan sample",
    orderRef: FIRST_REF,
    kind: "all",
    shipDate: "2026-10-16",
    tracking: buildTracking({ number: "9400111899223817364905", carrier: "USPS", service: "Ground Advantage" }),
    items: [
      { title: "Pelican Tee", options: "Big · Grind Beanie · Ivory · M", qty: 1, image: "https://mopclothing.com/images/catalog/pelican-tee/a.jpg" },
      { title: "Alpaca Tee", options: "Big · Blue Jean · L", qty: 2 },
    ],
  });
  const { html, text } = email;
  assert.equal(email.subject, "Your MOP order has shipped 📦");
  assert.ok(html.includes(`src="${LOGO_URL}"`));
  assert.equal(LOGO_URL, "https://mopclothing.com/images/email/mop-logo.png");
  assert.match(html, /Modern Orange Pineapple/);
  assert.match(html, /Hi Jordan,/);
  assert.match(html, /Your order is on its way\./);
  assert.match(html, /It shipped Oct 16 with USPS\./);
  assert.match(html, /href="https:\/\/tools\.usps\.com\/go\/TrackConfirmAction\?tLabels=9400111899223817364905"[^>]*>Track your package</);
  assert.match(html, /9400 1118 9922 3817 3649 05/);
  assert.match(html, /USPS · Ground Advantage/);
  assert.match(html, /src="https:\/\/mopclothing\.com\/images\/catalog\/pelican-tee\/a\.jpg"/);
  assert.match(html, /Qty 2/);
  assert.match(html, /MOP-B25662F9/);
  assert.match(html, /href="https:\/\/mopclothing\.com\/shipping-returns"/);
  assert.match(html, /Questions\? Just reply to this email\./);
  assert.match(html, /Thank you for supporting original art\./);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /role="presentation"/);
  // No external CSS or fonts; every image is an absolute https URL on mopclothing.com.
  assert.doesNotMatch(html, /<link|@import|fonts\.googleapis/);
  for (const [, src] of Array.from(html.matchAll(/<img[^>]+src="([^"]+)"/g))) assert.match(src, /^https:\/\/mopclothing\.com\//);

  assert.match(text, /^Hi Jordan,\n\nYour order is on its way\. It shipped Oct 16 with USPS\.\n\nTrack your package: https:\/\/tools\.usps\.com/);
  assert.match(text, /Your order:\n- Pelican Tee \(Big · Grind Beanie · Ivory · M\)\n- 2 x Alpaca Tee \(Big · Blue Jean · L\)/);
  assert.match(text, /Questions\? Just reply to this email\./);
  assert.match(text, /Shipping & returns: https:\/\/mopclothing\.com\/shipping-returns/);
  assert.match(text, /Order MOP-B25662F9/);
});

test("names and item text are escaped; first names and short order numbers", () => {
  const { html } = shippedEmail({
    name: `<img src=x onerror=alert(1)> Doe`,
    orderRef: FIRST_REF,
    kind: "all",
    tracking: null,
    items: [{ title: `Tee "<b>"`, options: "M & L", qty: 1 }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Tee &quot;&lt;b&gt;&quot;/);
  assert.match(html, /M &amp; L/);
  assert.doesNotMatch(html, /Track your package/); // no tracking number: no button
  assert.equal(firstName("ANA MARIA DIAZ"), "Ana");
  assert.equal(firstName("mcKenzie Fox"), "mcKenzie");
  assert.equal(firstName("  "), "");
  assert.match(shippedEmail({ name: "", orderRef: FIRST_REF, kind: "all", tracking: null, items: [] }).text, /^Hi there,/);
  assert.equal(shortOrderNumber("mop-0123456789abcdef0123456789r1"), "MOP-01234567");
  assert.equal(shortOrderNumber(FIRST_REF), "MOP-B25662F9");
});

// --- the scripts load --------------------------------------------------------------------------------------

test("scripts/send-shipped-email.mjs and scripts/yoycol-tracking.mjs load the site's TypeScript and check their arguments", () => {
  const run = (script: string, ...args: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(ROOT, "scripts", script), ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", MOP_DATA_DIR: tmpDir() } as unknown as NodeJS.ProcessEnv,
    });
  const help = run("send-shipped-email.mjs", "--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--printful-order <Printful order id> \[--dry-run\]/);
  assert.equal(run("send-shipped-email.mjs").status, 2);
  assert.equal(run("send-shipped-email.mjs", "--printful-order", "12a").status, 2);
  const noToken = run("send-shipped-email.mjs", "--printful-order", "180742757", "--dry-run");
  assert.equal(noToken.status, 1);
  assert.match(noToken.stderr, /PRINTFUL_API_TOKEN is not set/);

  assert.equal(run("yoycol-tracking.mjs", "--help").status, 0);
  const yc = run("yoycol-tracking.mjs", "--dry-run");
  assert.equal(yc.status, 1); // no Yoycol keys in this env
  assert.match(yc.stdout, /YOYCOL_ACCESS_KEY \/ YOYCOL_SECRET_KEY are not set/);
});
