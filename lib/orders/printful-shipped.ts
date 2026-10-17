// Printful -> "your order has shipped" email to the customer.
//
// Webhook: POST https://mopclothing.com/api/printful-webhook/<PRINTFUL_WEBHOOK_TOKEN>
// (app/api/printful-webhook/[token]/route.ts), registered for "package_shipped".
// Printful v1 webhooks aren't signed, so the secret is the URL token (compared
// in constant time; a wrong one gets a 404) and the payload is never trusted:
// only its order id is read, and the order is re-fetched from the Printful API
// (GET /orders/{id}, our PRINTFUL_API_TOKEN). Shipments, tracking, items and the
// recipient all come from that response.
//
// Who gets the email: the order's external_id is our order ref. An exact match
// in orders.jsonl gives the email and name the customer typed at checkout;
// failing that (an order re-placed by hand, e.g. "mop-…a8r1" for "mop-…a82c"),
// the recipient on the re-fetched Printful order. Never any other address, and
// never a guess from a similar ref. Orders whose external_id isn't a site ref
// (samples, orders made in the dashboard) get nothing.
//
// Each shipment of the order that hasn't been emailed gets its own email listing
// only what's in that box (shipments.ts keeps it to one per shipment, through
// Printful's retries). scripts/send-shipped-email.mjs runs the same path by hand
// for orders that shipped before the webhook existed.
import crypto from "node:crypto";
import { describeFailure, isRetryable, requestJson, sleep, type FetchLike } from "./http.ts";
import { sendEmail } from "./notify.ts";
import { PRINTFUL_API } from "./printful.ts";
import { buildTracking } from "./tracking.ts";
import { displayFromPrintfulItem, type PrintfulItemLike } from "./item-display.ts";
import {
  deliverPackage,
  findOrderRecord,
  shipmentKind,
  type CustomerSource,
  type DeliverResult,
  type ShipmentLedger,
} from "./shipments.ts";
import type { OrderRecord } from "./types.ts";

export type HandleResult = { status: number; body: Record<string, unknown> };

export type PrintfulShippedDeps = {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  now: () => Date;
  log: (msg: string) => void;
  /** $MOP_DATA_DIR (orders.jsonl). */
  dir: string;
  ledger: ShipmentLedger;
  retryDelayMs?: number;
};

/** A shipment older than this when we first see it isn't emailed by the webhook (it has likely arrived). */
export const WEBHOOK_MAX_AGE_DAYS = 30;

/** Printful retries a non-2xx webhook after 1, 4, 16, 64, 256 and 1024 minutes. */
export const PRINTFUL_RETRY_NOTE =
  "Printful retries the webhook (after 1, 4, 16, 64, 256 and 1024 minutes) and the email goes out when it works. " +
  "Or send it by hand: scripts/send-shipped-email.mjs --printful-order <id> (DEPLOY.md).";

/** The URL token, compared in constant time (hashes, so a length difference leaks nothing). */
export function tokenMatches(given: unknown, expected: string | undefined) {
  if (typeof given !== "string" || !given || !expected) return false;
  const h = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

/** Our refs: "mop-" + 28 hex, or a hand re-placed one with a suffix ("…a8r1"). */
export const isSiteRef = (ref: unknown): ref is string => typeof ref === "string" && /^mop-[0-9a-z]{8,40}$/i.test(ref);

const headers = (env: Record<string, string | undefined>) => ({
  Authorization: `Bearer ${env.PRINTFUL_API_TOKEN}`,
  ...(env.PRINTFUL_STORE_ID ? { "X-PF-Store-Id": env.PRINTFUL_STORE_ID } : {}),
});

export type FetchedOrder = { ok: boolean; order?: any; status?: number; error?: string; retryable?: boolean };

/** GET https://api.printful.com/orders/{id}, retried once on a network error / 429 / 5xx. */
export async function fetchPrintfulOrder(
  orderId: string,
  deps: Pick<PrintfulShippedDeps, "env" | "fetch" | "log" | "retryDelayMs">
): Promise<FetchedOrder> {
  if (!deps.env.PRINTFUL_API_TOKEN) return { ok: false, status: 0, error: "PRINTFUL_API_TOKEN is not set", retryable: false };
  const url = `${PRINTFUL_API}/orders/${encodeURIComponent(orderId)}`;
  const get = () => requestJson(deps.fetch, url, { method: "GET", headers: headers(deps.env) });
  let r = await get();
  if (!r.ok && isRetryable(r)) {
    deps.log(`[shipping] Printful order ${orderId}: ${describeFailure(r)}; retrying once`);
    await sleep(deps.retryDelayMs ?? 2000);
    r = await get();
  }
  const order = r.json?.result;
  if (r.ok && order && typeof order === "object" && String(order.id) === String(orderId)) return { ok: true, order };
  return { ok: false, status: r.status, error: r.ok ? "unexpected response (no order)" : describeFailure(r), retryable: !r.ok && isRetryable(r) };
}

/** Who gets the email: our order record (exact ref only), else the re-fetched Printful order's recipient. */
export function resolveCustomer(order: any, record: OrderRecord | undefined): { to: string; name: string; source: CustomerSource } {
  const recip = order?.recipient ?? {};
  const fromRecord = record?.customer?.email?.trim();
  if (fromRecord) return { to: fromRecord, name: record!.customer.name || String(recip.name ?? ""), source: "order_record" };
  return { to: String(recip.email ?? "").trim(), name: String(recip.name ?? "").trim(), source: "printful_recipient" };
}

const shipTime = (s: any) => {
  const t = Number(s?.shipped_at) || Number(s?.created);
  if (t) return t * 1000;
  const d = typeof s?.ship_date === "string" ? Date.parse(`${s.ship_date}T12:00:00Z`) : NaN;
  return Number.isNaN(d) ? 0 : d;
};

const ymd = (s: any) => {
  if (typeof s?.ship_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.ship_date)) return s.ship_date as string;
  const t = shipTime(s);
  return t ? new Date(t).toISOString().slice(0, 10) : undefined;
};

const shipmentId = (s: any) => (s?.id != null && String(s.id) ? String(s.id) : String(s?.tracking_number ?? "").trim());

export type ShipmentOutcome = DeliverResult | { key: string; status: "too_old" };

/**
 * Email every shipment of this (re-fetched) Printful order that hasn't been
 * emailed: one email per box, listing that box's items only.
 */
export async function emailPrintfulShipments(
  order: any,
  deps: PrintfulShippedDeps,
  opts: { maxAgeDays?: number; retryNote?: string } = {}
): Promise<{ ref: string; source?: CustomerSource; results: ShipmentOutcome[]; ignored?: string }> {
  const { log } = deps;
  const ref = order?.external_id;
  const orderId = String(order?.id);
  if (!isSiteRef(ref)) {
    log(`[shipping] Printful order ${orderId}: external_id ${JSON.stringify(ref ?? null)} isn't a site order ref; no customer email`);
    return { ref: String(ref ?? ""), results: [], ignored: "not a site order" };
  }
  const record = findOrderRecord(deps.dir, ref);
  const customer = resolveCustomer(order, record);
  if (!record) log(`[shipping] ${ref}: no exact order record (re-placed by hand?); using the Printful order's recipient`);

  const items: PrintfulItemLike[] = Array.isArray(order.items) ? order.items : [];
  const byId = new Map(items.map((i) => [Number(i.id), i]));
  const totalQty = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const shipments: any[] = (Array.isArray(order.shipments) ? order.shipments : []).filter((s: any) => shipmentId(s));
  shipments.sort((a, b) => shipTime(a) - shipTime(b) || Number(a.id) - Number(b.id));
  const otherSuppliers = Array.from(new Set((record?.items ?? []).map((i) => i.supplier).filter((s) => s !== "printful")));
  const recordItems = record?.items ?? [];

  const results: ShipmentOutcome[] = [];
  let shippedQty = 0;
  for (let n = 0; n < shipments.length; n++) {
    const s = shipments[n];
    const boxItems: { item: PrintfulItemLike; qty: number }[] =
      Array.isArray(s.items) && s.items.length
        ? s.items.map((si: any) => ({ item: byId.get(Number(si.item_id)) ?? { name: "Item" }, qty: Number(si.quantity) || 1 }))
        : items.map((i) => ({ item: i, qty: Number(i.quantity) || 1 }));
    if (!s.reshipment) shippedQty += boxItems.reduce((q, b) => q + b.qty, 0);
    const key = { supplier: "printful" as const, orderId, shipment: shipmentId(s) };

    const age = deps.now().getTime() - shipTime(s);
    if (opts.maxAgeDays != null && shipTime(s) && age > opts.maxAgeDays * 86_400_000) {
      log(`[shipping] ${ref}: shipment ${key.shipment} shipped ${ymd(s)}, over ${opts.maxAgeDays} days ago; not emailing it from the webhook`);
      results.push({ key: `printful:${orderId}:${key.shipment}`, status: "too_old" });
      continue;
    }
    const kind = shipmentKind({
      reshipment: !!s.reshipment,
      completesSupplier: totalQty === 0 || shippedQty >= totalQty,
      earlierBoxes: shipments.slice(0, n).some((p) => !p.reshipment),
      otherSuppliers,
      emailedSuppliers: await deps.ledger.emailedSuppliers(ref),
    });
    results.push(
      await deliverPackage(
        {
          key,
          orderRef: ref,
          to: customer.to,
          toSource: customer.source,
          email: {
            name: customer.name,
            orderRef: ref,
            kind,
            shipDate: ymd(s),
            tracking: buildTracking({ number: s.tracking_number, carrier: s.carrier, service: s.service, url: s.tracking_url }),
            items: boxItems.map((b) => displayFromPrintfulItem(b.item, b.qty, recordItems)),
          },
        },
        { ...deps, retryNote: opts.retryNote ?? PRINTFUL_RETRY_NOTE }
      )
    );
  }
  if (!shipments.length) log(`[shipping] ${ref}: Printful order ${orderId} has no shipments yet`);
  return { ref, source: customer.source, results };
}

const alertJohn = (subject: string, body: string, deps: PrintfulShippedDeps) =>
  sendEmail({ subject, body, html: "" }, { env: deps.env, fetch: deps.fetch, log: deps.log, retryDelayMs: deps.retryDelayMs })
    .then((r) => {
      if (!r.ok) deps.log(`[shipping] could not alert John: ${r.error}`);
    })
    .catch(() => undefined);

/** The webhook: token check, package_shipped only, re-fetch, email. */
export async function handlePrintfulWebhook(token: string, rawBody: string, deps: PrintfulShippedDeps): Promise<HandleResult> {
  const { env, log } = deps;
  if (!tokenMatches(token, env.PRINTFUL_WEBHOOK_TOKEN)) {
    if (!env.PRINTFUL_WEBHOOK_TOKEN) log("[shipping] PRINTFUL_WEBHOOK_TOKEN is not set: Printful webhook refused (404)");
    return { status: 404, body: { error: "not found" } };
  }
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid JSON" } };
  }
  const type = typeof event?.type === "string" ? event.type : "";
  if (type !== "package_shipped") return { status: 200, body: { received: true, ignored: type || "no type" } };

  // The only thing read from the payload: which order to look at (and, as a hint, which shipment).
  const orderId = String(event?.data?.order?.id ?? "");
  const hintShipment = event?.data?.shipment?.id != null ? String(event.data.shipment.id) : undefined;
  if (!/^\d{1,15}$/.test(orderId)) {
    log(`[shipping] package_shipped without a usable order id; ignored`);
    return { status: 200, body: { received: true, ignored: "no order id" } };
  }
  const lastTry = Number(event?.retries) >= 6;

  const fetched = await fetchPrintfulOrder(orderId, deps);
  if (!fetched.ok) {
    log(`[shipping] Printful order ${orderId}: could not re-fetch it: ${fetched.error}`);
    if (fetched.status === 404) return { status: 200, body: { received: true, ignored: "order not found" } };
    // A transient failure: Printful retries; John hears only when it gives up. A config problem: John hears now.
    if (!fetched.retryable || lastTry) {
      await alertJohn(
        `ACTION NEEDED: shipped email failed for Printful order ${orderId}`,
        `A package_shipped webhook came in, but the order couldn't be read from Printful: ${fetched.error}\n` +
          `${lastTry ? "Printful has stopped retrying." : "Printful will retry, but this looks like a setup problem (token / store id)."}\n` +
          `Once fixed, send it by hand: scripts/send-shipped-email.mjs --printful-order ${orderId} (DEPLOY.md).`,
        deps
      );
    }
    return { status: 502, body: { error: "could not read the order from Printful" } };
  }

  const { ref, results, ignored } = await emailPrintfulShipments(fetched.order, deps, { maxAgeDays: WEBHOOK_MAX_AGE_DAYS });
  if (ignored) return { status: 200, body: { received: true, ignored } };
  const summary = results.map((r) => ({ package: r.key.split(":").pop(), status: r.status }));
  const known = new Set(results.map((r) => r.key.split(":").pop()));

  if (results.some((r) => r.status === "in_progress")) return { status: 409, body: { received: true, in_progress: true, order_ref: ref, shipments: summary } };
  if (results.some((r) => r.status === "failed" && "retryable" in r && r.retryable))
    return { status: 500, body: { error: "email failed; will retry", order_ref: ref, shipments: summary } };
  // The event named a shipment the order doesn't show yet: ask Printful to come back.
  if (hintShipment && !known.has(hintShipment)) {
    log(`[shipping] ${ref}: the event's shipment ${hintShipment} isn't on the order yet; asking Printful to retry`);
    return { status: 503, body: { received: true, retry: "shipment not on the order yet", order_ref: ref, shipments: summary } };
  }
  return { status: 200, body: { received: true, order_ref: ref, shipments: summary } };
}
