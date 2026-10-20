// The Founding 50 launch code (John, 2026-10-20): 30% off a first order, the
// first 50 customers, until the end of 2026. The line under the home page's
// benefits row says how many are left.
//
// The code lives in John's live Stripe account (made on 2026-10-20):
//   coupon cvHcedru "Founding 50": percent_off 30, duration once, no applies_to (the whole order)
//   promotion code promo_1USgNRChUjlv875jeSrcTi8Q "FOUNDING50": max_redemptions 50,
//     first_time_transaction, expires_at 1798790399 (2026-12-31 23:59:59 America/Los_Angeles)
// Customers type it in Stripe Checkout ("Add promotion code"): both the bag and
// a product page's Buy now open Checkout with allow_promotion_codes
// (lib/orders/checkout.ts cartSessionParams).
//
// The count comes from Stripe's promotion code (times_redeemed), read on the
// server when the home page is rendered (app/page.tsx, revalidated every 5
// minutes). No imports from Next: the tests call these with injected data.
import { requestJson, type FetchLike } from "./orders/http.ts";

export const FOUNDING50 = {
  code: "FOUNDING50",
  name: "Founding 50",
  percentOff: 30,
  maxRedemptions: 50,
  /** 2026-12-31 23:59:59 America/Los_Angeles (PST, UTC−8), as on the promotion code. */
  expiresAt: 1798790399,
} as const;

/** How often the home page re-reads the count from Stripe, in seconds. */
export const FOUNDING50_REVALIDATE = 300;

/** What Stripe said about the code, or why we don't know. */
export type Founding50Lookup =
  | {
      kind: "found";
      active: boolean;
      timesRedeemed: number;
      /** Stripe's max_redemptions (null: no cap there; then FOUNDING50.maxRedemptions). */
      maxRedemptions: number | null;
      /** Stripe's expires_at, unix seconds (null: none set there). */
      expiresAt: number | null;
      /** The coupon's `valid` when Stripe sent it (false once the coupon itself is used up or deleted). */
      couponValid?: boolean;
    }
  /** Stripe answered, and there's no FOUNDING50 promotion code. */
  | { kind: "missing" }
  /** No key, no answer, or an error from Stripe. */
  | { kind: "unreachable"; why: string };

/** The line to show: how many are left, or null when the count isn't known (Stripe unreachable). */
export type Founding50Line = { left: number | null };

/**
 * The home page's Founding 50 line, or null to hide it: hidden once the code is
 * used up, expired, switched off in Stripe or not there at all. When Stripe
 * can't be reached the line still shows, without the count (until the end date).
 */
export function founding50Line(lookup: Founding50Lookup, nowSec: number = Math.floor(Date.now() / 1000)): Founding50Line | null {
  if (nowSec > FOUNDING50.expiresAt) return null;
  if (lookup.kind === "unreachable") return { left: null };
  if (lookup.kind === "missing") return null;
  if (!lookup.active || lookup.couponValid === false) return null;
  if (lookup.expiresAt != null && nowSec >= lookup.expiresAt) return null;
  const max = lookup.maxRedemptions ?? FOUNDING50.maxRedemptions;
  const left = Math.max(0, Math.floor(max - lookup.timesRedeemed));
  return left > 0 ? { left } : null;
}

/** The line's pieces, shown with a dot between them: "Founding 50 · 30% off your first order · code FOUNDING50 · 12 left". */
export function founding50Parts(line: Founding50Line): string[] {
  return [
    FOUNDING50.name,
    `${FOUNDING50.percentOff}% off your first order`,
    `code ${FOUNDING50.code}`,
    ...(line.left != null ? [`${line.left} left`] : []),
  ];
}

const STRIPE_API = "https://api.stripe.com/v1";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Reads the FOUNDING50 promotion code from Stripe (GET /v1/promotion_codes?code=,
 * which a restricted key reads with Promotion Codes: Read). Never throws.
 * `init` is passed on to fetch: the home page adds Next's `{ next: { revalidate } }`.
 */
export async function lookupFounding50({
  fetch: fetchImpl = globalThis.fetch as FetchLike,
  env = process.env,
  init = {},
  timeoutMs = 4000,
}: {
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
  init?: RequestInit;
  timeoutMs?: number;
} = {}): Promise<Founding50Lookup> {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return { kind: "unreachable", why: "STRIPE_SECRET_KEY is not set" };
  const url = `${STRIPE_API}/promotion_codes?code=${encodeURIComponent(FOUNDING50.code)}&limit=10`;
  const r = await requestJson(fetchImpl, url, { ...init, method: "GET", headers: { Authorization: `Bearer ${key}` } }, timeoutMs);
  if (r.networkError) return { kind: "unreachable", why: r.networkError };
  if (!r.ok) return { kind: "unreachable", why: `HTTP ${r.status}` };
  if (!Array.isArray(r.json?.data)) return { kind: "unreachable", why: "no list in Stripe's answer" };
  const data: any[] = r.json.data;
  const codes = data.filter((p) => typeof p?.code === "string" && p.code.toUpperCase() === FOUNDING50.code);
  // The live one if there is one (an old, switched-off copy shouldn't hide it).
  const p = codes.find((c) => c.active === true) ?? codes[0];
  if (!p) return { kind: "missing" };
  const timesRedeemed = num(p.times_redeemed);
  if (timesRedeemed == null) return { kind: "unreachable", why: "no times_redeemed in Stripe's answer" };
  const coupon = p.coupon ?? p.promotion?.coupon;
  return {
    kind: "found",
    active: p.active === true,
    timesRedeemed,
    maxRedemptions: num(p.max_redemptions),
    expiresAt: num(p.expires_at),
    ...(coupon && typeof coupon === "object" && typeof coupon.valid === "boolean" ? { couponValid: coupon.valid } : {}),
  };
}
