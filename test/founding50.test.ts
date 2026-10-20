// The Founding 50 launch code (John, 2026-10-20) and the home page's line about it:
// "Founding 50 · 30% off your first order · code FOUNDING50 · N left", N from
// Stripe's promotion code, hidden once it's used up or expired.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FOUNDING50,
  FOUNDING50_REVALIDATE,
  founding50Line,
  founding50Parts,
  lookupFounding50,
  type Founding50Lookup,
} from "../lib/founding50.ts";
import { buildItem } from "../lib/orders/build-items.ts";
import { checkoutSessionParams } from "../lib/orders/checkout.ts";
import { shopProducts } from "../lib/catalog/index.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

const NOW = Date.parse("2026-10-20T19:00:00Z") / 1000;
const found = (over: Partial<Extract<Founding50Lookup, { kind: "found" }>> = {}): Founding50Lookup => ({
  kind: "found",
  active: true,
  timesRedeemed: 0,
  maxRedemptions: 50,
  expiresAt: FOUNDING50.expiresAt,
  ...over,
});

/** Stripe's answer to GET /v1/promotion_codes?code=FOUNDING50 (the shape of the live one, made 10/20). */
const stripePromo = (over: Record<string, unknown> = {}) => ({
  id: "promo_1USgNRChUjlv875jeSrcTi8Q",
  object: "promotion_code",
  active: true,
  code: "FOUNDING50",
  coupon: { id: "cvHcedru", object: "coupon", name: "Founding 50", percent_off: 30, duration: "once", applies_to: null, valid: true },
  expires_at: 1798790399,
  livemode: true,
  max_redemptions: 50,
  restrictions: { first_time_transaction: true, minimum_amount: null, minimum_amount_currency: null },
  times_redeemed: 0,
  ...over,
});

type Seen = { url: string; init: RequestInit & { next?: { revalidate?: number } } };
function stripeFetch(answer: (n: number) => { status: number; json?: unknown } | Error) {
  const seen: Seen[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    const a = answer(seen.length);
    if (a instanceof Error) throw a;
    return new Response(a.json === undefined ? "" : JSON.stringify(a.json), { status: a.status });
  };
  return { fetch, seen };
}
const list = (...data: unknown[]) => ({ status: 200, json: { object: "list", data, has_more: false, url: "/v1/promotion_codes" } });
const KEY = { STRIPE_SECRET_KEY: "rk_test_unit_founding50" };

// --- the code -------------------------------------------------------------------------

test("the code: FOUNDING50, 30% off, the first 50, until 2026-12-31 23:59:59 Pacific", () => {
  assert.equal(FOUNDING50.code, "FOUNDING50");
  assert.equal(FOUNDING50.name, "Founding 50");
  assert.equal(FOUNDING50.percentOff, 30);
  assert.equal(FOUNDING50.maxRedemptions, 50);
  assert.equal(FOUNDING50.expiresAt, Date.parse("2026-12-31T23:59:59-08:00") / 1000); // PST in December
  assert.equal(FOUNDING50.expiresAt, 1798790399);
});

// --- the count and when the line hides --------------------------------------------------

test("N left = 50 − times_redeemed", () => {
  assert.deepEqual(founding50Line(found(), NOW), { left: 50 });
  assert.deepEqual(founding50Line(found({ timesRedeemed: 12 }), NOW), { left: 38 });
  assert.deepEqual(founding50Line(found({ timesRedeemed: 49 }), NOW), { left: 1 });
  // no cap on Stripe's side (shouldn't happen): our 50
  assert.deepEqual(founding50Line(found({ maxRedemptions: null, timesRedeemed: 8 }), NOW), { left: 42 });
});

test("hidden once the code is used up", () => {
  assert.equal(founding50Line(found({ timesRedeemed: 50 }), NOW), null);
  assert.equal(founding50Line(found({ timesRedeemed: 51 }), NOW), null);
});

test("hidden once it expires: Stripe's expires_at, and our own end date even when Stripe can't be reached", () => {
  assert.deepEqual(founding50Line(found(), FOUNDING50.expiresAt - 1), { left: 50 });
  assert.equal(founding50Line(found(), FOUNDING50.expiresAt), null);
  assert.equal(founding50Line(found(), FOUNDING50.expiresAt + 1), null);
  // an earlier expiry set in Stripe wins
  assert.equal(founding50Line(found({ expiresAt: NOW - 60 }), NOW), null);
  assert.equal(founding50Line({ kind: "unreachable", why: "timeout" }, FOUNDING50.expiresAt + 1), null);
});

test("hidden when the code is switched off in Stripe, its coupon is no longer valid, or there's no such code", () => {
  assert.equal(founding50Line(found({ active: false }), NOW), null);
  assert.equal(founding50Line(found({ couponValid: false }), NOW), null);
  assert.deepEqual(founding50Line(found({ couponValid: true }), NOW), { left: 50 });
  assert.equal(founding50Line({ kind: "missing" }, NOW), null);
});

test("Stripe unreachable: the line still shows, without the count", () => {
  assert.deepEqual(founding50Line({ kind: "unreachable", why: "HTTP 500" }, NOW), { left: null });
});

test("the words: 'Founding 50 · 30% off your first order · code FOUNDING50 · N left'", () => {
  assert.equal(founding50Parts({ left: 38 }).join(" · "), "Founding 50 · 30% off your first order · code FOUNDING50 · 38 left");
  assert.equal(founding50Parts({ left: null }).join(" · "), "Founding 50 · 30% off your first order · code FOUNDING50");
  // nothing like "was $X": no prices in the line at all
  for (const t of founding50Parts({ left: 1 })) assert.doesNotMatch(t, /\$|was|regular/i, t);
});

// --- reading it from Stripe ---------------------------------------------------------------

test("lookup: GET /v1/promotion_codes?code=FOUNDING50 with the app's key, Next's revalidate passed through", async () => {
  const { fetch, seen } = stripeFetch(() => list(stripePromo({ times_redeemed: 7 })));
  const r = await lookupFounding50({ fetch, env: KEY, init: { next: { revalidate: FOUNDING50_REVALIDATE } } as RequestInit });
  assert.deepEqual(r, { kind: "found", active: true, timesRedeemed: 7, maxRedemptions: 50, expiresAt: 1798790399, couponValid: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.stripe.com/v1/promotion_codes?code=FOUNDING50&limit=10");
  assert.equal(seen[0].init.method, "GET");
  assert.deepEqual(seen[0].init.headers, { Authorization: "Bearer rk_test_unit_founding50" });
  assert.equal(seen[0].init.next?.revalidate, 300);
  assert.deepEqual(founding50Line(r, NOW), { left: 43 });
});

test("lookup: the live code wins over an old switched-off one; a newer API's promotion.coupon is read too", async () => {
  const { fetch } = stripeFetch(() =>
    list(stripePromo({ id: "promo_old", active: false, times_redeemed: 50 }), stripePromo({ times_redeemed: 3, coupon: undefined, promotion: { type: "coupon", coupon: { id: "cvHcedru", valid: true } } }))
  );
  const r = await lookupFounding50({ fetch, env: KEY });
  assert.deepEqual(r, { kind: "found", active: true, timesRedeemed: 3, maxRedemptions: 50, expiresAt: 1798790399, couponValid: true });
  // only an inactive one: hidden
  const off = stripeFetch(() => list(stripePromo({ active: false })));
  assert.equal(founding50Line(await lookupFounding50({ fetch: off.fetch, env: KEY }), NOW), null);
});

test("lookup: no such code in Stripe -> missing (hidden); a different code in the answer doesn't count", async () => {
  assert.deepEqual(await lookupFounding50({ fetch: stripeFetch(() => list()).fetch, env: KEY }), { kind: "missing" });
  assert.deepEqual(await lookupFounding50({ fetch: stripeFetch(() => list(stripePromo({ code: "WELCOME10" }))).fetch, env: KEY }), { kind: "missing" });
});

test("lookup: no key, an error, a timeout or junk -> unreachable (line without the count); it never throws", async () => {
  const none = stripeFetch(() => list(stripePromo()));
  assert.deepEqual(await lookupFounding50({ fetch: none.fetch, env: {} }), { kind: "unreachable", why: "STRIPE_SECRET_KEY is not set" });
  assert.equal(none.seen.length, 0, "no key: no call");
  const cases: [string, () => { status: number; json?: unknown } | Error][] = [
    ["HTTP 401", () => ({ status: 401, json: { error: { message: "Invalid API Key provided" } } })],
    ["HTTP 403", () => ({ status: 403, json: { error: { message: "The provided key does not have the required permissions" } } })],
    ["HTTP 500", () => ({ status: 500, json: { error: { message: "oops" } } })],
    ["getaddrinfo ENOTFOUND api.stripe.com", () => new Error("getaddrinfo ENOTFOUND api.stripe.com")],
    ["no list in Stripe's answer", () => ({ status: 200, json: { hello: "world" } })],
    ["no times_redeemed in Stripe's answer", () => list(stripePromo({ times_redeemed: undefined }))],
  ];
  for (const [why, answer] of cases) {
    const r = await lookupFounding50({ fetch: stripeFetch(answer).fetch, env: KEY });
    assert.deepEqual(r, { kind: "unreachable", why }, why);
    assert.deepEqual(founding50Line(r, NOW), { left: null }, why);
    assert.doesNotMatch(JSON.stringify(r), /rk_test_unit/, "the key never ends up in the reason (it's logged)");
  }
  // a slow Stripe: given up on after the timeout
  const slow = async (_url: string, init: RequestInit = {}) =>
    new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  assert.deepEqual(await lookupFounding50({ fetch: slow, env: KEY, timeoutMs: 20 }), { kind: "unreachable", why: "timeout after 20 ms" });
});

// --- on the home page ------------------------------------------------------------------------

test("the home page reads it on the server, cached ~5 minutes (Next revalidate), and hands the line to the page", () => {
  const page = read("app/page.tsx");
  assert.doesNotMatch(page, /"use client"/);
  assert.equal(FOUNDING50_REVALIDATE, 300);
  assert.match(page, /export const revalidate = 300;/);
  assert.match(page, /lookupFounding50\(\{ init: \{ next: \{ revalidate: FOUNDING50_REVALIDATE \} \} \}\)/);
  assert.match(page, /<HomePage founding50=\{founding50Line\(lookup\)\} \/>/);
  // the key stays on the server: the client page gets only the count
  const home = read("app/HomePage.tsx");
  assert.match(home, /^"use client";/);
  assert.doesNotMatch(home, /STRIPE_SECRET_KEY|lookupFounding50/);
});

test("the line sits right under the benefits row, in the header; the code wears the 'Free US shipping' orange pill", () => {
  const home = read("app/HomePage.tsx");
  const order = ["BENEFITS.map", "{founding50 && (", "founding50Parts(founding50)", "</header>", "<WildStrip"];
  const at = order.map((s) => home.indexOf(s));
  order.forEach((s, i) => assert.ok(at[i] >= 0, `${s} is on the page`));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in this order");
  assert.match(home, /<p className=\{styles\.founding\}>/);
  assert.match(home, /code <span className=\{styles\.benefitHot\}>\{FOUNDING50\.code\}<\/span>/);
  // each part is nowrap (.benefit): one line on a computer, breaks only between parts on a phone
  assert.match(home, /<span className=\{styles\.benefit\}>\{t\}<\/span>/);
  const css = read("app/HomeGrid.module.css");
  const rule = /\n\.founding \{[^}]*\}/.exec(css)?.[0] ?? "";
  assert.match(rule, /color: #14232b;/, "dark like the hero");
  assert.match(rule, /font-size: 0\.8rem;/);
  assert.doesNotMatch(rule, /white-space: nowrap/, "may wrap on phones");
  const phone = css.slice(css.indexOf("@media (max-width: 768px)"));
  assert.match(phone, /\.founding \{[^}]*font-size: 0\.68rem;/);
});

test("no 'was $X' pricing anywhere a price is shown: no strike-through, no regular/compare-at price", () => {
  for (const f of ["app/HomePage.tsx", "app/[productId]/ProductClientView.tsx", "app/[productId]/CatalogProductView.tsx", "components/ProductCard.tsx", "app/bag/page.tsx"]) {
    let src = "";
    try {
      src = read(f);
    } catch {
      continue;
    }
    assert.doesNotMatch(src, /<del[\s>]|<s>|<strike|compare_?at|regular price|was \$\{|>\s*was \$/i, f);
  }
});

// --- checkout takes the code ---------------------------------------------------------------

test("Checkout takes promotion codes on a product page's Buy now (the shorts, a tee, an all-over); the bag is checked in bag.test.ts", () => {
  const picks: [string, Record<string, string>][] = [
    ["blue-sky-cotton-shorts", { size: "M" }],
    ...["alpaca-tee", "sky-tee"].map((slug): [string, Record<string, string>] => [slug, { ...shopProducts.find((p) => p.slug === slug)!.variants[0].opts }]),
  ];
  for (const [slug, opts] of picks) {
    const params = checkoutSessionParams(buildItem(slug, opts, 1, {}));
    assert.equal(params.allow_promotion_codes, true, slug);
    assert.equal(params.discounts, undefined, slug);
  }
});
