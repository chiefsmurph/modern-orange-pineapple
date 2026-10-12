// What fulfilment needs, carried through Stripe Checkout as metadata.
//
// Session metadata (it arrives inside the checkout.session.completed event, so
// the webhook needs no extra API call):
//   mop_v        "1"
//   mop_n        number of items
//   mop_item_<i> compact JSON per item (Stripe allows 500 chars a value):
//                {"s":slug,"t":title,"sup":"printful|yoycol|manual","q":qty,"o":{options},"u":unit cents,
//                 "pf":{"sv":sync_variant_id} | "yc":{"dc":designCode,"sku":skuCode} | "m":manual note}
//   mop_summary  human-readable, for the Stripe dashboard
// Each line item's product also gets flat metadata (productId, supplier, the
// options, sync_variant_id or yoycol_design_code/yoycol_sku_code, qty), which
// is what the webhook falls back to for sessions without mop_* keys.
import type { OrderItem } from "./types.ts";

const MAX_VALUE = 500;

export function itemToMetadataValue(item: OrderItem): string {
  const compact: Record<string, unknown> = {
    s: item.slug,
    t: item.title.slice(0, 80),
    sup: item.supplier,
    q: item.qty,
    o: item.opts,
    u: item.unitAmount,
  };
  if (item.printful) compact.pf = { sv: item.printful.syncVariantId };
  if (item.yoycol) compact.yc = { dc: item.yoycol.designCode, sku: item.yoycol.skuCode };
  if (item.manual) compact.m = item.manual.slice(0, 160);
  const json = JSON.stringify(compact);
  if (json.length > MAX_VALUE) throw new Error(`metadata for ${item.slug} is ${json.length} chars (max ${MAX_VALUE})`);
  return json;
}

const optsText = (opts: Record<string, string>) => Object.values(opts).join(" / ");

export function sessionMetadata(items: OrderItem[]): Record<string, string> {
  const md: Record<string, string> = { mop_v: "1", mop_n: String(items.length) };
  items.forEach((item, i) => {
    md[`mop_item_${i}`] = itemToMetadataValue(item);
  });
  md.mop_summary = items
    .map((i) => `${i.qty} x ${i.title} (${optsText(i.opts)}) [${i.supplier}]`)
    .join("; ")
    .slice(0, MAX_VALUE);
  return md;
}

/** Flat strings for a line item's product_data.metadata. */
export function lineItemMetadata(item: OrderItem): Record<string, string> {
  const md: Record<string, string> = {
    productId: item.slug,
    supplier: item.supplier,
    qty: String(item.qty),
    ...item.opts,
  };
  if (item.printful) md.sync_variant_id = String(item.printful.syncVariantId);
  if (item.yoycol) {
    md.yoycol_design_code = item.yoycol.designCode;
    md.yoycol_sku_code = item.yoycol.skuCode;
  }
  return md;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** Items from session metadata, or null when the session has none (or they're unreadable). */
export function itemsFromSessionMetadata(
  md: Record<string, string> | null | undefined
): OrderItem[] | null {
  if (!md || md.mop_v !== "1") return null;
  const n = Number(md.mop_n);
  if (!Number.isInteger(n) || n < 1) return null;
  const items: OrderItem[] = [];
  for (let i = 0; i < n; i++) {
    let c: unknown;
    try {
      c = JSON.parse(md[`mop_item_${i}`] ?? "");
    } catch {
      return null;
    }
    if (!isObj(c) || typeof c.s !== "string" || !isObj(c.o)) return null;
    const sup = c.sup === "printful" || c.sup === "yoycol" ? c.sup : "manual";
    const item: OrderItem = {
      slug: c.s,
      title: typeof c.t === "string" ? c.t : c.s,
      supplier: sup,
      qty: Number.isInteger(c.q) && (c.q as number) > 0 ? (c.q as number) : 1,
      opts: Object.fromEntries(Object.entries(c.o).map(([k, v]) => [k, String(v)])),
      unitAmount: Number(c.u) || 0,
    };
    if (sup === "printful") {
      const sv = isObj(c.pf) ? Number(c.pf.sv) : NaN;
      if (!Number.isInteger(sv)) return null;
      item.printful = { syncVariantId: sv };
    }
    if (sup === "yoycol") {
      if (!isObj(c.yc) || typeof c.yc.dc !== "string" || typeof c.yc.sku !== "string") return null;
      item.yoycol = { designCode: c.yc.dc, skuCode: c.yc.sku };
    }
    if (typeof c.m === "string") item.manual = c.m;
    items.push(item);
  }
  return items;
}
