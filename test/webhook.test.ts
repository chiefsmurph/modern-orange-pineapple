// Signature check, idempotency, supplier calls, failures and the email.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { verifyStripeEvent } from "../lib/orders/stripe-verify.ts";
import { handleStripeEvent } from "../lib/orders/process.ts";
import { orderRefFor } from "../lib/orders/session.ts";
import { yoycolSignature } from "../lib/orders/yoycol.ts";
import { printfulOrderRequest } from "../lib/orders/printful.ts";
import { buildOrderRecord } from "../lib/orders/session.ts";
import {
  TEST_SECRET,
  fakeFetch,
  happyResponder,
  makeDeps,
  makeEvent,
  makeSession,
  printfulItem,
  readJsonl,
  signed,
  tmpDir,
  yoycolItem,
} from "./helpers.ts";

// --- signature -------------------------------------------------------------

test("a correctly signed event verifies", () => {
  const event = makeEvent(makeSession([printfulItem()]));
  const { payload, header } = signed(event);
  assert.equal(verifyStripeEvent(payload, header, TEST_SECRET).type, "checkout.session.completed");
});

test("tampered body, wrong secret, old timestamp, missing header/secret are rejected", () => {
  const event = makeEvent(makeSession([printfulItem()]));
  const { payload, header } = signed(event);
  assert.throws(() => verifyStripeEvent(payload.replace("2900", "1"), header, TEST_SECRET), /signature/i);
  assert.throws(() => verifyStripeEvent(payload, header, "whsec_other"), /signature/i);
  const old = signed(event, TEST_SECRET, Math.floor(Date.now() / 1000) - 3600);
  assert.throws(() => verifyStripeEvent(old.payload, old.header, TEST_SECRET), /tolerance/i);
  assert.throws(() => verifyStripeEvent(payload, null, TEST_SECRET), /missing/);
  assert.throws(() => verifyStripeEvent(payload, header, undefined), /not set/);
});

// --- processing ------------------------------------------------------------

test("a paid session: recorded, Printful draft + Yoycol order, royalties, one email", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  const deps = makeDeps(dir, fetch);
  const session = makeSession([printfulItem({ slug: "pelican-beanie-t-shirt", supplier: "printful" }), yoycolItem()]);
  const res = await handleStripeEvent(makeEvent(session), deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "done");

  const ref = orderRefFor(session.id);
  assert.match(ref, /^mop-[0-9a-f]{28}$/);
  const pf = calls.find((c) => c.url.startsWith("https://api.printful.com"))!;
  assert.equal(pf.url, "https://api.printful.com/orders"); // draft: no confirm=true
  assert.equal(pf.headers.Authorization, "Bearer pf_test_token");
  assert.equal(pf.body.external_id, ref);
  assert.deepEqual(pf.body.items, [{ sync_variant_id: 4242, quantity: 1, retail_price: "29.00", name: "Pelican Tee (Large · Grind Beanie · Ivory · M)" }]);
  assert.deepEqual(pf.body.recipient, {
    name: "Ana Maria Diaz",
    address1: "123 Main St",
    address2: "Apt 4",
    city: "Los Angeles",
    state_code: "CA",
    country_code: "US",
    zip: "90026",
    phone: "+13105550100",
    email: "ana@example.com",
  });
  assert.equal(pf.body.retail_costs.subtotal, "29.00"); // only the Printful item
  assert.equal(pf.body.retail_costs.total, "29.00");

  const yc = calls.find((c) => c.url.startsWith("https://www.yoycol.com"))!;
  assert.equal(yc.body.storeOrderSn, ref);
  assert.deepEqual(yc.body.items[0], {
    source: "productTemplate",
    designCode: "LRVV1",
    skuCode: "ADS-3MTXVYM32-00000-FFFFFF-L",
    quantity: 1,
    thirdItemId: `${ref}-1`,
    title: "Clouds In Sky Shirt (L)",
    realPrice: 36,
  });
  assert.equal(yc.body.address.phone, "+13105550100");
  assert.equal(yc.body.address.firstName, "Ana Maria");
  assert.equal(yc.body.address.lastName, "Diaz");
  assert.equal(yc.headers["X-API-Access-Key"], "AK_TEST");
  assert.ok(yc.headers["X-API-Signature"]);

  const mail = calls.filter((c) => c.url.endsWith("/email"));
  assert.equal(mail.length, 1);
  assert.equal(mail[0].url, "http://127.0.0.1:3141/email");
  assert.equal(mail[0].headers.Authorization, "Bearer pp_test_token");
  assert.match(mail[0].body.subject, /confirm Printful draft #777001; pay Yoycol order YC5551/);
  assert.match(mail[0].body.body, /https:\/\/www\.printful\.com\/dashboard\?order_id=777001/);
  assert.match(mail[0].body.body, /janette: \$1\.50/);
  assert.match(mail[0].body.body, /Phone: \+13105550100/);

  const orders = readJsonl(path.join(dir, "orders.jsonl"));
  assert.deepEqual(orders.map((o) => o.type), ["order", "fulfilment"]);
  assert.equal(orders[0].customer.phone, "+13105550100");
  const royalties = readJsonl(path.join(dir, "royalties.jsonl"));
  assert.deepEqual(royalties.map((r) => [r.artist, r.amount, r.order_ref]), [["janette", 1.5, ref]]);
});

test("the same event twice (or the async success after completed) creates nothing new", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  const deps = makeDeps(dir, fetch);
  const session = makeSession([printfulItem({ slug: "pelican-beanie-t-shirt" })]);
  await handleStripeEvent(makeEvent(session), deps);
  const n = calls.length;
  const again = await handleStripeEvent(makeEvent(session), deps);
  const async = await handleStripeEvent(makeEvent(session, "checkout.session.async_payment_succeeded"), deps);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(async.body.duplicate, true);
  assert.equal(calls.length, n);
  assert.equal(readJsonl(path.join(dir, "royalties.jsonl")).length, 1);
  assert.equal(readJsonl(path.join(dir, "orders.jsonl")).filter((o) => o.type === "order").length, 1);
});

test("two deliveries at once: one processes, the other is told to retry later", async () => {
  const dir = tmpDir();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { fetch, calls } = fakeFetch(happyResponder);
  const slowFetch = async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://api.printful.com")) await gate;
    return fetch(url, init);
  };
  const deps = makeDeps(dir, slowFetch);
  const session = makeSession([printfulItem()]);
  const first = handleStripeEvent(makeEvent(session), deps);
  await new Promise((r) => setTimeout(r, 20));
  const second = await handleStripeEvent(makeEvent(session), deps);
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.printful.com")).length, 1);
});

test("a crash mid-way is resumed by Stripe's retry without repeating finished steps", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  const session = makeSession([printfulItem(), yoycolItem()]);
  // First run: Yoycol never answers (network error, retried once -> recorded as failed),
  // then writing royalties throws: the run stops with the order recorded.
  const noYoycol = async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://www.yoycol.com")) throw new TypeError("fetch failed");
    return fetch(url, init);
  };
  const deps1 = makeDeps(dir, noYoycol);
  const failingStore = { ...deps1.store, appendRoyalties: async () => { throw new Error("disk full"); } };
  const r1 = await handleStripeEvent(makeEvent(session), { ...deps1, store: failingStore });
  assert.equal(r1.status, 500);
  const pfCalls = calls.filter((c) => c.url.startsWith("https://api.printful.com")).length;
  assert.equal(pfCalls, 1);

  // Stripe retries: Printful is not called again; royalties and email happen once.
  const r2 = await handleStripeEvent(makeEvent(session), makeDeps(dir, fetch));
  assert.equal(r2.status, 200);
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.printful.com")).length, 1);
  assert.equal(readJsonl(path.join(dir, "royalties.jsonl")).length, 0); // plain printfulItem slug has no rules
  assert.equal(readJsonl(path.join(dir, "orders.jsonl")).filter((o) => o.type === "order").length, 1);
  // Yoycol had failed (network) in run 1 and stays failed: John was told to place it by hand.
  const mails = calls.filter((c) => c.url.endsWith("/email"));
  assert.ok(mails.some((m) => /ACTION NEEDED/.test(m.body.subject) && /Yoycol FAILED/.test(m.body.subject)));
});

test("Printful 5xx is retried once; a second failure emails ACTION NEEDED and still returns 200", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch((call) =>
    call.url.startsWith("https://api.printful.com")
      ? { status: 502, json: { code: 502, result: "Bad Gateway" } }
      : happyResponder(call)
  );
  const deps = makeDeps(dir, fetch);
  const res = await handleStripeEvent(makeEvent(makeSession([printfulItem()])), deps);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "done_with_errors");
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.printful.com")).length, 2);
  const mail = calls.find((c) => c.url.endsWith("/email"))!;
  assert.match(mail.body.subject, /^ACTION NEEDED: MOP order/);
  assert.match(mail.body.body, /Printful order FAILED: HTTP 502/);
  assert.equal(readJsonl(path.join(dir, "orders.jsonl"))[0].type, "order"); // the order is still on record
});

test("Printful says the external id exists (a retry after a lost response): the existing order is used", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch((call) => {
    if (call.url === "https://api.printful.com/orders")
      return { status: 400, json: { code: 400, result: "Order with this External ID already exists", error: { message: "Order with this External ID already exists" } } };
    if (call.url.startsWith("https://api.printful.com/orders/@"))
      return { status: 200, json: { code: 200, result: { id: 9001, status: "draft", dashboard_url: "https://www.printful.com/dashboard?order_id=9001" } } };
    return happyResponder(call);
  });
  const res = await handleStripeEvent(makeEvent(makeSession([printfulItem()])), makeDeps(dir, fetch));
  assert.equal(res.body.status, "done");
  assert.ok(calls.some((c) => c.url === `https://api.printful.com/orders/@${orderRefFor(makeSession([]).id)}`));
});

test("PRINTFUL_AUTO_CONFIRM=true confirms; the email says so", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  await handleStripeEvent(makeEvent(makeSession([printfulItem()])), makeDeps(dir, fetch, { PRINTFUL_AUTO_CONFIRM: "true" }));
  assert.equal(calls[0].url, "https://api.printful.com/orders?confirm=true");
  assert.match(calls.find((c) => c.url.endsWith("/email"))!.body.subject, /Printful #777001 pending/);
});

test("the email is retried once and its failure never loses the order", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch((call) => (call.url.endsWith("/email") ? new Error("ECONNREFUSED") : happyResponder(call)));
  const res = await handleStripeEvent(makeEvent(makeSession([printfulItem()])), makeDeps(dir, fetch));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "done_with_errors");
  assert.equal(calls.filter((c) => c.url.endsWith("/email")).length, 2);
  const fulfil = readJsonl(path.join(dir, "orders.jsonl")).find((o) => o.type === "fulfilment");
  assert.equal(fulfil.emailed, false);
  assert.equal(fulfil.suppliers.printful.ok, true);
});

test("if the order can't be recorded, nothing is sent and Stripe is asked to retry", async () => {
  const dir = tmpDir();
  // the data dir path is a file, so nothing can be written there
  const blocked = path.join(dir, "blocked");
  writeFileSync(blocked, "not a directory");
  const { fetch, calls } = fakeFetch(happyResponder);
  const res = await handleStripeEvent(makeEvent(makeSession([printfulItem()])), makeDeps(blocked, fetch));
  assert.equal(res.status, 500);
  assert.equal(calls.length, 0);
});

test("unpaid (async) sessions wait for async_payment_succeeded", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  const deps = makeDeps(dir, fetch);
  const pending = makeSession([printfulItem()], { payment_status: "unpaid" });
  const r1 = await handleStripeEvent(makeEvent(pending), deps);
  assert.equal(r1.body.awaiting_payment, true);
  assert.equal(calls.length, 0);
  const r2 = await handleStripeEvent(makeEvent({ ...pending, payment_status: "paid" }, "checkout.session.async_payment_succeeded"), deps);
  assert.equal(r2.body.status, "done");
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.printful.com")).length, 1);
});

test("other event types are acknowledged and ignored", async () => {
  const { fetch, calls } = fakeFetch(happyResponder);
  const res = await handleStripeEvent({ type: "payment_intent.created", data: { object: {} } }, makeDeps(tmpDir(), fetch));
  assert.equal(res.status, 200);
  assert.equal(res.body.ignored, "payment_intent.created");
  assert.equal(calls.length, 0);
});

test("ORDER_DRY_RUN=1 logs the exact payloads and sends nothing", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  const deps = makeDeps(dir, fetch, { ORDER_DRY_RUN: "1" });
  const res = await handleStripeEvent(makeEvent(makeSession([printfulItem(), yoycolItem()])), deps);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
  const log = deps.logs.join("\n");
  assert.match(log, /DRY-RUN Printful POST https:\/\/api\.printful\.com\/orders\n\{/);
  assert.match(log, /"sync_variant_id": 4242/);
  assert.match(log, /DRY-RUN Yoycol POST/);
  assert.match(log, /"skuCode": "ADS-3MTXVYM32-00000-FFFFFF-L"/);
  assert.match(log, /DRY-RUN email to John\nSubject: \[DRY RUN\]/);
  assert.doesNotMatch(log, /pf_test_token|SK_TEST|pp_test_token/); // never log secrets
});

test("sessions from before this code: items come from Stripe line items", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  const session = makeSession([], { metadata: {}, amount_total: 3600 });
  const deps = makeDeps(dir, fetch, {}, {
    listLineItems: async () => [
      { quantity: 1, price: { unit_amount: 3600, product: { name: "Clouds In Sky Shirt", metadata: { productId: "clouds-in-sky-shirt", size: "M" } } } },
    ],
  });
  const res = await handleStripeEvent(makeEvent(session), deps);
  assert.equal(res.body.status, "done");
  const yc = calls.find((c) => c.url.startsWith("https://www.yoycol.com"))!;
  assert.equal(yc.body.items[0].skuCode, "ADS-3MTXVYM32-00000-FFFFFF-M");
  assert.equal(readJsonl(path.join(dir, "orders.jsonl"))[0].items_source, "line_items");
});

test("a session whose items can't be read still emails John ACTION NEEDED", async () => {
  const dir = tmpDir();
  const { fetch, calls } = fakeFetch(happyResponder);
  const deps = makeDeps(dir, fetch, {}, { listLineItems: async () => { throw new Error("permission denied"); } });
  const res = await handleStripeEvent(makeEvent(makeSession([], { metadata: {} })), deps);
  assert.equal(res.body.status, "done_with_errors");
  const mail = calls.find((c) => c.url.endsWith("/email"))!;
  assert.match(mail.body.subject, /^ACTION NEEDED: MOP order: unknown items/);
  assert.equal(readJsonl(path.join(dir, "orders.jsonl"))[0].items_source, "none");
});

test("older API versions put the address in shipping_details", async () => {
  const session = makeSession([printfulItem()], {
    collected_information: undefined,
    shipping_details: { name: "Old Api", address: { line1: "9 Elm", city: "Austin", state: "TX", postal_code: "78701", country: "US" } },
  });
  const rec = await buildOrderRecord(session);
  const req = printfulOrderRequest(rec, rec.items, {});
  assert.equal((req.body.recipient as any).name, "Old Api");
  assert.equal((req.body.recipient as any).state_code, "TX");
});

test("state_code goes to Printful only for US/CA/AU", async () => {
  const uk = makeSession([printfulItem()], {
    collected_information: {
      shipping_details: { name: "Jo Bloggs", address: { line1: "1 High St", city: "Leeds", state: "West Yorkshire", postal_code: "LS1 1AA", country: "GB" } },
    },
  });
  const rec = await buildOrderRecord(uk);
  const recipient = printfulOrderRequest(rec, rec.items, {}).body.recipient as any;
  assert.equal(recipient.state_code, undefined);
  assert.equal(recipient.country_code, "GB");
});

// --- Yoycol signing ----------------------------------------------------------

test("Yoycol V4 signature matches the documented test vector", () => {
  assert.equal(
    yoycolSignature({
      method: "GET",
      path: "/api/2025/open/v4/catalog/products",
      query: { page: "1", query: "O-Neck", size: "20" },
      timestamp: "1702886400000",
      nonce: "0123456789abcdef0123456789abcdef",
      accessKey: "AK_TEST",
      secretKey: "SK_TEST",
    }),
    "AVeohsLQ+n2aNdOjVedzRkXOgCm9MV8QRhfuIPmwJU4="
  );
});
