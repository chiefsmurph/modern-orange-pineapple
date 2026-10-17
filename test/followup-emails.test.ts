// Follow-up emails: "How's it fit?" (a few days after the last package arrived) and
// the Yoycol "being made" note (12–14 days in, not shipped yet). When each is due,
// once per order, the switches, no backfill, dry runs, failures that alert John,
// the shared look with the other two emails, and scripts/followup-emails.mjs.
//
// Every name and address is made up; the products are real catalog products. The
// Printful v2 shipments and the Yoycol order / tracking answers are built from their
// OpenAPI specs, not captured from a real order.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildItem } from "../lib/orders/build-items.ts";
import { RESEND_URL } from "../lib/orders/customer-email.ts";
import { emailFooter, emailHeader, textFooter } from "../lib/orders/email-layout.ts";
import { confirmationEmail } from "../lib/orders/confirmation-email.ts";
import { confirmationInput } from "../lib/orders/confirmation.ts";
import { shippedEmail } from "../lib/orders/shipped-email.ts";
import { buildTracking } from "../lib/orders/tracking.ts";
import { displayFromRecordItem } from "../lib/orders/item-display.ts";
import { beingMadeEmail, beingMadeSubject, fitEmail, photoMailto, photoSubject } from "../lib/orders/followup-email.ts";
import {
  beingMadeWindow,
  createFollowupLedger,
  fitDecision,
  gateFor,
  printfulPackages,
  readStart,
  runFollowups,
  shippingComplete,
  type FollowupDeps,
} from "../lib/orders/followups.ts";
import { parseYoycolDelivery, parseYoycolOrderState } from "../lib/orders/yoycol-tracking.ts";
import type { OrderItem, OrderRecord } from "../lib/orders/types.ts";
import { fakeFetch, readJsonl, tmpDir, type Call } from "./helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 86_400_000;
const t = (iso: string) => Date.parse(iso);

// Real catalog products.
const tee = (over: Partial<OrderItem> = {}): OrderItem => ({ ...buildItem("pelican-tee", { version: "large", style: "beanie", color: "Ivory", size: "M" }, 1, {}).item, ...over });
const alpaca = (over: Partial<OrderItem> = {}): OrderItem => ({ ...buildItem("alpaca-tee", { version: "large", color: "Blue Jean", size: "L" }, 1, {}).item, ...over });
const shorts = (over: Partial<OrderItem> = {}): OrderItem => ({ ...buildItem("blue-sky-cotton-shorts", { size: "L" }, 1, {}).item, ...over });

const REF = "mop-5e1f0c2a9b7d4e3f8a6c1b2d3e4f";
const REF2 = "mop-7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const PF_ID = "190000001";
const Y_ID = "5551";

const recordOf = (ref: string, items: OrderItem[], over: Partial<OrderRecord> = {}): OrderRecord => ({
  session_id: `cs_test_${ref}`,
  order_ref: ref,
  created: "2026-10-18T17:55:00.000Z",
  livemode: true,
  payment_status: "paid",
  payment_intent: "pi_test_followup",
  currency: "usd",
  amount_total: items.reduce((n, i) => n + i.unitAmount * i.qty, 0),
  amount_subtotal: items.reduce((n, i) => n + i.unitAmount * i.qty, 0),
  amount_shipping: 0,
  amount_discount: 0,
  amount_tax: 0,
  customer: { name: "maya castellano", email: "maya.castellano@example.com", phone: "+18055550142", address: { line1: "12 Example Way", city: "San Luis Obispo", state: "CA", postal_code: "93401", country: "US" } },
  items,
  items_source: "metadata",
  ...over,
});

type Order = { record: OrderRecord; paidAt: string; printful?: string; yoycol?: string; yoycolDry?: boolean };

/** A data dir: orders.jsonl, orders-state.json, shipments-emailed.jsonl (and followups-start.json). */
function dataDir(orders: Order[], shipped: Record<string, unknown>[] = [], start: Record<string, string> | null = { fit: "2026-10-01T00:00:00.000Z", being_made: "2026-10-01T00:00:00.000Z" }) {
  const dir = tmpDir();
  writeFileSync(path.join(dir, "orders.jsonl"), orders.map((o) => JSON.stringify({ type: "order", at: o.paidAt, ...o.record }) + "\n").join(""));
  const sessions: Record<string, unknown> = {};
  for (const o of orders)
    sessions[o.record.session_id] = {
      status: "done",
      order_ref: o.record.order_ref,
      started_at: o.paidAt,
      updated_at: o.paidAt,
      attempts: 1,
      record: o.record,
      suppliers: {
        ...(o.printful ? { printful: { supplier: "printful", ok: true, id: o.printful, status: "pending", at: o.paidAt } } : {}),
        ...(o.yoycol ? { yoycol: { supplier: "yoycol", ok: true, id: o.yoycol, number: `YC${o.yoycol}`, at: o.paidAt, ...(o.yoycolDry ? { dryRun: true } : {}) } } : {}),
      },
    };
  writeFileSync(path.join(dir, "orders-state.json"), JSON.stringify({ sessions }));
  writeFileSync(path.join(dir, "shipments-emailed.jsonl"), shipped.map((r) => JSON.stringify(r) + "\n").join(""));
  if (start) writeFileSync(path.join(dir, "followups-start.json"), JSON.stringify(start));
  return dir;
}

/** A shipped-email ledger line (shipments.ts), as the webhook / Yoycol cron write it. */
const shippedRow = (ref: string, at: string, over: Record<string, unknown> = {}) => ({
  at,
  status: "emailed",
  key: `printful:${PF_ID}:71000001`,
  supplier: "printful",
  order_id: PF_ID,
  shipment: "71000001",
  order_ref: ref,
  to: "maya.castellano@example.com",
  kind: "all",
  ...over,
});

/** A Printful v2 shipment (GET /v2/orders/{id}/shipments -> data[]). */
const pfShipment = (over: Record<string, unknown> = {}) => ({
  id: 71000001,
  order_id: Number(PF_ID),
  carrier: "USPS",
  service: "USPS Ground Advantage",
  shipment_status: "shipped",
  shipped_at: "2026-10-22T16:00:00Z",
  delivery_status: "in_transit",
  delivered_at: null,
  is_reshipment: false,
  tracking_number: "9400111899223817364905",
  tracking_url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223817364905",
  tracking_events: [{ triggered_at: "2026-10-22T18:00:00Z", description: "Accepted at USPS Origin Facility" }],
  estimated_delivery: { from_date: "2026-10-25", to_date: "2026-10-28", calculated_at: "2026-10-22T16:00:00Z" },
  shipment_items: [{ id: 1, order_item_id: 11, quantity: 1 }],
  ...over,
});

/** Yoycol GET /orders/{id}/tracking (SelfStoreOrderTrackingResponse). */
const yTracking = (events: { at: string; text: string }[] = [], over: Record<string, unknown> = {}) => ({
  code: "100000",
  msg: "success",
  data: {
    orderNo: "YC2610180001",
    lpCode: "YUNEXPRESS",
    lpName: "YunExpress",
    waybillCode: "YT2629012345678901",
    deliveryStatus: 2,
    carrier: "USPS",
    deliveryLevel: "Standard Shipping",
    tailTrackCode: "9400111899223817364905",
    headTrackingEvents: events.slice(0, 1).map((e) => ({ occurDate: t(e.at), location: "Shenzhen, CN", description: e.text })),
    tailTrackingEvents: events.slice(1).map((e) => ({ occurDate: t(e.at), location: "San Luis Obispo, CA", description: e.text })),
    ...over,
  },
});

/** Yoycol GET /orders/{id} (OrderSummaryDTO; the status words are made up, the spec doesn't list them). */
const yOrder = (over: Record<string, unknown> = {}) => ({
  code: "100000",
  msg: "success",
  data: { order: { orderId: Number(Y_ID), orderNo: "YC2610180001", storeOrderSn: REF, canPay: false, status: "IN_PRODUCTION", statusLabel: "In production", paidAt: "2026-10-18T20:00:00Z", ...over }, items: [] },
});

type Answer = { status: number; json?: unknown } | Error;

/** Printful v2 shipments by order id, Yoycol tracking / order by id, Resend and PingPigeon. */
function world(opts: { printful?: Record<string, unknown[] | Answer>; tracking?: Record<string, unknown>; yoycolOrder?: Record<string, unknown>; resend?: (n: number, call: Call) => Answer } = {}) {
  let n = 0;
  return fakeFetch((call) => {
    const pf = /^https:\/\/api\.printful\.com\/v2\/orders\/(\d+)\/shipments\?limit=100$/.exec(call.url);
    if (pf) {
      const a = opts.printful?.[pf[1]];
      if (a && !Array.isArray(a)) return a as Answer;
      return { status: 200, json: { data: a ?? [], paging: { total: (a ?? []).length, offset: 0, limit: 100 }, _links: { self: { href: call.url } } } };
    }
    const tr = /^https:\/\/www\.yoycol\.com\/api\/2025\/open\/v4\/orders\/(\d+)\/tracking$/.exec(call.url);
    if (tr) return { status: 200, json: opts.tracking?.[tr[1]] ?? yTracking() };
    const yo = /^https:\/\/www\.yoycol\.com\/api\/2025\/open\/v4\/orders\/(\d+)$/.exec(call.url);
    if (yo) return { status: 200, json: opts.yoycolOrder?.[yo[1]] ?? yOrder() };
    if (call.url === RESEND_URL) return opts.resend ? opts.resend(++n, call) : { status: 200, json: { id: `re_${++n}` } };
    if (call.url.endsWith("/email")) return { status: 200, json: { ok: true } };
    return { status: 404, json: { error: "unexpected" } };
  });
}

const ON = { MOP_FOLLOWUP_FIT_ENABLED: "1", MOP_FOLLOWUP_YOYCOL_ENABLED: "1" };

function deps(dir: string, fetch: FollowupDeps["fetch"], now: string, env: Record<string, string | undefined> = ON, extra: Partial<FollowupDeps> = {}) {
  const logs: string[] = [];
  const d: FollowupDeps & { logs: string[] } = {
    env: { PRINTFUL_API_TOKEN: "pf_test_token", YOYCOL_ACCESS_KEY: "AK_TEST", YOYCOL_SECRET_KEY: "SK_TEST", MOP_RESEND_API_KEY: "re_test_key", PINGPIGEON_TOKEN: "pp_test_token", ...env },
    fetch,
    now: () => new Date(now),
    log: (m) => logs.push(m),
    dir,
    state: JSON.parse(readFileSync(path.join(dir, "orders-state.json"), "utf8")),
    ledger: createFollowupLedger(dir),
    apiDelayMs: 0,
    retryDelayMs: 0,
    logs,
    ...extra,
  };
  return d;
}

const sends = (calls: Call[]) => calls.filter((c) => c.url === RESEND_URL);
const alerts = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/email"));
const supplierCalls = (calls: Call[]) => calls.filter((c) => /printful\.com|yoycol\.com/.test(c.url));
const ledgerRows = (dir: string) => readJsonl(path.join(dir, "followups-emailed.jsonl"));
const outcomes = (s: Awaited<ReturnType<typeof runFollowups>>) => s.results.map((r) => [r.type, r.ref, r.outcome]);

/** A one-tee Printful order paid 10/18, its box emailed as shipped 10/22. */
const teeOrder = (over: Partial<Order> = {}): Order => ({ record: recordOf(REF, [tee()]), paidAt: "2026-10-18T18:00:00.000Z", printful: PF_ID, ...over });

// --- when "How's it fit?" is due --------------------------------------------------------------------

test("fit: 3 days after Printful says the package was delivered, not a minute before; read with one GET of the v2 shipments", async () => {
  const dir = dataDir([teeOrder()], [shippedRow(REF, "2026-10-22T16:05:00.000Z")]);
  const { fetch, calls } = world({ printful: { [PF_ID]: [pfShipment({ delivery_status: "delivered", delivered_at: "2026-10-26T19:00:00Z" })] } });

  const early = await runFollowups(deps(dir, fetch, "2026-10-29T18:59:00Z"));
  assert.deepEqual(outcomes(early), [["fit", REF, "waiting"]]);
  assert.equal(early.results[0].dueAt, "2026-10-29T19:00:00.000Z");
  assert.equal(sends(calls).length, 0);

  const d = deps(dir, fetch, "2026-10-29T19:00:00Z");
  const due = await runFollowups(d);
  assert.deepEqual(outcomes(due), [["fit", REF, "sent"]]);
  const pf = supplierCalls(calls);
  assert.equal(pf.length, 2); // one per run
  assert.equal(pf[0].url, `https://api.printful.com/v2/orders/${PF_ID}/shipments?limit=100`);
  assert.equal(pf[0].method, "GET");
  assert.equal(pf[0].headers.Authorization, "Bearer pf_test_token");

  const [send] = sends(calls);
  assert.deepEqual(send.body.to, ["maya.castellano@example.com"]);
  assert.equal(send.body.reply_to, "orders@mopclothing.com");
  assert.equal(send.body.subject, "How's it fit? 📸");
  assert.equal(send.headers["Idempotency-Key"], `mop-followup/fit:${REF}`);
  assert.match(send.body.text, /^Hi Maya,\n\nHow's it fit\? Your MOP order arrived a few days ago\. We hope it fits just right and that you love it\./);
  const rows = ledgerRows(dir);
  assert.deepEqual(rows.map((r) => r.status), ["sending", "emailed"]);
  assert.equal(rows[1].key, `fit:${REF}`);
  assert.equal(rows[1].type, "fit");
  assert.match(rows[1].basis, /^delivered: delivered 2026-10-26/);
});

test("fit fallback: no delivery report = 12 days after the shipped email; still in transit = 21; Printful unreachable = the fallback", async () => {
  const shipped = "2026-10-22T16:05:00.000Z";
  const noReport = pfShipment({ delivery_status: "unknown", tracking_events: [] });
  const run = async (shipments: unknown[] | Answer, now: string) => {
    const dir = dataDir([teeOrder()], [shippedRow(REF, shipped)]);
    const w = world({ printful: { [PF_ID]: shipments } });
    const s = await runFollowups(deps(dir, w.fetch, now));
    return { s, w, dir };
  };
  // Pure decision first.
  const complete = { complete: true, reason: "" };
  const f = fitDecision({ now: t(shipped), lastShippedAt: t(shipped), packages: [{ supplier: "printful", id: "1", state: "no_report" }], complete });
  assert.equal(f.status, "waiting");
  assert.equal("dueAt" in f && f.dueAt, t(shipped) + 12 * DAY);
  const m = fitDecision({ now: t(shipped), lastShippedAt: t(shipped), packages: [{ supplier: "printful", id: "1", state: "in_transit" }], complete });
  assert.equal("dueAt" in m && m.dueAt, t(shipped) + 21 * DAY);

  assert.deepEqual(outcomes((await run([noReport], "2026-11-03T16:00:00Z")).s), [["fit", REF, "waiting"]]); // 11 days 23h
  const sent = await run([noReport], "2026-11-03T16:05:00Z"); // exactly 12 days
  assert.deepEqual(outcomes(sent.s), [["fit", REF, "sent"]]);
  assert.match(sends(sent.w.calls)[0].body.text, /Your MOP order should be with you by now\./); // not "arrived"
  assert.match(ledgerRows(sent.dir)[1].basis, /^fallback: no delivery report/);

  assert.deepEqual(outcomes((await run([pfShipment()], "2026-11-03T16:05:00Z")).s), [["fit", REF, "waiting"]]); // in transit at 12 days
  assert.deepEqual(outcomes((await run([pfShipment()], "2026-11-12T16:05:00Z")).s), [["fit", REF, "sent"]]); // ...asked anyway at 21

  // Printful refuses (a token / permission problem): the shipped emails decide, and the fallback applies.
  const refused = await run({ status: 403, json: { code: 403, error: { message: "Forbidden" } } }, "2026-11-03T16:05:00Z");
  assert.deepEqual(outcomes(refused.s), [["fit", REF, "sent"]]);
  assert.equal(refused.s.errors, 1);
  // A blip (5xx, retried once): nothing decided this run, tried again tomorrow.
  const blip = await run({ status: 503, json: { error: { message: "busy" } } }, "2026-11-03T16:05:00Z");
  assert.deepEqual(outcomes(blip.s), [["fit", REF, "waiting"]]);
  assert.equal(supplierCalls(blip.w.calls).length, 2);
  assert.equal(sends(blip.w.calls).length, 0);
});

test("several packages: waits for the last box (and the last delivery), then one email for the whole order", async () => {
  const record = recordOf(REF, [tee(), alpaca()]);
  const order: Order = { record, paidAt: "2026-10-18T18:00:00.000Z", printful: PF_ID };
  const box1 = pfShipment({ id: 71000001, shipped_at: "2026-10-22T16:00:00Z", delivery_status: "delivered", delivered_at: "2026-10-25T20:00:00Z", shipment_items: [{ id: 1, order_item_id: 11, quantity: 1 }] });
  const box2 = pfShipment({ id: 71000002, shipped_at: "2026-10-26T16:00:00Z", shipment_items: [{ id: 2, order_item_id: 12, quantity: 1 }] });
  const row1 = shippedRow(REF, "2026-10-22T16:05:00.000Z", { kind: "part" });
  const row2 = shippedRow(REF, "2026-10-26T16:05:00.000Z", { key: `printful:${PF_ID}:71000002`, shipment: "71000002", kind: "rest" });

  // Only the first box has shipped: waiting, even long after it was delivered.
  let dir = dataDir([order], [row1]);
  let w = world({ printful: { [PF_ID]: [box1, { ...box2, shipment_status: "pending", shipped_at: null }] } });
  let s = await runFollowups(deps(dir, w.fetch, "2026-10-30T15:00:00Z"));
  assert.deepEqual(outcomes(s), [["fit", REF, "waiting"]]);
  assert.match(s.results[0].reason!, /Printful has shipped 1 of 2 item\(s\)/);

  // Both shipped, the second still moving: waiting.
  dir = dataDir([order], [row1, row2]);
  w = world({ printful: { [PF_ID]: [box1, box2] } });
  s = await runFollowups(deps(dir, w.fetch, "2026-10-30T15:00:00Z"));
  assert.deepEqual(outcomes(s), [["fit", REF, "waiting"]]);
  assert.match(s.results[0].reason!, /in transit/);

  // The second delivered 10/29: due 11/1 (3 days after the LAST delivery), sent once.
  w = world({ printful: { [PF_ID]: [box1, { ...box2, delivery_status: "delivered", delivered_at: "2026-10-29T18:00:00Z" }] } });
  s = await runFollowups(deps(dir, w.fetch, "2026-10-31T18:00:00Z"));
  assert.equal(s.results[0].dueAt, "2026-11-01T18:00:00.000Z");
  s = await runFollowups(deps(dir, w.fetch, "2026-11-01T18:00:00Z"));
  assert.deepEqual(outcomes(s), [["fit", REF, "sent"]]);
  const [send] = sends(w.calls);
  assert.equal(send.body.subject, "How's everything fit? 📸");
  assert.match(send.body.text, /- Pelican Tee \(Big · Grind Beanie · Ivory · M\)\n- Alpaca Tee \(Big · Blue Jean · L\)/);
  assert.match(send.body.text, /Send us a photo of you wearing them\./);
  await runFollowups(deps(dir, w.fetch, "2026-11-02T18:00:00Z"));
  await runFollowups(deps(dir, w.fetch, "2026-11-09T18:00:00Z"));
  assert.equal(sends(w.calls).length, 1);
});

test("a mixed order (Printful + Yoycol shorts) waits for the shorts; the shorts' delivery comes from Yoycol's tracking events", async () => {
  const record = recordOf(REF, [tee(), shorts()]);
  const order: Order = { record, paidAt: "2026-10-18T18:00:00.000Z", printful: PF_ID, yoycol: Y_ID };
  const pfRow = shippedRow(REF, "2026-10-22T16:05:00.000Z", { kind: "part" });
  const yRow = shippedRow(REF, "2026-11-01T14:00:00.000Z", { key: `yoycol:${Y_ID}:9400111899223817364905`, supplier: "yoycol", order_id: Y_ID, shipment: "9400111899223817364905", kind: "rest" });
  const delivered = [pfShipment({ delivery_status: "delivered", delivered_at: "2026-10-25T20:00:00Z" })];

  let dir = dataDir([order], [pfRow]);
  let w = world({ printful: { [PF_ID]: delivered } });
  let s = await runFollowups(deps(dir, w.fetch, "2026-10-30T15:00:00Z"));
  assert.deepEqual(outcomes(s), [["fit", REF, "waiting"]]);
  assert.match(s.results[0].reason!, /the Yoycol part hasn't shipped yet/);

  dir = dataDir([order], [pfRow, yRow]);
  const moving = yTracking([{ at: "2026-11-01T10:00:00Z", text: "Shipment picked up" }, { at: "2026-11-09T09:00:00Z", text: "Out for Delivery, Expected Delivery by 9:00pm" }]);
  w = world({ printful: { [PF_ID]: delivered }, tracking: { [Y_ID]: moving } });
  s = await runFollowups(deps(dir, w.fetch, "2026-11-13T15:00:00Z")); // 12 days after the shorts shipped, still moving
  assert.deepEqual(outcomes(s), [["fit", REF, "waiting"]]);
  assert.ok(supplierCalls(w.calls).some((c) => c.url === `https://www.yoycol.com/api/2025/open/v4/orders/${Y_ID}/tracking` && c.headers["X-API-Signature"]));

  const arrived = yTracking([{ at: "2026-11-01T10:00:00Z", text: "Shipment picked up" }, { at: "2026-11-10T19:30:00Z", text: "Delivered, In/At Mailbox" }]);
  w = world({ printful: { [PF_ID]: delivered }, tracking: { [Y_ID]: arrived } });
  s = await runFollowups(deps(dir, w.fetch, "2026-11-13T19:29:00Z"));
  assert.equal(s.results[0].dueAt, "2026-11-13T19:30:00.000Z");
  s = await runFollowups(deps(dir, w.fetch, "2026-11-13T19:30:00Z"));
  assert.deepEqual(outcomes(s), [["fit", REF, "sent"]]);
  assert.match(sends(w.calls)[0].body.text, /- Pelican Tee [^\n]+\n- Blue Sky Cotton Shorts \(L\)/);
});

test("a returned or failed package holds the email (no fallback); a delivered reshipment releases it", async () => {
  const dir = dataDir([teeOrder()], [shippedRow(REF, "2026-10-22T16:05:00.000Z")]);
  const returned = pfShipment({ delivery_status: "return_to_sender" });
  let w = world({ printful: { [PF_ID]: [returned] } });
  const s = await runFollowups(deps(dir, w.fetch, "2026-11-20T15:00:00Z"));
  assert.deepEqual(outcomes(s), [["fit", REF, "held"]]);
  assert.match(s.results[0].reason!, /return_to_sender/);
  assert.equal(sends(w.calls).length, 0);

  const reship = pfShipment({ id: 71000009, is_reshipment: true, shipped_at: "2026-11-02T16:00:00Z", delivery_status: "delivered", delivered_at: "2026-11-06T17:00:00Z" });
  w = world({ printful: { [PF_ID]: [returned, reship] } });
  const ok = await runFollowups(deps(dir, w.fetch, "2026-11-09T17:00:00Z"));
  assert.deepEqual(outcomes(ok), [["fit", REF, "sent"]]);
});

test("Printful v2 shipments -> packages; shipped emails decide when Printful can't (the box's kind)", () => {
  const { packages, shippedQty } = printfulPackages([
    pfShipment({ id: 1, delivery_status: "delivered", delivered_at: "2026-10-25T20:00:00Z", shipment_items: [{ quantity: 2 }] }),
    pfShipment({ id: 2, delivery_status: "delivered", delivered_at: null, tracking_events: [{ triggered_at: "2026-10-26T10:00:00Z", description: "Delivered" }] }),
    pfShipment({ id: 3, delivery_status: "pre_transit" }),
    pfShipment({ id: 4, shipment_status: "returned", delivery_status: "return_to_sender" }),
    pfShipment({ id: 5, shipment_status: "pending", shipped_at: null }),
    pfShipment({ id: 6, shipment_status: "canceled" }),
    pfShipment({ id: 7, is_reshipment: true }),
  ]);
  assert.deepEqual(packages.map((p) => [p.id, p.state]), [["1", "delivered"], ["2", "delivered"], ["3", "no_report"], ["4", "problem"], ["7", "in_transit"]]);
  assert.equal(packages[0].deliveredAt, t("2026-10-25T20:00:00Z"));
  assert.equal(packages[1].deliveredAt, t("2026-10-26T10:00:00Z"));
  assert.equal(shippedQty, 5); // 2 + 1 + 1 + 1; the reshipment isn't counted

  const record = recordOf(REF, [tee(), alpaca()]);
  const row = (kind: string | undefined, at = "2026-10-22T16:05:00.000Z") => shippedRow(REF, at, kind ? { kind } : { kind: undefined }) as any;
  assert.equal(shippingComplete({ record, shipped: [row("part")], printful: null }).complete, false);
  assert.equal(shippingComplete({ record, shipped: [row("part"), row("rest", "2026-10-25T00:00:00Z")], printful: null }).complete, true);
  assert.equal(shippingComplete({ record, shipped: [row(undefined)], printful: null }).complete, true); // a line from before `kind`
  assert.equal(shippingComplete({ record, shipped: [row("all")], printful: { shippedQty: 1 } }).complete, false); // Printful knows better
  assert.match(shippingComplete({ record: recordOf(REF, [tee({ supplier: "manual" })]), shipped: [row("all")], printful: null }).reason, /by hand/);
});

test("Yoycol: delivered only from a delivered event, or a deliveryStatus John has listed (MOP_YOYCOL_DELIVERED_STATUS)", () => {
  assert.deepEqual(parseYoycolDelivery(yTracking([])), { state: "no_report" });
  assert.deepEqual(parseYoycolDelivery({ code: "300001", msg: "bad signature" }), { state: "no_report" });
  assert.deepEqual(parseYoycolDelivery(yTracking([{ at: "2026-11-01T10:00:00Z", text: "In transit" }])), { state: "in_transit" });
  assert.deepEqual(parseYoycolDelivery(yTracking([{ at: "2026-11-01T10:00:00Z", text: "x" }, { at: "2026-11-09T10:00:00Z", text: "Out for delivery" }])), { state: "in_transit" });
  assert.deepEqual(parseYoycolDelivery(yTracking([{ at: "2026-11-01T10:00:00Z", text: "x" }, { at: "2026-11-09T10:00:00Z", text: "Delivery attempted, notice left" }])), { state: "in_transit" });
  assert.deepEqual(parseYoycolDelivery(yTracking([{ at: "2026-11-01T10:00:00Z", text: "x" }, { at: "2026-11-10T10:00:00Z", text: "Delivered, Front Door/Porch" }])), { state: "delivered", at: t("2026-11-10T10:00:00Z") });
  assert.deepEqual(parseYoycolDelivery(yTracking([{ at: "2026-11-01T10:00:00Z", text: "x" }, { at: "2026-11-10T10:00:00Z", text: "已签收" }])), { state: "delivered", at: t("2026-11-10T10:00:00Z") });
  // deliveryStatus 2 means nothing on its own (its values are undocumented)...
  const status3 = yTracking([{ at: "2026-11-01T10:00:00Z", text: "x" }, { at: "2026-11-08T10:00:00Z", text: "Arrived at post office" }], { deliveryStatus: 3 });
  assert.deepEqual(parseYoycolDelivery(status3), { state: "in_transit" });
  // ...until it's listed.
  assert.deepEqual(parseYoycolDelivery(status3, [3]), { state: "delivered", at: t("2026-11-08T10:00:00Z") });
});

// --- the being-made note ----------------------------------------------------------------------------

test("being made: once, 12–14 days after payment, only while the shorts haven't shipped and Yoycol says they're paid for", async () => {
  const paid = "2026-10-18T18:00:00.000Z";
  const order: Order = { record: recordOf(REF, [shorts()]), paidAt: paid, yoycol: Y_ID };
  assert.equal(beingMadeWindow(t(paid), t(paid) + 12 * DAY - 1), "early");
  assert.equal(beingMadeWindow(t(paid), t(paid) + 12 * DAY), "due");
  assert.equal(beingMadeWindow(t(paid), t(paid) + 15 * DAY - 1), "due");
  assert.equal(beingMadeWindow(t(paid), t(paid) + 15 * DAY), "late");

  const dir = dataDir([order]);
  const w = world();
  assert.deepEqual(outcomes(await runFollowups(deps(dir, w.fetch, "2026-10-30T17:59:00Z"))), []); // day 11.99
  assert.equal(supplierCalls(w.calls).length, 0);

  const s = await runFollowups(deps(dir, w.fetch, "2026-10-30T18:00:00Z"));
  assert.deepEqual(outcomes(s), [["being_made", REF, "sent"]]);
  const yc = supplierCalls(w.calls);
  assert.deepEqual(yc.map((c) => [c.method, c.url]), [["GET", `https://www.yoycol.com/api/2025/open/v4/orders/${Y_ID}`]]);
  assert.equal(yc[0].headers["X-API-Access-Key"], "AK_TEST");
  const [send] = sends(w.calls);
  assert.equal(send.body.subject, "Your Blue Sky Cotton Shorts are being made ☁️");
  assert.equal(send.headers["Idempotency-Key"], `mop-followup/being-made:${REF}`);
  assert.match(send.body.text, /^Hi Maya,\n\nYour Blue Sky Cotton Shorts are being made\./);
  assert.match(send.body.text, /About 3–4 weeks in total, from order to your door\.\nWe'll email tracking as soon as they ship\./);
  assert.match(send.body.text, /- Blue Sky Cotton Shorts \(L\)/);
  assert.equal(ledgerRows(dir).at(-1).key, `being-made:${REF}`);

  // Days 13 and 14: already sent. Day 15: past the window anyway.
  await runFollowups(deps(dir, w.fetch, "2026-10-31T18:00:00Z"));
  await runFollowups(deps(dir, w.fetch, "2026-11-01T18:00:00Z"));
  assert.equal(sends(w.calls).length, 1);
  const late = dataDir([order]);
  const w2 = world();
  assert.deepEqual(outcomes(await runFollowups(deps(late, w2.fetch, "2026-11-02T18:00:00Z"))), []);
  assert.equal(w2.calls.length, 0);
});

test("being made is skipped once the Yoycol parcel has shipped, while Yoycol says it's unpaid or cancelled, and for dry-run orders", async () => {
  const paid = "2026-10-18T18:00:00.000Z";
  const now = "2026-10-31T15:00:00Z";
  const shipped = shippedRow(REF, "2026-10-29T16:00:00.000Z", { key: `yoycol:${Y_ID}:9400111899223817364905`, supplier: "yoycol", order_id: Y_ID, shipment: "9400111899223817364905" });
  let dir = dataDir([{ record: recordOf(REF, [shorts()]), paidAt: paid, yoycol: Y_ID }], [shipped]);
  let w = world();
  let s = await runFollowups(deps(dir, w.fetch, now));
  assert.deepEqual(s.results.filter((r) => r.type === "being_made").map((r) => [r.outcome, r.reason]), [["skipped", "already shipped"]]);
  assert.equal(supplierCalls(w.calls).filter((c) => c.url.endsWith(`/orders/${Y_ID}`)).length, 0);
  assert.equal(sends(w.calls).filter((c) => /being made/.test(c.body.subject)).length, 0);

  dir = dataDir([{ record: recordOf(REF, [shorts()]), paidAt: paid, yoycol: Y_ID }]);
  w = world({ yoycolOrder: { [Y_ID]: yOrder({ canPay: true, status: "UNPAID", statusLabel: "Awaiting payment", paidAt: null }) } });
  const d = deps(dir, w.fetch, now);
  s = await runFollowups(d);
  assert.deepEqual(outcomes(s), [["being_made", REF, "held"]]);
  assert.match(d.logs.join("\n"), /NOT SENT: Yoycol order is still unpaid/);
  assert.equal(sends(w.calls).length, 0);

  w = world({ yoycolOrder: { [Y_ID]: yOrder({ status: "CANCELLED", statusLabel: "Cancelled" }) } });
  assert.deepEqual(outcomes(await runFollowups(deps(dir, w.fetch, now))), [["being_made", REF, "skipped"]]);

  w = world({ yoycolOrder: { [Y_ID]: { code: "310001", msg: "access denied" } } });
  s = await runFollowups(deps(dir, w.fetch, now));
  assert.deepEqual(outcomes(s), [["being_made", REF, "waiting"]]);
  assert.equal(s.errors, 1);

  dir = dataDir([{ record: recordOf(REF, [shorts()]), paidAt: paid, yoycol: "DRY-RUN", yoycolDry: true }, { record: recordOf(REF2, [tee()]), paidAt: paid, printful: PF_ID }]);
  w = world();
  assert.deepEqual(outcomes(await runFollowups(deps(dir, w.fetch, now))), []);
  assert.equal(w.calls.length, 0);

  assert.equal(parseYoycolOrderState(yOrder())?.state, "in_production");
  assert.equal(parseYoycolOrderState({ code: "100000", data: {} }), null);
});

// --- once, the switches, no backfill, dry runs, failures --------------------------------------------

test("idempotent: reruns, a fresh process, and a send that crashed mid-way are all one email per order", async () => {
  const orders: Order[] = [teeOrder(), { record: recordOf(REF2, [shorts()]), paidAt: "2026-10-20T18:00:00.000Z", yoycol: Y_ID }];
  const dir = dataDir(orders, [shippedRow(REF, "2026-10-22T16:05:00.000Z")]);
  const w = world({ printful: { [PF_ID]: [pfShipment({ delivery_status: "delivered", delivered_at: "2026-10-26T19:00:00Z" })] } });
  const now = "2026-11-02T15:00:00Z";
  const first = await runFollowups(deps(dir, w.fetch, now));
  assert.deepEqual(outcomes(first).sort(), [["being_made", REF2, "sent"], ["fit", REF, "sent"]]);
  // The same day again, the next day, and from a fresh process (new ledger object).
  await runFollowups(deps(dir, w.fetch, now));
  await runFollowups(deps(dir, w.fetch, "2026-11-03T15:00:00Z"));
  await runFollowups(deps(dir, w.fetch, "2026-11-03T16:00:00Z", ON, { ledger: createFollowupLedger(dir) }));
  assert.equal(sends(w.calls).length, 2);
  // Done orders cost no supplier calls.
  const callsBefore = supplierCalls(w.calls).length;
  await runFollowups(deps(dir, w.fetch, "2026-11-04T15:00:00Z"));
  assert.equal(supplierCalls(w.calls).length, callsBefore);

  // A crash between "sending" and "emailed": resumed after 10 minutes with the same idempotency key.
  const dir2 = dataDir([teeOrder()], [shippedRow(REF, "2026-10-22T16:05:00.000Z")]);
  writeFileSync(path.join(dir2, "followups-emailed.jsonl"), JSON.stringify({ at: "2026-11-02T14:00:00.000Z", status: "sending", key: `fit:${REF}`, order_ref: REF, type: "fit" }) + "\n");
  const w2 = world({ printful: { [PF_ID]: [pfShipment({ delivery_status: "delivered", delivered_at: "2026-10-26T19:00:00Z" })] } });
  const d2 = deps(dir2, w2.fetch, "2026-11-02T14:05:00Z");
  assert.deepEqual(outcomes(await runFollowups(d2)), [["fit", REF, "in_progress"]]);
  assert.deepEqual(outcomes(await runFollowups(deps(dir2, w2.fetch, "2026-11-02T14:11:00Z"))), [["fit", REF, "sent"]]);
  assert.equal(sends(w2.calls)[0].headers["Idempotency-Key"], `mop-followup/fit:${REF}`);
});

test("switches off (the default): nothing sent, nothing written; the log says what would go and to which domain only", async () => {
  const orders: Order[] = [teeOrder(), { record: recordOf(REF2, [shorts()]), paidAt: "2026-10-20T18:00:00.000Z", yoycol: Y_ID }];
  const dir = dataDir(orders, [shippedRow(REF, "2026-10-22T16:05:00.000Z")], null);
  const w = world({ printful: { [PF_ID]: [pfShipment({ delivery_status: "delivered", delivered_at: "2026-10-26T19:00:00Z" })] } });
  const d = deps(dir, w.fetch, "2026-11-02T15:00:00Z", {});
  const s = await runFollowups(d);
  assert.deepEqual(outcomes(s).sort(), [["being_made", REF2, "would_send"], ["fit", REF, "would_send"]]);
  assert.equal(sends(w.calls).length, 0);
  assert.equal(alerts(w.calls).length, 0);
  assert.equal(existsSync(path.join(dir, "followups-emailed.jsonl")), false);
  assert.equal(existsSync(path.join(dir, "followups-start.json")), false);
  const log = d.logs.join("\n");
  assert.match(log, /fit mop-5e1f0c2a[^\n]*: would send "How's it fit\? 📸" to an address at example\.com \(delivered: [^\n]*MOP_FOLLOWUP_FIT_ENABLED isn't 1/);
  assert.match(log, /being_made mop-7a8b9c0d[^\n]*: would send "Your Blue Sky Cotton Shorts are being made ☁️" to an address at example\.com[^\n]*MOP_FOLLOWUP_YOYCOL_ENABLED isn't 1/);
  assert.doesNotMatch(log, /maya\.castellano/);

  // Each switch on its own: only the fit email is on here.
  const dir2 = dataDir(orders, [shippedRow(REF, "2026-10-22T16:05:00.000Z")]);
  const s2 = await runFollowups(deps(dir2, w.fetch, "2026-11-02T15:00:00Z", { MOP_FOLLOWUP_FIT_ENABLED: "1", MOP_FOLLOWUP_YOYCOL_ENABLED: "true" }));
  assert.deepEqual(outcomes(s2).sort(), [["being_made", REF2, "would_send"], ["fit", REF, "sent"]]);
  assert.equal(sends(w.calls).length, 1);
});

test("no backfill: the first run switched on records the start; orders before it are skipped; --include-before opts them in", async () => {
  // Delivered 10/20 (before the switch goes on 10/24) and 10/26 (after).
  const early: Order = teeOrder();
  const later: Order = { record: recordOf(REF2, [tee()]), paidAt: "2026-10-19T18:00:00.000Z", printful: "190000002" };
  const dir = dataDir(
    [early, later],
    [shippedRow(REF, "2026-10-17T16:05:00.000Z"), shippedRow(REF2, "2026-10-22T16:05:00.000Z", { key: "printful:190000002:72000001", order_id: "190000002", shipment: "72000001" })],
    null
  );
  const w = world({
    printful: {
      [PF_ID]: [pfShipment({ shipped_at: "2026-10-17T16:00:00Z", delivery_status: "delivered", delivered_at: "2026-10-20T18:00:00Z" })],
      "190000002": [pfShipment({ delivery_status: "delivered", delivered_at: "2026-10-26T18:00:00Z" })],
    },
  });
  const d = deps(dir, w.fetch, "2026-10-24T14:30:00Z");
  await runFollowups(d);
  assert.deepEqual(readStart(dir), { fit: "2026-10-24T14:30:00.000Z", being_made: "2026-10-24T14:30:00.000Z" });
  assert.match(d.logs.join("\n"), /switched on for the first time; only orders delivered from now on count/);
  assert.equal(sends(w.calls).length, 0); // the 10/20 delivery is due 10/23 but came before the start

  const later1 = deps(dir, w.fetch, "2026-10-29T18:00:00Z");
  const s = await runFollowups(later1);
  assert.deepEqual(outcomes(s), [["fit", REF, "skipped"], ["fit", REF2, "sent"]]);
  assert.match(later1.logs.join("\n"), /not sending: delivered 2026-10-20, before 2026-10-24 \(no backfill; --include-before 2026-10-20 to send it\)/);
  // The start stays the first one, even after the switch goes off and on again.
  await runFollowups(deps(dir, w.fetch, "2026-10-30T18:00:00Z", {}));
  await runFollowups(deps(dir, w.fetch, "2026-10-31T18:00:00Z"));
  assert.equal(readStart(dir).fit, "2026-10-24T14:30:00.000Z");
  assert.equal(sends(w.calls).length, 1);

  const opted = await runFollowups(deps(dir, w.fetch, "2026-10-31T18:00:00Z", ON, { includeBefore: new Date("2026-10-15T00:00:00Z") }));
  assert.deepEqual(outcomes(opted), [["fit", REF, "sent"]]);
  assert.equal(gateFor("2026-10-24T14:30:00.000Z", new Date("2026-10-30T00:00:00Z")), t("2026-10-24T14:30:00.000Z")); // never later than the start
  assert.equal(gateFor(undefined, undefined), undefined);

  // The being-made note goes by the payment date.
  const dir2 = dataDir([{ record: recordOf(REF, [shorts()]), paidAt: "2026-10-18T18:00:00.000Z", yoycol: Y_ID }], [], { being_made: "2026-10-20T00:00:00.000Z" });
  const w2 = world();
  assert.deepEqual(outcomes(await runFollowups(deps(dir2, w2.fetch, "2026-10-31T15:00:00Z"))), [["being_made", REF, "skipped"]]);
  assert.equal(supplierCalls(w2.calls).length, 0);
});

test("--dry-run prints the emails, sends none, records no start, and works with the switches off", async () => {
  const dir = dataDir([teeOrder()], [shippedRow(REF, "2026-10-22T16:05:00.000Z")], null);
  const w = world({ printful: { [PF_ID]: [pfShipment({ delivery_status: "delivered", delivered_at: "2026-10-26T19:00:00Z" })] } });
  const d = deps(dir, w.fetch, "2026-10-30T15:00:00Z", {}, { dryRun: true });
  const s = await runFollowups(d);
  assert.deepEqual(outcomes(s), [["fit", REF, "dry_run"]]);
  assert.equal(sends(w.calls).length, 0);
  assert.match(d.logs.join("\n"), /DRY-RUN customer email \(not sent\)[\s\S]*To: maya\.castellano@example\.com[\s\S]*Subject: How's it fit\? 📸[\s\S]*Send us a photo of you wearing it\./);
  assert.equal(existsSync(path.join(dir, "followups-start.json")), false);
  assert.deepEqual(ledgerRows(dir).map((r) => r.status), ["sending", "dry_run"]); // not done
  // The real run afterwards still sends it.
  assert.deepEqual(outcomes(await runFollowups(deps(dir, w.fetch, "2026-10-30T15:00:00Z", ON, { includeBefore: new Date("2026-10-01T00:00:00Z") }))), [["fit", REF, "sent"]]);
});

test("a failed send is logged, not marked sent, alerts John once, and goes out on the next day's run", async () => {
  const dir = dataDir([teeOrder()], [shippedRow(REF, "2026-10-22T16:05:00.000Z")]);
  let down = true;
  const w = world({
    printful: { [PF_ID]: [pfShipment({ delivery_status: "delivered", delivered_at: "2026-10-26T19:00:00Z" })] },
    resend: (n) => (down ? { status: 500, json: { message: "Resend is down" } } : { status: 200, json: { id: `re_${n}` } }),
  });
  const s1 = await runFollowups(deps(dir, w.fetch, "2026-10-30T15:00:00Z"));
  assert.deepEqual(outcomes(s1), [["fit", REF, "failed"]]);
  assert.equal(s1.errors, 1);
  assert.equal(alerts(w.calls).length, 1);
  assert.equal(alerts(w.calls)[0].body.subject, `ACTION NEEDED: "How's it fit?" email failed for ${REF}`);
  assert.match(alerts(w.calls)[0].body.body, /Why: Resend HTTP 500: Resend is down[\s\S]*tries again tomorrow/);
  await runFollowups(deps(dir, w.fetch, "2026-10-31T15:00:00Z"));
  assert.equal(alerts(w.calls).length, 1); // told once
  down = false;
  assert.deepEqual(outcomes(await runFollowups(deps(dir, w.fetch, "2026-11-01T15:00:00Z"))), [["fit", REF, "sent"]]);
  assert.deepEqual(ledgerRows(dir).map((r) => r.status), ["sending", "failed", "sending", "failed", "sending", "emailed"]);
});

// --- the emails -------------------------------------------------------------------------------------------

test("the fit email: greeting, warm line, items with thumbnails, the photo button (mailto, subject filled in), make-it-right + Shipping & returns; no prices", () => {
  const record = recordOf(REF, [tee()]);
  const e = fitEmail({ name: record.customer.name, orderRef: REF, items: record.items.map((i) => displayFromRecordItem(i)), delivered: true });
  assert.equal(photoSubject(REF), "My MOP photo, order MOP-5E1F0C2A");
  assert.equal(photoMailto(REF), "mailto:orders@mopclothing.com?subject=My%20MOP%20photo%2C%20order%20MOP-5E1F0C2A");
  const href = /<a href="(mailto:[^"]+)"[^>]*>Send us a photo<\/a>/.exec(e.html)![1];
  assert.equal(href, photoMailto(REF));
  assert.equal(decodeURIComponent(new URL(href).searchParams.get("subject")!), "My MOP photo, order MOP-5E1F0C2A");
  assert.equal(new URL(href).pathname, "orders@mopclothing.com");
  assert.doesNotMatch(/<a href="mailto:[^>]+>/.exec(e.html)![0], /target=/); // no blank tab in webmail
  assert.match(e.html, /Hi Maya,/);
  assert.match(e.html, /How&#39;s it fit\?/);
  assert.match(e.html, /We hope it fits just right and that you love it\./);
  assert.match(e.html, /Send us a photo of you wearing it\./);
  assert.match(e.html, /We feature real customers in <a href="https:\/\/mopclothing\.com\/#out-in-the-wild"[^>]*>“Out in the wild”<\/a> on mopclothing\.com\./);
  assert.match(e.html, /<img src="https:\/\/mopclothing\.com\/images\/catalog\/pelican-tee\/[^"]+" width="72" height="72" alt="Pelican Tee"/);
  assert.match(e.html, /Big · Grind Beanie · Ivory · M/);
  assert.match(e.html, /Something not right\? Reply and we&#39;ll make it right\./);
  assert.match(e.html, /href="https:\/\/mopclothing\.com\/shipping-returns"[^>]*>Shipping &amp; returns</);
  assert.match(e.html, /MOP-5E1F0C2A/);
  assert.match(e.text, /Email it to orders@mopclothing\.com with the subject "My MOP photo, order MOP-5E1F0C2A", or just reply with it\./);
  assert.match(e.text, /Something not right\? Reply and we'll make it right\.\nHow replacements and returns work: https:\/\/mopclothing\.com\/shipping-returns/);
  for (const s of [e.html, e.text, e.subject, e.preheader]) assert.doesNotMatch(s, /\$\d|USD|Total|Subtotal/);
  for (const [, src] of Array.from(e.html.matchAll(/<img[^>]+src="([^"]+)"/g))) assert.match(src, /^https:\/\/mopclothing\.com\//);
  // Names are escaped.
  assert.doesNotMatch(fitEmail({ name: "<b>x</b>", orderRef: REF, items: [], delivered: false }).html, /<b>x/);
});

test("the being-made email: headline, the 3–4 weeks, 'we'll email tracking', the item; singular and plural; no prices", () => {
  const items = [displayFromRecordItem(shorts())];
  const e = beingMadeEmail({ name: "Maya Castellano", orderRef: REF, items, total: "about 3–4 weeks" });
  assert.equal(e.subject, "Your Blue Sky Cotton Shorts are being made ☁️");
  assert.match(e.html, /Your Blue Sky Cotton Shorts are being made\./);
  assert.match(e.html, /From order to your door/);
  assert.match(e.html, /About <span style="white-space:nowrap;">3–4 weeks<\/span> in total/);
  assert.match(e.html, /We&#39;ll email tracking as soon as they ship\./);
  assert.match(e.html, /src="https:\/\/mopclothing\.com\/images\/blue-sky-cotton-shorts\/worn-front-shorts-crop-v2\.webp"/);
  assert.doesNotMatch(e.html + e.text, /sorry|apolog|delay/i);
  for (const s of [e.html, e.text, e.subject, e.preheader]) assert.doesNotMatch(s, /\$\d|USD/);
  assert.deepEqual(beingMadeSubject([{ title: "Clouds In Sky Shirt", options: "L", qty: 1 }]), { what: "Clouds In Sky Shirt", plural: false });
  assert.deepEqual(beingMadeSubject([{ title: "Clouds In Sky Shirt", options: "L", qty: 2 }]), { what: "Clouds In Sky Shirts", plural: true });
  assert.deepEqual(beingMadeSubject([...items, { title: "Clouds In Sky Shirt", options: "L", qty: 1 }]), { what: "made-to-order pieces", plural: true });
  const one = beingMadeEmail({ name: "", orderRef: REF, items: [{ title: "Clouds In Sky Shirt", options: "L", qty: 1 }], total: "about 3–4 weeks" });
  assert.match(one.text, /^Hi there,\n\nYour Clouds In Sky Shirt is being made\. A quick update: it's made to order, just for you, so it takes a little longer than a regular tee\./);
  assert.match(one.text, /We'll email tracking as soon as it ships\./);
});

test("all four customer emails share the same head, header band and footer (confirmation, shipped, fit, being made)", () => {
  const record = recordOf(REF, [tee(), shorts()]);
  const items = record.items.map((i) => displayFromRecordItem(i));
  const emails = {
    confirmation: confirmationEmail(confirmationInput(record)),
    shipped: shippedEmail({ name: record.customer.name, orderRef: REF, kind: "part", shipDate: "2026-10-22", tracking: buildTracking({ number: "9400111899223817364905", carrier: "USPS" }), items: [items[0]] }),
    fit: fitEmail({ name: record.customer.name, orderRef: REF, items, delivered: true }),
    beingMade: beingMadeEmail({ name: record.customer.name, orderRef: REF, items: [items[1]], total: "about 3–4 weeks" }),
  };
  const head = (h: string) => h.slice(0, h.indexOf("</head>")).replace(/<title>[^<]*<\/title>/, "");
  const band = (h: string) => h.slice(h.indexOf("</head>"), h.indexOf('<tr><td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:0 0 18px 18px;')).replace(/(mso-hide:all[^>]*>)[\s\S]*?<\/div>/, "$1</div>"); // minus the preheader text
  const foot = (h: string) => h.slice(h.lastIndexOf('\n</table>\n</td></tr>\n\n<tr><td align="center"'));
  const ref = emails.confirmation.html;
  for (const [name, e] of Object.entries(emails)) {
    assert.equal(head(e.html), head(ref), name);
    assert.equal(band(e.html), band(ref), name);
    assert.equal(foot(e.html), foot(ref), name);
    assert.ok(e.html.includes(emailHeader()), name);
    assert.ok(e.html.includes(emailFooter(REF)), name);
    assert.ok(e.text.endsWith(textFooter(REF).join("\n")), name);
    assert.match(e.html, /Hi Maya,/, name);
    assert.match(e.html, /Order <b[^>]*>MOP-5E1F0C2A<\/b>/, name);
  }
  // The same item row (thumbnail tile, name) everywhere it appears.
  const teeImg = /<img src="https:\/\/mopclothing\.com\/images\/catalog\/pelican-tee\/[^"]+" width="72" height="72" alt="Pelican Tee" style="[^"]+" class="mop-tile">/;
  assert.equal(emails.fit.html.match(teeImg)![0], emails.shipped.html.match(teeImg)![0]);
  // The shipped email's button and the fit email's are the same button.
  const button = (h: string) => /<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">\n<tr><td[^>]+>/.exec(h)![0];
  assert.equal(button(emails.fit.html), button(emails.shipped.html));
});

// --- the script --------------------------------------------------------------------------------------------

test("scripts/followup-emails.mjs: arguments, and a run over a data dir with the switches off (no keys, no network)", () => {
  const run = (dir: string, args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(ROOT, "scripts", "followup-emails.mjs"), ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", MOP_DATA_DIR: dir, ...env } as unknown as NodeJS.ProcessEnv,
    });
  const empty = tmpDir();
  const help = run(empty, ["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /usage: followup-emails\.mjs \[--dry-run\] \[--include-before YYYY-MM-DD\] \[--verbose\]/);
  assert.equal(run(empty, ["--include-before"]).status, 2);
  assert.equal(run(empty, ["--include-before", "2026-02-30"]).status, 2);
  assert.equal(run(empty, ["--bogus"]).status, 2);
  const none = run(empty, []);
  assert.equal(none.status, 0, none.stdout + none.stderr);
  assert.match(none.stdout, /"How's it fit\?": nothing due/);

  // An order shipped 13 days ago (real clock): Printful can't be asked (no token here), so the
  // shipped email + 12 days decides. Off: logged, not sent, nothing written.
  const shippedAt = new Date(Date.now() - 13 * DAY).toISOString();
  const dir = dataDir([teeOrder({ paidAt: new Date(Date.now() - 16 * DAY).toISOString() })], [shippedRow(REF, shippedAt)], null);
  const off = run(dir, []);
  assert.equal(off.status, 1, off.stdout); // the Printful lookup failed (no token): exit 1
  assert.match(off.stdout, /PRINTFUL_API_TOKEN is not set/);
  assert.match(off.stdout, /would send "How's it fit\? 📸" to an address at example\.com/);
  assert.match(off.stdout, /"How's it fit\?": 1 would send \(off\)/);
  assert.equal(existsSync(path.join(dir, "followups-emailed.jsonl")), false);
  assert.equal(existsSync(path.join(dir, "followups-start.json")), false);

  const dry = run(dir, ["--dry-run"]);
  assert.match(dry.stdout, /DRY-RUN customer email \(not sent\)[\s\S]*Subject: How's it fit\? 📸/);
  assert.match(dry.stdout, /"How's it fit\?": 1 dry run/);
  assert.equal(existsSync(path.join(dir, "followups-start.json")), false);
});
