// Shared test helpers: temp data dirs, fake fetch, fake Stripe sessions/events.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Stripe from "stripe";
import { createOrderStore } from "../lib/orders/store.ts";
import type { OrderDeps } from "../lib/orders/process.ts";
import type { OrderItem } from "../lib/orders/types.ts";
import { sessionMetadata } from "../lib/orders/metadata.ts";

export const TEST_SECRET = "whsec_test_secret_for_unit_tests";

export const tmpDir = () => mkdtempSync(path.join(os.tmpdir(), "mop-orders-"));

export const readJsonl = (file: string): any[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

export type Call = { url: string; method: string; body: any; headers: Record<string, string> };

/** A fetch that records calls and answers from `respond`. */
export function fakeFetch(respond: (call: Call, n: number) => { status: number; json?: unknown } | Error) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {})),
    };
    calls.push(call);
    const r = respond(call, calls.length);
    if (r instanceof Error) throw r;
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status });
  };
  return { fetch, calls };
}

/** Printful + Yoycol + PingPigeon all succeeding. */
export const happyResponder = (call: Call) => {
  if (call.url.startsWith("https://api.printful.com/orders")) {
    return {
      status: 200,
      json: {
        code: 200,
        result: {
          id: 777001,
          external_id: call.body?.external_id,
          status: call.url.includes("confirm=true") ? "pending" : "draft",
          dashboard_url: "https://www.printful.com/dashboard?order_id=777001",
          costs: { total: "17.95" },
        },
      },
    };
  }
  if (call.url.startsWith("https://www.yoycol.com/")) {
    return {
      status: 200,
      json: { code: "100000", msg: "success", data: { orderId: 5551, orderNo: "YC5551", orderRealAmount: 19.59, canPay: true } },
    };
  }
  if (call.url.endsWith("/email")) return { status: 200, json: { ok: true, id: "m1" } };
  return { status: 404, json: { error: "unexpected" } };
};

export function makeDeps(
  dir: string,
  fetch: OrderDeps["fetch"],
  env: Record<string, string | undefined> = {},
  extra: Partial<OrderDeps> = {}
): OrderDeps & { logs: string[] } {
  const logs: string[] = [];
  return {
    env: {
      PRINTFUL_API_TOKEN: "pf_test_token",
      YOYCOL_ACCESS_KEY: "AK_TEST",
      YOYCOL_SECRET_KEY: "SK_TEST",
      PINGPIGEON_TOKEN: "pp_test_token",
      ...env,
    },
    store: createOrderStore(dir),
    fetch,
    now: () => new Date("2026-10-12T18:00:00Z"),
    log: (m) => logs.push(m),
    retryDelayMs: 0,
    logs,
    ...extra,
  };
}

export const printfulItem = (over: Partial<OrderItem> = {}): OrderItem => ({
  slug: "test-pelican-tee",
  title: "Pelican Tee",
  supplier: "printful",
  qty: 1,
  opts: { version: "large", style: "beanie", color: "Ivory", size: "M" },
  unitAmount: 2900,
  printful: { syncVariantId: 4242 },
  ...over,
});

export const yoycolItem = (over: Partial<OrderItem> = {}): OrderItem => ({
  slug: "clouds-in-sky-shirt",
  title: "Clouds In Sky Shirt",
  supplier: "yoycol",
  qty: 1,
  opts: { size: "L" },
  unitAmount: 3600,
  yoycol: { designCode: "LRVV1", skuCode: "ADS-3MTXVYM32-00000-FFFFFF-L" },
  ...over,
});

export function makeSession(items: OrderItem[], over: Record<string, unknown> = {}) {
  const total = items.reduce((n, i) => n + i.unitAmount * i.qty, 0);
  return {
    id: "cs_test_a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ0123456789abcdefghijklmnop",
    object: "checkout.session",
    created: 1791835200,
    livemode: false,
    payment_status: "paid",
    payment_intent: "pi_test_123",
    currency: "usd",
    amount_total: total,
    amount_subtotal: total,
    total_details: { amount_shipping: 0, amount_discount: 0, amount_tax: 0 },
    metadata: sessionMetadata(items),
    customer_details: {
      name: "Ana Diaz",
      email: "ana@example.com",
      phone: "+13105550100",
      address: { line1: "1 Billing St", city: "Nowhere", state: "CA", postal_code: "90000", country: "US" },
    },
    collected_information: {
      shipping_details: {
        name: "Ana Maria Diaz",
        address: { line1: "123 Main St", line2: "Apt 4", city: "Los Angeles", state: "CA", postal_code: "90026", country: "US" },
      },
    },
    ...over,
  };
}

export const makeEvent = (session: unknown, type = "checkout.session.completed") => ({
  id: "evt_test_1",
  object: "event",
  type,
  data: { object: session },
});

/** A body + stripe-signature header, signed like Stripe does. */
export function signed(event: unknown, secret = TEST_SECRET, timestamp?: number) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
  return { payload, header };
}
