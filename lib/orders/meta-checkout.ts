// Meta Shops "checkout on another website": a cart from Instagram / Facebook
// lands on /meta-checkout and goes straight to one Stripe Checkout session.
//
// Meta's checkout URL (developers.facebook.com/documentation/ads-commerce/commerce-platform/setup-checkout-url):
//   products     "<content_id>:<qty>,<content_id>:<qty>" (URL-encoded); content_id is the <g:id> in /feeds/meta.xml
//   coupon       optional, one code
//   cart_origin  facebook | instagram | meta_shops
//   utm_*        campaign tags (paid traffic)
// Unknown or off-sale ids are skipped; prices, options and the supplier mapping
// all come from our own catalog, exactly as for a checkout from the product page.
import type Stripe from "stripe";
import { buildItem, checkoutBlock, CheckoutError, type PricedItem } from "./build-items.ts";
import { cartSessionParams, SITE_ORIGIN } from "./checkout.ts";
import { shopProducts, type ShopProduct } from "../catalog/index.ts";
import { feedId } from "../google-feed.ts";

/** Distinct lines per cart (Stripe metadata allows 50 keys; each line takes one). */
export const MAX_LINES = 20;
/** Per line, as on the product page (buildItem). */
export const MAX_QTY = 20;

export type MetaLine = { id: string; qty: number };

/** Safe for a log line or metadata: no control characters. */
const printable = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");

/** "a:1,b:2" -> lines. Repeated ids are added together; a missing quantity is 1; bad quantities are dropped. */
export function parseMetaProducts(raw: string | null | undefined): { lines: MetaLine[]; bad: string[] } {
  const qtys = new Map<string, number>();
  const bad: string[] = [];
  for (const part of String(raw ?? "").split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const at = entry.lastIndexOf(":");
    const id = (at < 0 ? entry : entry.slice(0, at)).trim().toLowerCase();
    const q = at < 0 ? "1" : entry.slice(at + 1).trim();
    const qty = /^\d{1,4}$/.test(q) ? Number(q) : NaN;
    // feed ids are lowercase letters, digits and dashes (feedId)
    if (!/^[a-z0-9-]{1,64}$/.test(id) || !(qty >= 1)) {
      bad.push(printable(entry).slice(0, 80));
      continue;
    }
    qtys.set(id, (qtys.get(id) ?? 0) + qty);
  }
  return { lines: Array.from(qtys, ([id, qty]) => ({ id, qty })), bad };
}

type Indexed = { product: ShopProduct; opts: Record<string, string> };
let index: Map<string, Indexed> | null = null;

/** Feed id -> product + variant, for the same products and ids as /feeds/meta.xml. */
export function feedIndex(products: ShopProduct[] = shopProducts): Map<string, Indexed> {
  if (products === shopProducts && index) return index;
  const map = new Map<string, Indexed>();
  for (const product of products)
    for (const v of product.variants) map.set(feedId(product.slug, v.opts), { product, opts: { ...v.opts } });
  if (products === shopProducts) index = map;
  return map;
}

export type Skipped = { id: string; reason: string; slug?: string };

/** Lines -> priced items (capped at MAX_QTY each, MAX_LINES in all); everything that can't be sold now is skipped. */
export function resolveMetaCart(
  lines: MetaLine[],
  env: Record<string, string | undefined> = process.env,
  { products = shopProducts, block = checkoutBlock }: { products?: ShopProduct[]; block?: typeof checkoutBlock } = {}
): { priced: PricedItem[]; skipped: Skipped[] } {
  const ids = feedIndex(products);
  const priced: PricedItem[] = [];
  const skipped: Skipped[] = [];
  for (const { id, qty } of lines) {
    const hit = ids.get(id);
    if (!hit) {
      skipped.push({ id, reason: "unknown id" });
      continue;
    }
    const slug = hit.product.slug;
    const blocked = block(slug, hit.opts);
    if (blocked) {
      skipped.push({ id, slug, reason: blocked.error });
      continue;
    }
    if (priced.length >= MAX_LINES) {
      skipped.push({ id, slug, reason: "too many lines" });
      continue;
    }
    try {
      priced.push(buildItem(slug, hit.opts, Math.min(qty, MAX_QTY), env));
    } catch (err) {
      if (!(err instanceof CheckoutError)) throw err;
      skipped.push({ id, slug, reason: err.message });
    }
  }
  return { priced, skipped };
}

export const CART_ORIGINS = ["facebook", "instagram", "meta_shops"] as const;

/** Where the cart came from: cart_origin and the utm_* tags (for the Umami event and the order's metadata). */
export function metaSource(params: URLSearchParams): { origin: string; utm: Record<string, string> } {
  const raw = (params.get("cart_origin") ?? "").trim().toLowerCase();
  const origin = (CART_ORIGINS as readonly string[]).includes(raw) ? raw : raw ? "other" : "unknown";
  const utm: Record<string, string> = {};
  params.forEach((value, key) => {
    const k = key.toLowerCase();
    if (/^utm_[a-z_]{1,20}$/.test(k) && value.trim() && Object.keys(utm).length < 8) utm[k] = printable(value.trim()).slice(0, 100);
  });
  return { origin, utm };
}

/** The bits of the Stripe client this needs (a fake in tests). */
export type StripeForMeta = {
  checkout: { sessions: { create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }> } };
  promotionCodes: { list(params: Stripe.PromotionCodeListParams): Promise<{ data: { id: string; code: string; active: boolean }[] }> };
};

/** A promotion code's id by its customer-facing code (case-insensitive), or null if there's no active one. */
export async function findPromotionCode(stripe: StripeForMeta, code: string | null | undefined): Promise<string | null> {
  const clean = String(code ?? "").trim();
  if (!clean || clean.length > 64 || /\s/.test(clean)) return null;
  try {
    const res = await stripe.promotionCodes.list({ code: clean, active: true, limit: 1 });
    const hit = res.data.find((p) => p.active && p.code.toLowerCase() === clean.toLowerCase());
    return hit?.id ?? null;
  } catch {
    // no permission on the key, Stripe down, ...: the customer can still type it in Checkout
    return null;
  }
}

export type MetaEvent = { name: string; data: Record<string, string | number> };

export type MetaCheckoutResult =
  | { kind: "redirect"; url: string; event: MetaEvent; log: string }
  | { kind: "unavailable"; slugs: string[]; event: MetaEvent; log: string };

/**
 * The whole /meta-checkout request: cart -> one Checkout session (with the
 * coupon applied when it's a live promotion code), or why there's nothing to
 * buy. Stripe errors other than a refused coupon are thrown to the route.
 */
export async function metaCheckout(
  params: URLSearchParams,
  { stripe, env = process.env, origin = SITE_ORIGIN }: { stripe: () => StripeForMeta; env?: Record<string, string | undefined>; origin?: string }
): Promise<MetaCheckoutResult> {
  const { lines, bad } = parseMetaProducts(params.get("products"));
  const { priced, skipped } = resolveMetaCart(lines, env);
  const src = metaSource(params);
  const skippedText = [...skipped.map((s) => `${s.id} (${s.reason})`), ...bad.map((b) => `${b} (unreadable)`)].join(", ");
  const slugs = Array.from(new Set(skipped.flatMap((s) => (s.slug ? [s.slug] : []))));
  const base = { origin: src.origin, ...src.utm };

  if (!priced.length) {
    return {
      kind: "unavailable",
      slugs,
      event: { name: "meta-checkout-unavailable", data: { ...base, requested: lines.length + bad.length } },
      log: `nothing to buy from ${src.origin}${skippedText ? `; skipped ${skippedText}` : ""}`,
    };
  }

  const items = priced.reduce((n, p) => n + p.item.qty, 0);
  const valueCents = priced.reduce((n, p) => n + p.item.unitAmount * p.item.qty, 0) + Math.max(...priced.map((p) => p.shippingCents));
  const coupon = (params.get("coupon") ?? "").trim();
  const client = stripe();
  const promo = coupon ? await findPromotionCode(client, coupon) : null;
  // Stripe allows 500 characters a value: drop utm tags from the end until it fits (still valid JSON).
  const utmKeys = Object.keys(src.utm);
  let sourceJson = "";
  for (let n = utmKeys.length; n >= 0; n--) {
    const utm = Object.fromEntries(utmKeys.slice(0, n).map((k) => [k, src.utm[k]]));
    sourceJson = JSON.stringify({ via: "meta", origin: src.origin, ...utm, ...(coupon ? { coupon: printable(coupon).slice(0, 40) } : {}) });
    if (sourceJson.length <= 500) break;
  }
  const metadata: Record<string, string> = { mop_source: sourceJson };

  let session: { id: string; url: string | null };
  let couponState = !coupon ? "none" : promo ? "applied" : "not found";
  try {
    session = await client.checkout.sessions.create(cartSessionParams(priced, { origin, promotionCode: promo ?? undefined, metadata }));
  } catch (err) {
    if (!promo) throw err;
    // The code exists but Stripe won't apply it to this cart (expired, minimum amount, ...): let the customer try in Checkout.
    couponState = "rejected";
    session = await client.checkout.sessions.create(cartSessionParams(priced, { origin, metadata }));
  }
  if (!session.url) throw new Error(`session ${session.id} has no url`);

  return {
    kind: "redirect",
    url: session.url,
    event: {
      name: "meta-checkout",
      data: { ...base, items, lines: priced.length, value: valueCents / 100, ...(coupon ? { coupon: couponState } : {}), ...(skipped.length + bad.length ? { skipped: skipped.length + bad.length } : {}) },
    },
    log:
      `${src.origin}: ${priced.map((p) => `${p.item.qty} x ${p.item.slug} (${Object.values(p.item.opts).join(" / ")})`).join("; ")}` +
      ` $${(valueCents / 100).toFixed(2)}` +
      (coupon ? `, coupon ${couponState}` : "") +
      (skippedText ? `; skipped ${skippedText}` : ""),
  };
}
