// Printful order creation (API v1, POST https://api.printful.com/orders).
//
// - Auth: the MOP store's private token (PRINTFUL_API_TOKEN). If the token is
//   account-wide instead, set PRINTFUL_STORE_ID so the X-PF-Store-Id header picks the store.
// - Orders are DRAFTS unless PRINTFUL_AUTO_CONFIRM=true: John reviews and
//   confirms them in the dashboard; nothing is charged or made until then.
// - external_id = the order ref (mop-<28 hex>), unique per Stripe session, so a
//   retry can't make a second order: Printful refuses the duplicate and the
//   existing order is fetched instead (GET /orders/@<external_id>).
// - ORDER_DRY_RUN=1 logs the exact request instead of sending it.
import { describeFailure, isRetryable, requestJson, sleep, type FetchLike } from "./http.ts";
import { itemSummary } from "./build-items.ts";
import type { OrderItem, OrderRecord, SupplierResult } from "./types.ts";

export const PRINTFUL_API = "https://api.printful.com";

const money = (cents: number) => (cents / 100).toFixed(2);

/** Countries where Printful requires recipient.state_code (Stripe gives the code there). */
const STATE_COUNTRIES = new Set(["US", "CA", "AU"]);

export type PrintfulRequest = { method: "POST"; url: string; body: Record<string, unknown> };

/** Printful prints this on the packing slip (registration codes; see lib/item-codes.ts). */
export type PackingSlip = { message: string; store_name: string };

export function printfulOrderRequest(
  record: OrderRecord,
  items: OrderItem[],
  env: Record<string, string | undefined>,
  packingSlip?: PackingSlip | null
): PrintfulRequest {
  const confirm = env.PRINTFUL_AUTO_CONFIRM === "true";
  const { customer } = record;
  const a = customer.address;
  const subtotal = items.reduce((n, i) => n + i.unitAmount * i.qty, 0);
  // Shipping/tax/discount are per Stripe session; they all belong to this
  // order unless the session also had items for another supplier.
  const allHere = items.length === record.items.length;
  const shipping = allHere ? record.amount_shipping : 0;
  const tax = allHere ? record.amount_tax : 0;
  const discount = allHere ? record.amount_discount : 0;
  return {
    method: "POST",
    url: `${PRINTFUL_API}/orders${confirm ? "?confirm=true" : ""}`,
    body: {
      external_id: record.order_ref,
      shipping: "STANDARD",
      recipient: {
        name: customer.name,
        address1: a.line1 ?? "",
        ...(a.line2 ? { address2: a.line2 } : {}),
        city: a.city ?? "",
        // Printful wants a state code only where it's required (and may reject a
        // free-text region elsewhere, e.g. a UK county).
        ...(a.state && STATE_COUNTRIES.has(a.country ?? "") ? { state_code: a.state } : {}),
        country_code: a.country ?? "",
        zip: a.postal_code ?? "",
        phone: customer.phone,
        email: customer.email,
      },
      items: items.map((i) => ({
        sync_variant_id: i.printful!.syncVariantId,
        quantity: i.qty,
        retail_price: money(i.unitAmount),
        name: `${i.title} (${itemSummary(i)})`,
      })),
      ...(packingSlip ? { packing_slip: packingSlip } : {}),
      // Shown on the packing slip and used for customs on international orders.
      retail_costs: {
        currency: record.currency.toUpperCase(),
        subtotal: money(subtotal),
        discount: money(discount),
        shipping: money(shipping),
        tax: money(tax),
        total: money(subtotal - discount + shipping + tax),
      },
    },
  };
}

const headers = (env: Record<string, string | undefined>) => ({
  Authorization: `Bearer ${env.PRINTFUL_API_TOKEN}`,
  "Content-Type": "application/json",
  ...(env.PRINTFUL_STORE_ID ? { "X-PF-Store-Id": env.PRINTFUL_STORE_ID } : {}),
});

const resultFrom = (order: any, existing: boolean, at: string): SupplierResult => {
  const draft = order?.status === "draft";
  const id = order?.id != null ? String(order.id) : undefined;
  return {
    supplier: "printful",
    ok: true,
    id,
    status: order?.status,
    url: order?.dashboard_url || "https://www.printful.com/dashboard/default/orders",
    cost: order?.costs?.total ? `$${order.costs.total}` : undefined,
    existing,
    action: draft
      ? `Confirm Printful draft order #${id} (nothing is made or charged until you do).`
      : `Printful order #${id} is ${order?.status ?? "submitted"}: nothing to do unless it's on hold.`,
    at,
  };
};

export async function createPrintfulOrder(
  record: OrderRecord,
  items: OrderItem[],
  deps: {
    env: Record<string, string | undefined>;
    fetch: FetchLike;
    log: (msg: string) => void;
    now: () => Date;
    retryDelayMs?: number;
  },
  packingSlip?: PackingSlip | null
): Promise<SupplierResult> {
  const { env, log } = deps;
  const at = deps.now().toISOString();
  const req = printfulOrderRequest(record, items, env, packingSlip);

  if (env.ORDER_DRY_RUN === "1") {
    log(`[orders] DRY-RUN Printful ${req.method} ${req.url}\n${JSON.stringify(req.body, null, 2)}`);
    return {
      supplier: "printful",
      ok: true,
      dryRun: true,
      id: "DRY-RUN",
      status: "draft",
      url: "https://www.printful.com/dashboard/default/orders",
      action: "DRY RUN: nothing was sent to Printful.",
      at,
    };
  }
  if (!env.PRINTFUL_API_TOKEN) {
    return { supplier: "printful", ok: false, error: "PRINTFUL_API_TOKEN is not set", at };
  }

  const send = () =>
    requestJson(deps.fetch, req.url, {
      method: "POST",
      headers: headers(env),
      body: JSON.stringify(req.body),
    });
  const fetchExisting = () =>
    requestJson(deps.fetch, `${PRINTFUL_API}/orders/@${record.order_ref}`, {
      method: "GET",
      headers: headers(env),
    });

  let r = await send();
  if (!r.ok && isRetryable(r)) {
    log(`[orders] ${record.order_ref}: Printful ${describeFailure(r)}; retrying once`);
    await sleep(deps.retryDelayMs ?? 2000);
    r = await send();
  }
  if (r.ok) return resultFrom(r.json?.result, false, at);

  // A retry (ours or Stripe's) after Printful already took the order.
  const msg = String(r.json?.error?.message ?? r.json?.result ?? "");
  if (r.status === 400 && /external/i.test(msg) && /exist/i.test(msg)) {
    const existing = await fetchExisting();
    if (existing.ok) return resultFrom(existing.json?.result, true, at);
  }
  return { supplier: "printful", ok: false, error: describeFailure(r), at };
}
