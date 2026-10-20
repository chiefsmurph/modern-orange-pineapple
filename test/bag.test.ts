// The shopping bag: lib/bag.ts (browser), lib/orders/bag-checkout.ts (POST /api/bag-checkout),
// and a multi-line order through the webhook.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type Stripe from "stripe";
import { addLine, bagCount, bagId, lineView, MAX_BAG_LINES, removeLine, setQty, validateBag, variantSummary } from "../lib/bag.ts";
import { bagCheckout, parseBagBody } from "../lib/orders/bag-checkout.ts";
import { buildItem } from "../lib/orders/build-items.ts";
import { checkoutSessionParams } from "../lib/orders/checkout.ts";
import { itemsFromSessionMetadata } from "../lib/orders/metadata.ts";
import { handleStripeEvent } from "../lib/orders/process.ts";
import { createItemCodeStore } from "../lib/item-codes.ts";
import { getShopProduct } from "../lib/catalog/index.ts";
import { fakeFetch, happyResponder, makeDeps, makeEvent, makeSession, readJsonl, tmpDir, yoycolItem } from "./helpers.ts";

const opts = (slug: string, pick: Record<string, string>) => {
  const p = getShopProduct(slug)!;
  const v = p.variants.find((x) => Object.entries(pick).every(([k, val]) => x.opts[k] === val))!;
  assert.ok(v, `${slug} ${JSON.stringify(pick)}`);
  return v.opts;
};
const PELICAN = opts("pelican-tee", { version: "large", style: "classic", color: "Lagoon Blue", size: "M" });
const DAY = opts("day-all-over", { style: "beanie", size: "M" });
const DUSK = opts("dusk-all-over", { size: "L" });
const NIGHT = opts("night-all-over", { size: "S" });
const id = (slug: string, o: Record<string, string>) => bagId(slug, o);

function fakeStripe() {
  const creates: Stripe.Checkout.SessionCreateParams[] = [];
  return {
    creates,
    stripe: () => ({
      checkout: {
        sessions: {
          create: async (p: Stripe.Checkout.SessionCreateParams) => {
            creates.push(p);
            return { id: `cs_test_bag_${creates.length}`, url: `https://checkout.stripe.com/c/pay/cs_test_bag_${creates.length}` };
          },
        },
      },
    }),
  };
}

test("bag lines: add (same variant adds up), quantities 1-20, remove, count", () => {
  let lines = addLine([], id("pelican-tee", PELICAN), "Pelican Tee").lines;
  lines = addLine(lines, id("pelican-tee", PELICAN)).lines;
  lines = addLine(lines, id("dusk-all-over", DUSK), "Dusk · Alpaca All-Over").lines;
  assert.deepEqual(lines.map((l) => [l.id, l.qty]), [
    ["pelican-tee-large-classic-lagoon-blue-m", 2],
    [id("dusk-all-over", DUSK), 1],
  ]);
  assert.equal(bagCount(lines), 3);
  assert.equal(setQty(lines, lines[0].id, 50)[0].qty, 20);
  assert.equal(setQty(lines, lines[0].id, 0)[0].qty, 1);
  assert.deepEqual(removeLine(lines, lines[0].id).map((l) => l.id), [lines[1].id]);
  // full: 20 of one item, or 20 different items
  const twenty = setQty(lines, lines[0].id, 20);
  assert.equal(addLine(twenty, lines[0].id).ok, false);
  const many = Array.from({ length: MAX_BAG_LINES }, (_, i) => ({ id: `x${i}`, qty: 1 }));
  assert.equal(addLine(many, "another").ok, false);
});

test("what's shown comes from the catalog: name, picks, price, photo, link", () => {
  const v = lineView({ id: id("pelican-tee", PELICAN), qty: 2 })!;
  assert.equal(v.title, "Pelican Tee");
  assert.equal(v.summary, "Big · Classic · Lagoon Blue · M");
  assert.equal(v.unitPrice, 35);
  assert.match(v.image, /^\/images\/catalog\/pelican-tee\/.+-checkout\.jpg$/);
  assert.equal(v.href, "/pelican-tee?version=large&style=classic&color=Lagoon+Blue&size=M");
  assert.equal(lineView({ id: id("sky-tee", opts("sky-tee", { sky: "aurora", size: "M" })), qty: 1 })!.unitPrice, 45);
  assert.equal(variantSummary(getShopProduct("star-snapback")!, getShopProduct("star-snapback")!.variants[0].opts).includes("One size"), false);
  assert.equal(lineView({ id: "no-such-shirt-m", qty: 1 }), null);
});

test("a stored bag is checked on load: unknown or off-sale items dropped with their name, junk ignored", () => {
  const { lines, dropped } = validateBag({
    v: 1,
    lines: [
      { id: id("pelican-tee", PELICAN), qty: 2, t: "Pelican Tee" },
      { id: id("pelican-tee", PELICAN), qty: 30 },
      { id: "old-shirt-xl", qty: 1, t: "Old Shirt" },
      { id: id("dusk-all-over", DUSK), qty: "abc" },
      { id: 5, qty: 1 },
      null,
    ],
  });
  assert.deepEqual(lines, [{ id: id("pelican-tee", PELICAN), qty: 20, t: "Pelican Tee" }]);
  assert.deepEqual(dropped, ["Old Shirt"]);
  assert.deepEqual(validateBag(null), { lines: [], dropped: [] });
  assert.deepEqual(validateBag("garbage"), { lines: [], dropped: [] });
});

test("the request body: ids + whole quantities only", () => {
  assert.deepEqual(parseBagBody({ lines: [] }), { error: "Your bag is empty." });
  assert.ok("error" in parseBagBody({ lines: [{ id: "x", qty: 0 }] }));
  assert.ok("error" in parseBagBody({ lines: [{ id: "x", qty: 21 }] }));
  assert.ok("error" in parseBagBody({ lines: [{ id: "x", qty: 1.5 }] }));
  assert.ok("error" in parseBagBody({ lines: [{ id: "<script>", qty: 1 }] }));
  assert.ok("error" in parseBagBody({ lines: Array.from({ length: 21 }, (_, i) => ({ id: `x${i}`, qty: 1 })) }));
  assert.deepEqual(parseBagBody({ lines: [{ id: "A-b", qty: 2 }, { id: "a-b", qty: 3 }] }), { lines: [{ id: "a-b", qty: 5 }] });
});

test("checkout: one Stripe session for every line, priced by the catalog, same metadata as the product page", async () => {
  const s = fakeStripe();
  const body = {
    lines: [
      { id: id("pelican-tee", PELICAN), qty: 2, price: 1 }, // a price from the browser is ignored
      { id: id("day-all-over", DAY), qty: 1 },
      { id: id("night-all-over", NIGHT), qty: 3 },
    ],
  };
  const r = await bagCheckout(body, { stripe: s.stripe, env: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { url: "https://checkout.stripe.com/c/pay/cs_test_bag_1" });
  const p = s.creates[0];
  assert.equal(p.line_items!.length, 3);
  assert.deepEqual(p.line_items!.map((l) => [l.price_data!.product_data!.metadata!.productId, l.quantity, l.price_data!.unit_amount]), [
    ["pelican-tee", 2, 3500],
    ["day-all-over", 1, 4500],
    ["night-all-over", 3, 4500],
  ]);
  assert.equal(p.allow_promotion_codes, true);
  assert.equal(p.discounts, undefined);
  assert.deepEqual(p.shipping_address_collection?.allowed_countries, ["US"]);
  assert.equal(p.phone_number_collection?.enabled, true);
  assert.equal(p.shipping_options![0].shipping_rate_data!.fixed_amount!.amount, 0);
  assert.equal(p.success_url, "https://mopclothing.com/bag?status=success");
  assert.equal(p.cancel_url, "https://mopclothing.com/bag");
  const md = p.metadata as Record<string, string>;
  assert.equal(md.mop_source, '{"via":"bag"}');
  assert.equal(md.mop_n, "3");
  // each item exactly as the product page's checkout makes it
  const items = itemsFromSessionMetadata(md)!;
  for (const [i, it] of items.entries()) {
    const single = checkoutSessionParams(buildItem(it.slug, it.opts, it.qty, {}));
    assert.equal(md[`mop_item_${i}`], (single.metadata as Record<string, string>).mop_item_0);
    assert.deepEqual(p.line_items![i], single.line_items![0]);
  }
  assert.equal(r.status === 200 && r.value, 2 * 35 + 45 + 3 * 45);
});

test("checkout: anything no longer sold is named back (nothing charged); bad requests are refused", async () => {
  const s = fakeStripe();
  const r = await bagCheckout({ lines: [{ id: id("pelican-tee", PELICAN), qty: 1 }, { id: "old-shirt-xl", qty: 1 }] }, { stripe: s.stripe, env: {} });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: "Some items in your bag are no longer available.", unavailable: ["old-shirt-xl"] });
  assert.equal(s.creates.length, 0);
  assert.equal((await bagCheckout({}, { stripe: s.stripe, env: {} })).status, 400);
  assert.equal((await bagCheckout({ lines: [{ id: "x", qty: 99 }] }, { stripe: s.stripe, env: {} })).status, 400);
  assert.equal(s.creates.length, 0);
});

test("a paid bag (3 Printful lines with quantities, plus a Yoycol item): one order per supplier, codes per unit, royalties per item, one email", async () => {
  const s = fakeStripe();
  await bagCheckout(
    {
      lines: [
        { id: id("day-all-over", DAY), qty: 2 },
        { id: id("dusk-all-over", DUSK), qty: 1 },
        { id: id("night-all-over", NIGHT), qty: 3 },
      ],
    },
    { stripe: s.stripe, env: {} }
  );
  const bagItems = itemsFromSessionMetadata(s.creates[0].metadata as Record<string, string>)!;
  // a Yoycol item in the same order (the older all-overs): fulfilment splits by supplier
  const items = [...bagItems, yoycolItem()];
  const session = makeSession(items);
  const dir = tmpDir();
  const codes = createItemCodeStore(dir);
  const { fetch, calls } = fakeFetch(happyResponder);
  const deps = makeDeps(dir, fetch, {}, { codes });
  const res = await handleStripeEvent(makeEvent(session), deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "done");

  const pf = calls.filter((c) => c.url.startsWith("https://api.printful.com/orders"));
  assert.equal(pf.length, 1);
  assert.deepEqual(
    pf[0].body.items.map((i: { sync_variant_id: number; quantity: number; retail_price: string }) => [i.sync_variant_id, i.quantity, i.retail_price]),
    bagItems.map((i) => [i.printful!.syncVariantId, i.qty, "45.00"])
  );
  assert.equal(pf[0].body.retail_costs.subtotal, "270.00"); // (2 + 1 + 3) x $45
  assert.equal(calls.filter((c) => c.url.startsWith("https://www.yoycol.com/")).length >= 1, true);

  // one registration code per unit: 2 + 1 + 3 + 1
  const issued = await codes.readAll();
  assert.equal(issued.length, 7);
  assert.deepEqual(
    Object.fromEntries(["day-all-over", "dusk-all-over", "night-all-over", "clouds-in-sky-shirt"].map((slug) => [slug, issued.filter((c) => c.slug === slug).length])),
    { "day-all-over": 2, "dusk-all-over": 1, "night-all-over": 3, "clouds-in-sky-shirt": 1 }
  );

  // royalties per item: Janette on the Day Grind Beanie (x2), Austin on Dusk (x1), none on Night
  const royalties = readJsonl(path.join(dir, "royalties.jsonl"));
  const by = (artist: string) => royalties.filter((r) => r.artist === artist).reduce((n, r) => n + r.amount, 0);
  assert.equal(royalties.filter((r) => r.slug === "night-all-over").length, 0);
  assert.equal(by("janette"), 3);
  assert.equal(by("austin"), 1.5);
  assert.deepEqual(royalties.find((r) => r.slug === "day-all-over")?.qty, 2);

  // John's email: one, with every line
  const emails = calls.filter((c) => c.url.endsWith("/email"));
  assert.equal(emails.length, 1);
  for (const t of ["2 x Day · Pelican All-Over", "Dusk · Alpaca All-Over", "3 x Night · Rabbit All-Over", "Clouds In Sky Shirt"])
    assert.ok(emails[0].body.subject.includes(t) || emails[0].body.body.includes(t), t);
});
