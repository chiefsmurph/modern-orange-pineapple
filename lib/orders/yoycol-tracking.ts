// Yoycol -> "your order has shipped" email. Yoycol has no webhooks, so
// scripts/yoycol-tracking.mjs runs this from cron once or twice a day.
//
// It reads $MOP_DATA_DIR/orders-state.json (never writes it: the site owns it)
// for Yoycol orders the webhook created, skips any already emailed
// (shipments-emailed.jsonl), and asks Yoycol for each one's tracking:
//   GET https://www.yoycol.com/api/2025/open/v4/orders/{orderId}/tracking
// signed like order creation (yoycol.ts). Once a tracking number exists the
// customer gets the same email as Printful's, listing the order's Yoycol items.
//
// FROM YOYCOL'S OPEN API SPEC (v2025.11, schema SelfStoreOrderTrackingResponse),
// NOT YET SEEN ON A REAL SHIPPED ORDER (no Yoycol order has shipped through the API yet):
//   data.waybillCode    "Primary waybill code" (the cross-border number, e.g. YunExpress YT…)
//   data.tailTrackCode  "Tail tracking code" (the last-mile number, e.g. USPS)
//   data.carrier        "Carrier code";  data.lpName / lpCode  "Logistics provider name / code"
//   data.deliveryLevel  "Delivery level";  data.deliveryStatus  integer, values undocumented
// TODO(yoycol): check these against the first real shipped order (`--order <ref> --dry-run`
// prints what Yoycol returned) and adjust parseYoycolTracking if the fields differ:
//   - which number customers should get (tail when present, else the waybill, is a guess);
//   - what the response looks like before anything has shipped (empty strings, null data
//     or an error code are all treated as "not shipped yet");
//   - whether deliveryLevel is a name ("Standard Shipping") or a level code (both handled).
import { describeFailure, requestJson, type FetchLike, type HttpResult } from "./http.ts";
import { YOYCOL_API, yoycolHeaders } from "./yoycol.ts";
import { buildTracking, cleanTrackingNumber, type Tracking } from "./tracking.ts";
import { displayFromRecordItem } from "./item-display.ts";
import { deliverPackage, shipmentKind, type DeliverResult, type ShipmentLedger } from "./shipments.ts";
import type { SessionEntry } from "./store.ts";
import type { OrderRecord } from "./types.ts";

export const yoycolTrackingPath = (orderId: string) => `/api/2025/open/v4/orders/${orderId}/tracking`;
export const yoycolOrderPath = (orderId: string) => `/api/2025/open/v4/orders/${orderId}`;

/** A signed GET of one Open API path (no query), e.g. yoycolTrackingPath(id). Null when the keys aren't set. */
export async function yoycolGet(
  apiPath: string,
  deps: { env: Record<string, string | undefined>; fetch: FetchLike }
): Promise<HttpResult | null> {
  const accessKey = deps.env.YOYCOL_ACCESS_KEY;
  const secretKey = deps.env.YOYCOL_SECRET_KEY;
  if (!accessKey || !secretKey) return null;
  return requestJson(deps.fetch, `${YOYCOL_API}${apiPath}`, {
    method: "GET",
    headers: yoycolHeaders({ method: "GET", path: apiPath, accessKey, secretKey }),
  });
}

/** Yoycol's shipping level codes (lib/orders/yoycol.ts) -> names, in case deliveryLevel is a code. */
const LEVEL_NAMES: Record<string, string> = {
  vSt5rbZe: "Standard Shipping",
  KnoKgcyh: "YunExpress",
  zIdTU7JF: "Fast Shipping",
  Ut3dML9C: "Express Shipping",
  "505HjuNb": "US Fast Shipping",
};

export type YoycolTracking = Tracking & { waybill?: string; tail?: string; deliveryStatus?: number };

/**
 * GET /orders/{id}/tracking -> the package's tracking, or null while there's
 * no number yet (or Yoycol answered with an error). See the TODO above.
 */
export function parseYoycolTracking(json: any): YoycolTracking | null {
  if (!json || String(json.code) !== "100000" || !json.data || typeof json.data !== "object") return null;
  const d = json.data;
  const tail = cleanTrackingNumber(d.tailTrackCode);
  const waybill = cleanTrackingNumber(d.waybillCode);
  const number = tail || waybill;
  if (!number) return null;
  // A level shows only as a name: a known code is translated, an unknown code (no spaces) is dropped.
  const rawLevel = typeof d.deliveryLevel === "string" ? d.deliveryLevel.trim() : "";
  const level = LEVEL_NAMES[rawLevel] ?? (/\s/.test(rawLevel) ? rawLevel : undefined);
  const t = buildTracking({
    number,
    // The tail number is the last-mile carrier's ("carrier code"); the waybill is the logistics provider's.
    carrier: tail ? d.carrier || d.lpName || d.lpCode : d.lpName || d.lpCode || d.carrier,
    service: level,
  });
  if (!t) return null;
  return {
    ...t,
    waybill: waybill || undefined,
    tail: tail || undefined,
    deliveryStatus: typeof d.deliveryStatus === "number" ? d.deliveryStatus : undefined,
  };
}

// ---- delivered? (for the "How's it fit?" email, followups.ts) ----
// UNVERIFIED, from the same spec: deliveryStatus is "Delivery status / 发货状态"
// (发货 = dispatch, so it may only mean shipped) and its values are undocumented,
// so no value counts as delivered unless MOP_YOYCOL_DELIVERED_STATUS lists it
// (e.g. "3", once a real delivered order shows which number it is). Otherwise a
// head/tail tracking event that says delivered ("Delivered", "已签收", "妥投") does.
// TODO(yoycol): check against the first delivered order (`--verbose` on the follow-up script).

const DELIVERED_EVENT = /\bdelivered\b|已签收|签收成功|妥投/i;
const NOT_DELIVERED_EVENT = /out for delivery|attempt|not delivered|undeliver|unable|fail|exception|return|delay|notice left/i;

/** "3, 4" -> [3, 4]: the deliveryStatus values that mean delivered (none by default). */
export const deliveredStatuses = (env: Record<string, string | undefined>) =>
  (env.MOP_YOYCOL_DELIVERED_STATUS ?? "")
    .split(/[,\s]+/)
    .filter((s) => /^\d+$/.test(s))
    .map(Number);

export type YoycolDelivery =
  /** delivered: a delivered event (or a listed deliveryStatus) at `at` (ms). */
  | { state: "delivered"; at: number }
  /** moving: tracking events but none says delivered yet. */
  | { state: "in_transit" }
  /** no events: the carrier isn't reporting (or nothing has shipped). */
  | { state: "no_report" };

/** GET /orders/{id}/tracking -> delivered (with when), in transit, or no report. */
export function parseYoycolDelivery(json: any, statuses: number[] = []): YoycolDelivery {
  const d = json && String(json.code) === "100000" && json.data && typeof json.data === "object" ? json.data : null;
  if (!d) return { state: "no_report" };
  const events = [...(Array.isArray(d.headTrackingEvents) ? d.headTrackingEvents : []), ...(Array.isArray(d.tailTrackingEvents) ? d.tailTrackingEvents : [])]
    .map((e: any) => ({ at: Number(e?.occurDate), text: String(e?.description ?? "") }))
    .filter((e) => Number.isFinite(e.at) && e.at > 0)
    .sort((a, b) => a.at - b.at);
  const delivered = events.filter((e) => DELIVERED_EVENT.test(e.text) && !NOT_DELIVERED_EVENT.test(e.text)).pop();
  if (delivered) return { state: "delivered", at: delivered.at };
  // A listed status with no event to date it: the last event's time, else we can't say when.
  if (typeof d.deliveryStatus === "number" && statuses.includes(d.deliveryStatus) && events.length)
    return { state: "delivered", at: events[events.length - 1].at };
  return events.length ? { state: "in_transit" } : { state: "no_report" };
}

// ---- paid / cancelled? (for the "being made" note, followups.ts) ----
// GET /api/2025/open/v4/orders/{orderId} -> data.order (OrderSummaryDTO): canPay,
// paidAt, status / statusLabel. UNVERIFIED like the rest: Yoycol orders are created
// unpaid and nothing is made until John pays, so `canPay: true` (or a status that
// says unpaid) = not being made yet; a status that says cancelled / refunded / closed
// = not being made at all.

export type YoycolOrderState = { state: "in_production" | "unpaid" | "cancelled"; label: string };

export function parseYoycolOrderState(json: any): YoycolOrderState | null {
  const o = json && String(json.code) === "100000" ? json.data?.order : null;
  if (!o || typeof o !== "object") return null;
  const label = [o.statusLabel, o.status].filter((s) => typeof s === "string" && s.trim()).join(" / ") || `orderStatus ${o.orderStatus ?? "?"}`;
  if (/cancel|refund|closed|void/i.test(label)) return { state: "cancelled", label };
  if (o.canPay === true || /unpaid|not paid|to be paid|pending payment|awaiting payment/i.test(label)) return { state: "unpaid", label };
  return { state: "in_production", label };
}

export type OpenYoycolOrder = { sessionId: string; orderId: string; orderNo?: string; record: OrderRecord };

/** Yoycol orders the webhook created (not dry runs), placed within `maxAgeDays`. */
export function openYoycolOrders(
  state: { sessions?: Record<string, SessionEntry> } | null | undefined,
  now: Date,
  maxAgeDays: number
): OpenYoycolOrder[] {
  const out: OpenYoycolOrder[] = [];
  for (const [sessionId, e] of Object.entries(state?.sessions ?? {})) {
    const y = e?.suppliers?.yoycol;
    if (!y?.ok || y.dryRun || !y.id || !/^\d{1,20}$/.test(y.id) || !e.record) continue;
    const placed = Date.parse(e.record.created);
    if (Number.isFinite(placed) && now.getTime() - placed > maxAgeDays * 86_400_000) continue;
    out.push({ sessionId, orderId: y.id, orderNo: y.number, record: e.record });
  }
  return out;
}

export type YoycolCheckDeps = {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  now: () => Date;
  log: (msg: string) => void;
  ledger: ShipmentLedger;
  /** Parsed orders-state.json. */
  state: { sessions?: Record<string, SessionEntry> } | null;
  maxAgeDays?: number;
  /** Only this order ref. */
  onlyRef?: string;
  /** Print what Yoycol returned (for checking the fields). */
  verbose?: boolean;
  retryDelayMs?: number;
};

export type YoycolCheckSummary = {
  checked: number;
  waiting: number;
  errors: number;
  results: (DeliverResult & { ref: string })[];
};

export const YOYCOL_RETRY_NOTE =
  "the Yoycol tracking check (cron, scripts/yoycol-tracking.mjs) tries again on its next run and sends it when it works.";

export async function checkYoycolTracking(deps: YoycolCheckDeps): Promise<YoycolCheckSummary> {
  const { env, log, ledger } = deps;
  const summary: YoycolCheckSummary = { checked: 0, waiting: 0, errors: 0, results: [] };
  const accessKey = env.YOYCOL_ACCESS_KEY;
  const secretKey = env.YOYCOL_SECRET_KEY;
  if (!accessKey || !secretKey) {
    log("[yoycol-tracking] YOYCOL_ACCESS_KEY / YOYCOL_SECRET_KEY are not set");
    summary.errors++;
    return summary;
  }
  const open = openYoycolOrders(deps.state, deps.now(), deps.maxAgeDays ?? 60).filter(
    (o) => !deps.onlyRef || o.record.order_ref === deps.onlyRef
  );
  for (const o of open) {
    const ref = o.record.order_ref;
    if (await ledger.orderEmailed("yoycol", o.orderId)) continue;
    summary.checked++;
    const r = (await yoycolGet(yoycolTrackingPath(o.orderId), deps))!;
    if (deps.verbose) log(`[yoycol-tracking] ${ref}: Yoycol ${o.orderNo ?? o.orderId} tracking response: ${r.text.slice(0, 2000)}`);
    if (!r.ok) {
      log(`[yoycol-tracking] ${ref}: Yoycol order ${o.orderNo ?? o.orderId}: ${describeFailure(r)}`);
      summary.errors++;
      continue;
    }
    const tracking = parseYoycolTracking(r.json);
    if (!tracking) {
      summary.waiting++;
      if (String(r.json?.code) !== "100000") log(`[yoycol-tracking] ${ref}: Yoycol code ${r.json?.code}: ${r.json?.msg ?? ""} (treated as not shipped yet)`);
      continue;
    }
    const items = o.record.items.filter((i) => i.supplier === "yoycol");
    const otherSuppliers = Array.from(new Set(o.record.items.map((i) => i.supplier).filter((s) => s !== "yoycol")));
    const kind = shipmentKind({
      completesSupplier: true, // one parcel per Yoycol order
      earlierBoxes: false,
      otherSuppliers,
      emailedSuppliers: await ledger.emailedSuppliers(ref),
    });
    const result = await deliverPackage(
      {
        key: { supplier: "yoycol", orderId: o.orderId, shipment: tracking.number },
        orderRef: ref,
        to: o.record.customer.email,
        toSource: "order_record",
        email: {
          name: o.record.customer.name,
          orderRef: ref,
          kind,
          tracking,
          items: items.map((i) => displayFromRecordItem(i)),
        },
      },
      { env, fetch: deps.fetch, log, now: deps.now, ledger, retryDelayMs: deps.retryDelayMs, retryNote: YOYCOL_RETRY_NOTE }
    );
    summary.results.push({ ...result, ref });
    if (result.status === "failed") summary.errors++;
  }
  return summary;
}
