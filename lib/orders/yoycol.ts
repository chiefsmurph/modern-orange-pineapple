// Yoycol Open API v4 order creation (POST https://www.yoycol.com/api/2025/open/v4/orders).
//
// - Auth: HMAC-SHA256 "V4" headers from YOYCOL_ACCESS_KEY / YOYCOL_SECRET_KEY.
//   The signed text is method, path, timestamp, nonce, accessKey, algorithm and
//   version (+ sorted raw query params when there is a query), joined by "\n";
//   the body is not signed. Verified live (read-only) on 2026-10-11.
// - Items reference John's saved Product Templates: designCode + skuCode
//   (yoycol-config.ts; designCodes overridable with YOYCOL_DESIGN_CODES).
// - Orders arrive UNPAID: nothing is made until John pays in the Yoycol dashboard.
// - storeOrderSn = the order ref (mop-<28 hex>). Yoycol has no documented
//   duplicate check, so before retrying an ambiguous failure (no response) we
//   look for the order ref among recent orders.
// - ORDER_DRY_RUN=1 logs the exact request instead of sending it.
import crypto from "node:crypto";
import { describeFailure, isRetryable, requestJson, sleep, type FetchLike } from "./http.ts";
import { itemSummary } from "./build-items.ts";
import type { OrderItem, OrderRecord, SupplierResult } from "./types.ts";

export const YOYCOL_API = "https://www.yoycol.com";
export const YOYCOL_ORDERS_PATH = "/api/2025/open/v4/orders";
/** Standard Shipping (8–15 business days to the US). */
export const DEFAULT_SHIPPING_LEVEL = "vSt5rbZe";

export function yoycolSignature(input: {
  method: string;
  path: string;
  query?: Record<string, string>;
  timestamp: string;
  nonce: string;
  accessKey: string;
  secretKey: string;
}) {
  const params = Object.keys(input.query ?? {})
    .sort()
    .map((k) => `${k}=${input.query![k]}`)
    .join("&");
  let data =
    `method=${input.method.toUpperCase()}\npath=${input.path}\ntimestamp=${input.timestamp}` +
    `\nnonce=${input.nonce}\naccessKey=${input.accessKey}\nalgorithm=HmacSHA256\nversion=4.0`;
  if (params) data += `\nparams=${params}`;
  return crypto.createHmac("sha256", input.secretKey).update(data, "utf8").digest("base64");
}

export function yoycolHeaders(input: {
  method: string;
  path: string;
  query?: Record<string, string>;
  accessKey: string;
  secretKey: string;
  timestamp?: string;
  nonce?: string;
}) {
  const timestamp = input.timestamp ?? String(Date.now());
  const nonce = input.nonce ?? crypto.randomBytes(16).toString("hex");
  return {
    "X-API-Access-Key": input.accessKey,
    "X-API-Timestamp": timestamp,
    "X-API-Nonce": nonce,
    "X-API-Algorithm": "HmacSHA256",
    "X-API-Version": "4.0",
    "X-API-Signature": yoycolSignature({ ...input, timestamp, nonce }),
    "Content-Type": "application/json",
  };
}

const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: parts[0] ?? "", lastName: parts[0] ?? "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
};

export function yoycolOrderBody(
  record: OrderRecord,
  items: OrderItem[],
  env: Record<string, string | undefined>
) {
  const { customer } = record;
  const a = customer.address;
  return {
    storeOrderSn: record.order_ref,
    shippingLevelCode: env.YOYCOL_SHIPPING_LEVEL || DEFAULT_SHIPPING_LEVEL,
    autoSwitchShippingLevel: true,
    currency: "USD",
    remark: `mopclothing.com ${record.order_ref}`,
    thirdCreatedAt: record.created,
    address: {
      ...splitName(customer.name),
      phone: customer.phone,
      email: customer.email,
      country: a.country ?? "",
      province: a.state ?? "",
      city: a.city ?? "",
      zip: a.postal_code ?? "",
      address1: a.line1 ?? "",
      address2: a.line2 ?? "",
    },
    items: items.map((i, n) => ({
      source: "productTemplate",
      designCode: i.yoycol!.designCode,
      skuCode: i.yoycol!.skuCode,
      quantity: i.qty,
      thirdItemId: `${record.order_ref}-${n + 1}`,
      title: `${i.title} (${itemSummary(i)})`,
      realPrice: i.unitAmount / 100,
    })),
  };
}

const ok = (r: { ok: boolean; json: any }) => r.ok && r.json?.code === "100000";

export async function createYoycolOrder(
  record: OrderRecord,
  items: OrderItem[],
  deps: {
    env: Record<string, string | undefined>;
    fetch: FetchLike;
    log: (msg: string) => void;
    now: () => Date;
    retryDelayMs?: number;
  }
): Promise<SupplierResult> {
  const { env, log } = deps;
  const at = deps.now().toISOString();
  const body = yoycolOrderBody(record, items, env);
  const url = `${YOYCOL_API}${YOYCOL_ORDERS_PATH}`;

  if (env.ORDER_DRY_RUN === "1") {
    log(`[orders] DRY-RUN Yoycol POST ${url} (signed V4 headers omitted)\n${JSON.stringify(body, null, 2)}`);
    return {
      supplier: "yoycol",
      ok: true,
      dryRun: true,
      id: "DRY-RUN",
      action: "DRY RUN: nothing was sent to Yoycol.",
      at,
    };
  }
  const accessKey = env.YOYCOL_ACCESS_KEY;
  const secretKey = env.YOYCOL_SECRET_KEY;
  if (!accessKey || !secretKey) {
    return { supplier: "yoycol", ok: false, error: "YOYCOL_ACCESS_KEY / YOYCOL_SECRET_KEY are not set", at };
  }

  const send = () =>
    requestJson(deps.fetch, url, {
      method: "POST",
      headers: yoycolHeaders({ method: "POST", path: YOYCOL_ORDERS_PATH, accessKey, secretKey }),
      body: JSON.stringify(body),
    });
  // Did an earlier attempt land after all? Look for our order ref in recent orders.
  const findExisting = async () => {
    const query = { page: "1", size: "20" };
    const r = await requestJson(
      deps.fetch,
      `${url}?${new URLSearchParams(query)}`,
      { method: "GET", headers: yoycolHeaders({ method: "GET", path: YOYCOL_ORDERS_PATH, query, accessKey, secretKey }) }
    );
    if (!ok(r)) return undefined;
    return (r.json.data?.records ?? []).find((o: unknown) => JSON.stringify(o).includes(record.order_ref));
  };

  let r = await send();
  if (!ok(r) && isRetryable(r)) {
    log(`[orders] ${record.order_ref}: Yoycol ${describeFailure(r)}; retrying once`);
    await sleep(deps.retryDelayMs ?? 2000);
    const landed = r.status === 0 ? await findExisting() : undefined;
    if (landed) r = { ok: true, status: 200, text: "", json: { code: "100000", data: landed } };
    else r = await send();
  }
  if (!ok(r)) {
    const why = r.json?.code ? `Yoycol code ${r.json.code}: ${r.json.msg}` : describeFailure(r);
    return { supplier: "yoycol", ok: false, error: why, at };
  }
  const d = r.json.data ?? {};
  const approval = d.needApprovalType ? ` Yoycol flagged it "${d.needApprovalReason ?? d.needApprovalType}": open it and Sync/approve first.` : "";
  return {
    supplier: "yoycol",
    ok: true,
    id: d.orderId != null ? String(d.orderId) : undefined,
    number: d.orderNo != null ? String(d.orderNo) : undefined,
    status: d.statusLabel ?? d.orderStatus ?? d.status,
    url: "https://www.yoycol.com/",
    cost: d.orderRealAmount != null ? `$${d.orderRealAmount}` : undefined,
    action: `Pay Yoycol order ${d.orderNo ?? d.orderId ?? ""} in Dashboard → Orders (it was created UNPAID; nothing is made until you pay).${approval}`,
    at,
  };
}
