// A Stripe Checkout Session (from the webhook event) -> our OrderRecord.
import crypto from "node:crypto";
import { buildItem } from "./build-items.ts";
import { itemsFromSessionMetadata } from "./metadata.ts";
import type { Address, Customer, OrderDiscount, OrderItem, OrderRecord } from "./types.ts";

/**
 * Our order id for a session: "mop-" + 28 hex chars of sha256(session id).
 * Printful's external_id allows at most 32 characters (a Stripe session id is
 * ~66), so the session id can't be used as is; the hash is stable, so a retry
 * always maps to the same supplier order.
 */
export const orderRefFor = (sessionId: string) =>
  `mop-${crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 28)}`;

/** The subset of a Checkout Session we read. Works with event payloads from any API version. */
export type SessionLike = {
  id: string;
  created?: number;
  livemode?: boolean;
  payment_status?: string | null;
  payment_intent?: string | { id: string } | null;
  currency?: string | null;
  amount_total?: number | null;
  amount_subtotal?: number | null;
  total_details?: {
    amount_shipping?: number | null;
    amount_discount?: number | null;
    amount_tax?: number | null;
  } | null;
  metadata?: Record<string, string> | null;
  /** Ids in event payloads; objects only when a retrieve expanded them. */
  discounts?:
    | {
        coupon?: string | { id?: string | null } | null;
        promotion_code?: string | { id?: string | null; code?: string | null } | null;
      }[]
    | null;
  customer_details?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: Address | null;
  } | null;
  /** API versions >= 2025-03-31 (basil). */
  collected_information?: {
    shipping_details?: { name?: string | null; address?: Address | null } | null;
  } | null;
  /** Older API versions. */
  shipping_details?: { name?: string | null; address?: Address | null } | null;
  shipping?: { name?: string | null; address?: Address | null } | null;
};

/** A line item as returned by checkout.sessions.listLineItems with data.price.product expanded. */
export type LineItemLike = {
  quantity?: number | null;
  description?: string | null;
  price?: {
    unit_amount?: number | null;
    product?: string | { name?: string; metadata?: Record<string, string> } | null;
  } | null;
};

export function customerFrom(session: SessionLike): Customer {
  const ship =
    session.collected_information?.shipping_details ??
    session.shipping_details ??
    session.shipping ??
    null;
  const cd = session.customer_details ?? {};
  return {
    name: (ship?.name || cd.name || "").trim(),
    email: (cd.email || "").trim(),
    phone: (cd.phone || "").trim(),
    address: { ...(ship?.address ?? cd.address ?? {}) },
  };
}

/** The session's discounts as ids (+ the code when the promotion code came expanded). */
export function discountsFrom(session: SessionLike): OrderDiscount[] {
  const id = (x: unknown) => (typeof x === "string" ? x : x && typeof x === "object" ? (x as { id?: unknown }).id : undefined);
  return (Array.isArray(session.discounts) ? session.discounts : []).flatMap((d) => {
    const promo = id(d?.promotion_code);
    const coupon = id(d?.coupon);
    const code = d?.promotion_code && typeof d.promotion_code === "object" ? d.promotion_code.code : undefined;
    const out: OrderDiscount = {
      ...(typeof promo === "string" && promo ? { promotion_code: promo } : {}),
      ...(typeof coupon === "string" && coupon ? { coupon } : {}),
      ...(typeof code === "string" && code.trim() ? { code: code.trim() } : {}),
    };
    return Object.keys(out).length ? [out] : [];
  });
}

/**
 * Items from a session made before the mop_* metadata existed (e.g. a checkout
 * started just before a deploy): rebuilt from each line item's product metadata
 * ({ productId, color, size }). Unknown products come back as manual items.
 */
export function itemsFromLineItems(
  lineItems: LineItemLike[],
  env: Record<string, string | undefined> = process.env
): OrderItem[] {
  return lineItems.map((li) => {
    const product = typeof li.price?.product === "object" ? li.price.product : null;
    const md = product?.metadata ?? {};
    const qty = li.quantity ?? 1;
    const { productId, qty: _q, supplier: _s, sync_variant_id: _sv, yoycol_design_code: _dc, yoycol_sku_code: _sku, ...opts } = md;
    try {
      // These sessions predate our metadata, so they were priced the old way.
      const { item } = buildItem(productId ?? "", opts, qty, env, { inFlight: true });
      if (li.price?.unit_amount != null) item.unitAmount = li.price.unit_amount;
      return item;
    } catch {
      return {
        slug: productId || "unknown",
        title: product?.name || li.description || "Unknown item",
        supplier: "manual",
        qty,
        opts: Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, String(v)])),
        unitAmount: li.price?.unit_amount ?? 0,
        manual: "Couldn't match this item to a product: check the Stripe payment",
      } satisfies OrderItem;
    }
  });
}

export async function buildOrderRecord(
  session: SessionLike,
  opts: {
    listLineItems?: (sessionId: string) => Promise<LineItemLike[]>;
    env?: Record<string, string | undefined>;
    log?: (msg: string) => void;
  } = {}
): Promise<OrderRecord> {
  let items = itemsFromSessionMetadata(session.metadata);
  let source: OrderRecord["items_source"] = "metadata";
  if (!items) {
    source = "none";
    items = [];
    if (opts.listLineItems) {
      try {
        items = itemsFromLineItems(await opts.listLineItems(session.id), opts.env);
        source = "line_items";
      } catch (err) {
        opts.log?.(`[orders] ${session.id}: couldn't list line items: ${(err as Error).message}`);
      }
    }
  }
  const pi = session.payment_intent;
  const discounts = discountsFrom(session);
  return {
    session_id: session.id,
    order_ref: orderRefFor(session.id),
    created: new Date((session.created ?? Date.now() / 1000) * 1000).toISOString(),
    livemode: !!session.livemode,
    payment_status: session.payment_status ?? "unknown",
    payment_intent: typeof pi === "string" ? pi : pi?.id ?? null,
    currency: (session.currency ?? "usd").toLowerCase(),
    amount_total: session.amount_total ?? 0,
    amount_subtotal: session.amount_subtotal ?? 0,
    amount_shipping: session.total_details?.amount_shipping ?? 0,
    amount_discount: session.total_details?.amount_discount ?? 0,
    amount_tax: session.total_details?.amount_tax ?? 0,
    ...(discounts.length ? { discounts } : {}),
    customer: customerFrom(session),
    items,
    items_source: source,
  };
}
