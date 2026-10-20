// /meta-checkout: Meta Shops carts -> one Stripe Checkout session (lib/orders/meta-checkout.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import {
  feedIndex,
  findPromotionCode,
  metaCheckout,
  metaSource,
  parseMetaProducts,
  resolveMetaCart,
  type StripeForMeta,
} from "../lib/orders/meta-checkout.ts";
import { buildItem } from "../lib/orders/build-items.ts";
import { checkoutSessionParams } from "../lib/orders/checkout.ts";
import { itemsFromSessionMetadata } from "../lib/orders/metadata.ts";
import { shopProducts, getShopProduct } from "../lib/catalog/index.ts";
import { googleFeedXml, feedId } from "../lib/google-feed.ts";
import { sendUmamiEvent } from "../lib/umami-server.ts";
import { UMAMI_WEBSITE_ID } from "../lib/umami.ts";
import robots from "../app/robots.ts";
import { handleStripeEvent } from "../lib/orders/process.ts";
import { fakeFetch, happyResponder, makeDeps, makeEvent, makeSession, tmpDir } from "./helpers.ts";

const PELICAN = "pelican-tee-large-classic-lagoon-blue-m";
const SKY = "sky-tee-daydream-m";

/** A Stripe that records calls. promos: code (any case) -> promotion code id. */
function fakeStripe({ promos = {} as Record<string, string>, refuseDiscounts = false, listThrows = false, createThrows = false } = {}) {
  const creates: Stripe.Checkout.SessionCreateParams[] = [];
  const lists: Stripe.PromotionCodeListParams[] = [];
  const client: StripeForMeta = {
    checkout: {
      sessions: {
        create: async (params) => {
          creates.push(params);
          if (createThrows) throw new Error("Stripe is down");
          if (refuseDiscounts && params.discounts) throw new Error("This promotion code cannot be redeemed because the associated customer has prior transactions.");
          return { id: `cs_test_${creates.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_${creates.length}` };
        },
      },
    },
    promotionCodes: {
      list: async (params) => {
        lists.push(params);
        if (listThrows) throw new Error("The provided key does not have the required permissions");
        const id = promos[String(params.code).toUpperCase()];
        return { data: id ? [{ id, code: String(params.code).toUpperCase(), active: true }] : [] };
      },
    },
  };
  return { client, creates, lists, stripe: () => client };
}

const q = (s: Record<string, string>) => new URLSearchParams(s);

test("the products parameter: id:qty pairs, URL-encoded, repeats added up, bad entries dropped", () => {
  // what Meta sends: products=12345%3A3%2C23456%3A1
  const params = new URLSearchParams(`products=${encodeURIComponent(`${PELICAN}:1,${SKY}:2`)}`);
  assert.deepEqual(parseMetaProducts(params.get("products")).lines, [
    { id: PELICAN, qty: 1 },
    { id: SKY, qty: 2 },
  ]);
  assert.deepEqual(parseMetaProducts(`${PELICAN}:1, ${PELICAN.toUpperCase()}:2,${SKY}`).lines, [
    { id: PELICAN, qty: 3 },
    { id: SKY, qty: 1 },
  ]);
  const { lines, bad } = parseMetaProducts(`${PELICAN}:0,${SKY}:abc,x:-1,,:2,${PELICAN}:1.5`);
  assert.deepEqual(lines, []);
  assert.equal(bad.length, 5);
  assert.deepEqual(parseMetaProducts(null), { lines: [], bad: [] });
  // anything that can't be a feed id is dropped before it reaches a log line
  assert.deepEqual(parseMetaProducts("evil\nline:1,../x:1").bad, ["evil?line:1", "../x:1"]);
});

test("every id in /feeds/meta.xml maps to its variant at the feed's price, ready for Printful", () => {
  const xml = googleFeedXml(shopProducts, new Date(), "meta");
  const items = xml.split("<item>").slice(1);
  assert.ok(items.length > 100);
  for (const it of items) {
    const id = /<g:id>([^<]+)<\/g:id>/.exec(it)![1];
    const price = Number(/<g:price>([\d.]+) USD<\/g:price>/.exec(it)![1]);
    const { priced, skipped } = resolveMetaCart([{ id, qty: 1 }], {});
    assert.deepEqual(skipped, [], id);
    assert.equal(priced[0].item.unitAmount, Math.round(price * 100), id);
    assert.ok(priced[0].item.printful?.syncVariantId, id);
    assert.equal(feedId(priced[0].item.slug, priced[0].item.opts), id);
  }
  assert.equal(feedIndex().size, items.length);
});

test("one item: the same session as the product page's checkout, plus where it came from", async () => {
  const s = fakeStripe();
  const r = await metaCheckout(q({ products: `${PELICAN}:1`, cart_origin: "instagram", utm_source: "ig", utm_campaign: "drop1" }), {
    stripe: s.stripe,
    env: {},
  });
  assert.equal(r.kind, "redirect");
  assert.equal(r.kind === "redirect" && r.url, "https://checkout.stripe.com/c/pay/cs_test_1");
  assert.equal(s.creates.length, 1);
  assert.equal(s.lists.length, 0); // no coupon, no lookup
  const params = s.creates[0];
  const pel = getShopProduct("pelican-tee")!;
  const v = pel.variants.find((x) => feedId(pel.slug, x.opts) === PELICAN)!;
  const normal = checkoutSessionParams(buildItem("pelican-tee", v.opts, 1, {}));
  const { mop_source, ...md } = params.metadata as Record<string, string>;
  assert.deepEqual({ ...params, metadata: md }, normal);
  assert.deepEqual(JSON.parse(mop_source), { via: "meta", origin: "instagram", utm_source: "ig", utm_campaign: "drop1" });
  assert.equal(params.allow_promotion_codes, true);
  assert.equal(params.discounts, undefined);
  assert.deepEqual(r.event, {
    name: "meta-checkout",
    data: { origin: "instagram", utm_source: "ig", utm_campaign: "drop1", items: 1, lines: 1, value: v.price },
  });
});

test("several items with quantities: one session, metadata the webhook reads back item by item", async () => {
  const s = fakeStripe();
  const r = await metaCheckout(q({ products: `${PELICAN}:2,${SKY}:3`, cart_origin: "facebook" }), { stripe: s.stripe, env: {} });
  assert.equal(r.kind, "redirect");
  const params = s.creates[0];
  assert.equal(params.line_items!.length, 2);
  assert.deepEqual(params.line_items!.map((l) => l.quantity), [2, 3]);
  assert.deepEqual(params.line_items!.map((l) => l.price_data!.product_data!.metadata!.productId), ["pelican-tee", "sky-tee"]);
  assert.deepEqual(params.line_items!.map((l) => l.price_data!.product_data!.metadata!.qty), ["2", "3"]);
  const md = params.metadata as Record<string, string>;
  assert.equal(md.mop_n, "2");
  const items = itemsFromSessionMetadata(md)!;
  assert.deepEqual(items.map((i) => [i.slug, i.qty, i.supplier]), [
    ["pelican-tee", 2, "printful"],
    ["sky-tee", 3, "printful"],
  ]);
  // each item's metadata is exactly what the product page's checkout makes for it
  for (const [i, it] of items.entries()) {
    const single = checkoutSessionParams(buildItem(it.slug, it.opts, it.qty, {}));
    assert.equal(md[`mop_item_${i}`], (single.metadata as Record<string, string>).mop_item_0);
    assert.deepEqual(params.line_items![i], single.line_items![0]);
  }
  assert.match(md.mop_summary, /^2 x Pelican Tee .*; 3 x Sky Tee /);
  // still US only, phone, free shipping, back to the first product
  assert.deepEqual(params.shipping_address_collection?.allowed_countries, ["US"]);
  assert.equal(params.phone_number_collection?.enabled, true);
  assert.equal(params.shipping_options![0].shipping_rate_data!.fixed_amount!.amount, 0);
  assert.equal(params.success_url, "https://mopclothing.com/pelican-tee?status=success");
  const total = items.reduce((n, i) => n + i.unitAmount * i.qty, 0);
  assert.equal(r.event.data.items, 5);
  assert.equal(r.event.data.lines, 2);
  assert.equal(r.event.data.value, total / 100);
  assert.equal(r.event.data.origin, "facebook");
});

test("a paid Meta cart goes through the webhook as one Printful order with every item", async () => {
  const s = fakeStripe();
  await metaCheckout(q({ products: `${PELICAN}:2,${SKY}:1`, cart_origin: "instagram" }), { stripe: s.stripe, env: {} });
  const md = s.creates[0].metadata as Record<string, string>;
  const items = itemsFromSessionMetadata(md)!;
  const session = { ...makeSession(items), metadata: md };
  const { fetch, calls } = fakeFetch(happyResponder);
  const res = await handleStripeEvent(makeEvent(session), makeDeps(tmpDir(), fetch));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "done");
  const pf = calls.filter((c) => c.url.startsWith("https://api.printful.com/orders"));
  assert.equal(pf.length, 1);
  assert.deepEqual(
    pf[0].body.items.map((i: { sync_variant_id: number; quantity: number }) => [i.sync_variant_id, i.quantity]),
    items.map((i) => [i.printful!.syncVariantId, i.qty])
  );
});

test("long utm tags still leave valid JSON within Stripe's 500 characters", async () => {
  const s = fakeStripe();
  const tags = Object.fromEntries(["source", "medium", "campaign", "content", "term", "id", "x", "y"].map((k) => [`utm_${k}`, "z".repeat(100)]));
  await metaCheckout(q({ products: `${PELICAN}:1`, cart_origin: "instagram", coupon: "WELCOME10", ...tags }), { stripe: s.stripe, env: {} });
  const src = (s.creates[0].metadata as Record<string, string>).mop_source;
  assert.ok(src.length <= 500);
  const parsed = JSON.parse(src);
  assert.equal(parsed.origin, "instagram");
  assert.equal(parsed.coupon, "WELCOME10");
  assert.equal(parsed.utm_source, "z".repeat(100));
});

test("quantities are capped at 20 a line, as on the product page", async () => {
  const s = fakeStripe();
  await metaCheckout(q({ products: `${PELICAN}:50` }), { stripe: s.stripe, env: {} });
  assert.equal(s.creates[0].line_items![0].quantity, 20);
});

test("unknown ids are skipped; nothing valid -> the 'no longer available' page, no Stripe calls", async () => {
  const s = fakeStripe();
  const r = await metaCheckout(q({ products: `no-such-shirt-m:1,${SKY}:1`, cart_origin: "meta_shops" }), { stripe: s.stripe, env: {} });
  assert.equal(r.kind, "redirect");
  assert.equal(s.creates[0].line_items!.length, 1);
  assert.equal(r.event.data.skipped, 1);
  assert.match(r.log, /skipped no-such-shirt-m \(unknown id\)/);

  const none = fakeStripe();
  const r2 = await metaCheckout(q({ products: "no-such-shirt-m:1,old-thing:2", coupon: "WELCOME10" }), { stripe: none.stripe, env: {} });
  assert.equal(r2.kind, "unavailable");
  assert.deepEqual(r2.event, { name: "meta-checkout-unavailable", data: { origin: "unknown", requested: 2 } });
  assert.equal(none.creates.length + none.lists.length, 0);
  const r3 = await metaCheckout(q({}), { stripe: none.stripe, env: {} });
  assert.equal(r3.kind, "unavailable");
});

test("off-sale products are skipped, with their product kept for the links", () => {
  const { priced, skipped } = resolveMetaCart(
    [
      { id: PELICAN, qty: 1 },
      { id: SKY, qty: 1 },
    ],
    {},
    { block: (slug) => (slug === "sky-tee" ? { status: 409, error: "coming back soon with a new sky" } : null) }
  );
  assert.deepEqual(priced.map((p) => p.item.slug), ["pelican-tee"]);
  assert.deepEqual(skipped, [{ id: SKY, slug: "sky-tee", reason: "coming back soon with a new sky" }]);
});

test("a live coupon is applied up front (looked up by its code, any case)", async () => {
  const s = fakeStripe({ promos: { WELCOME10: "promo_welcome" } });
  const r = await metaCheckout(q({ products: `${PELICAN}:1`, coupon: "welcome10", cart_origin: "instagram" }), { stripe: s.stripe, env: {} });
  assert.deepEqual(s.lists, [{ code: "welcome10", active: true, limit: 1 }]);
  const params = s.creates[0];
  assert.deepEqual(params.discounts, [{ promotion_code: "promo_welcome" }]);
  assert.equal(params.allow_promotion_codes, undefined); // Stripe takes one or the other
  assert.equal(JSON.parse((params.metadata as Record<string, string>).mop_source).coupon, "welcome10");
  assert.equal(r.event.data.coupon, "applied");
  // the item metadata doesn't change with a coupon
  const plain = fakeStripe();
  await metaCheckout(q({ products: `${PELICAN}:1` }), { stripe: plain.stripe, env: {} });
  const { mop_source: _a, ...withCoupon } = params.metadata as Record<string, string>;
  const { mop_source: _b, ...without } = plain.creates[0].metadata as Record<string, string>;
  assert.deepEqual(withCoupon, without);
});

test("an unknown coupon (or a failed lookup) falls back to 'Add promotion code'", async () => {
  for (const s of [fakeStripe({ promos: { WELCOME10: "promo_welcome" } }), fakeStripe({ listThrows: true })]) {
    const r = await metaCheckout(q({ products: `${PELICAN}:1`, coupon: "BOGUS" }), { stripe: s.stripe, env: {} });
    assert.equal(r.kind, "redirect");
    assert.equal(s.creates.length, 1);
    assert.equal(s.creates[0].discounts, undefined);
    assert.equal(s.creates[0].allow_promotion_codes, true);
    assert.equal(r.event.data.coupon, "not found");
  }
  assert.equal(await findPromotionCode(fakeStripe().client, "has space"), null);
  assert.equal(await findPromotionCode(fakeStripe().client, ""), null);
});

test("a coupon Stripe won't apply to this cart: checkout still opens, with 'Add promotion code'", async () => {
  const s = fakeStripe({ promos: { THANKS10: "promo_thanks" }, refuseDiscounts: true });
  const r = await metaCheckout(q({ products: `${PELICAN}:1`, coupon: "THANKS10" }), { stripe: s.stripe, env: {} });
  assert.equal(r.kind, "redirect");
  assert.equal(s.creates.length, 2);
  assert.deepEqual(s.creates[0].discounts, [{ promotion_code: "promo_thanks" }]);
  assert.equal(s.creates[1].discounts, undefined);
  assert.equal(s.creates[1].allow_promotion_codes, true);
  assert.equal(r.event.data.coupon, "rejected");
});

test("other Stripe failures reach the route (which shows the try-again page)", async () => {
  await assert.rejects(metaCheckout(q({ products: `${PELICAN}:1` }), { stripe: fakeStripe({ createThrows: true }).stripe, env: {} }), /Stripe is down/);
});

test("cart_origin and utm_* tags are kept; anything else is ignored", () => {
  assert.deepEqual(metaSource(q({ cart_origin: "Instagram", utm_source: "ig", UTM_Medium: "paid", foo: "x" })), {
    origin: "instagram",
    utm: { utm_source: "ig", utm_medium: "paid" },
  });
  assert.equal(metaSource(q({ cart_origin: "tiktok" })).origin, "other");
  assert.equal(metaSource(q({ utm_source: "a\nb" })).utm.utm_source, "a?b");
  assert.equal(metaSource(q({})).origin, "unknown");
});

test("the Umami event goes to stats.chiefsmurph.com as the visitor; it never throws", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const visitor = { userAgent: "Mozilla/5.0 (iPhone) Instagram 300.0", ip: "203.0.113.9", language: "en-US,en;q=0.9", referrer: "https://l.instagram.com/" };
  assert.equal(await sendUmamiEvent("meta-checkout", { origin: "instagram", items: 2, value: 58 }, "/meta-checkout?cart_origin=instagram", visitor, { fetch: ok }), true);
  assert.equal(calls[0].url, "https://stats.chiefsmurph.com/api/send");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], visitor.userAgent);
  assert.equal(headers["X-Forwarded-For"], "203.0.113.9");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.type, "event");
  assert.equal(body.payload.website, UMAMI_WEBSITE_ID);
  assert.equal(body.payload.name, "meta-checkout");
  assert.equal(body.payload.hostname, "mopclothing.com");
  assert.equal(body.payload.language, "en-US");
  assert.deepEqual(body.payload.data, { origin: "instagram", items: 2, value: 58 });
  // no user agent: not sent; network failure: false, not a throw
  assert.equal(await sendUmamiEvent("x", {}, "/", { ...visitor, userAgent: null }, { fetch: ok }), false);
  assert.equal(calls.length, 1);
  const boom = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  assert.equal(await sendUmamiEvent("x", {}, "/", visitor, { fetch: boom }), false);
});

test("robots.txt keeps crawlers off /meta-checkout", () => {
  const r = robots();
  const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
  assert.deepEqual(rules.disallow, ["/meta-checkout"]);
  assert.equal(rules.allow, "/");
});
