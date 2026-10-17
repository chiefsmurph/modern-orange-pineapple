// "Your order has shipped" emails: who gets one, and making sure each package
// gets exactly one.
//
// $MOP_DATA_DIR/shipments-emailed.jsonl is append-only, one line per step for
// a package (sending / emailed / failed / skipped / dry_run: email-once.ts),
// keyed "<supplier>:<supplier order id>:<shipment id or tracking number>".
// A key with an "emailed" line is never emailed again; a "sending" line younger
// than STALE_MS means another delivery is on it right now; an older one was
// abandoned (crash) and is resumed with the same Resend Idempotency-Key, so even
// then the customer gets one email.
// The site (Printful webhook) and the Yoycol cron script both append here; each
// line is one small write, and they never share a key.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createEmailLedger, deliverOnce, type BaseLedgerRow, type DeliverStatus } from "./email-once.ts";
import { shippedEmail, type ShipmentKind, type ShippedEmailInput } from "./shipped-email.ts";
import type { FetchLike } from "./http.ts";
import type { OrderRecord } from "./types.ts";

export { STALE_MS, type Claim, type LedgerStatus } from "./email-once.ts";

export const SHIPMENTS_FILE = "shipments-emailed.jsonl";

export type ShipSupplier = "printful" | "yoycol";
export type ShipmentKey = { supplier: ShipSupplier; orderId: string; shipment: string };
export const keyString = (k: ShipmentKey) => `${k.supplier}:${k.orderId}:${k.shipment}`;

export type LedgerRow = BaseLedgerRow & {
  supplier: ShipSupplier;
  order_id: string;
  shipment: string;
  to_source?: CustomerSource;
  tracking_number?: string;
  carrier?: string;
  items?: string[];
};

export function createShipmentLedger(dir: string) {
  const ledger = createEmailLedger<LedgerRow>(dir, SHIPMENTS_FILE);
  return {
    ...ledger,

    /** Suppliers whose packages for this order ref were emailed (for "part" / "the rest"). */
    emailedSuppliers: (orderRef: string) =>
      ledger.query((rows) => new Set(rows.filter((r) => r.order_ref === orderRef && r.status === "emailed").map((r) => r.supplier))),

    /** Was any package of this supplier order emailed? (Yoycol: one parcel per order.) */
    orderEmailed: (supplier: ShipSupplier, orderId: string) =>
      ledger.query((rows) => rows.some((r) => r.supplier === supplier && r.order_id === orderId && r.status === "emailed")),
  };
}

export type ShipmentLedger = ReturnType<typeof createShipmentLedger>;

const ledgers = new Map<string, ShipmentLedger>();
/** One ledger (one queue) per data directory for the life of the process. */
export const shipmentLedger = (dir: string) => {
  let l = ledgers.get(dir);
  if (!l) ledgers.set(dir, (l = createShipmentLedger(dir)));
  return l;
};

/** The order line for this exact ref in $MOP_DATA_DIR/orders.jsonl (the last one, if repeated). */
export function findOrderRecord(dir: string, orderRef: string): OrderRecord | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(dir, "orders.jsonl"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  let found: OrderRecord | undefined;
  for (const line of text.split("\n")) {
    if (!line.includes(orderRef)) continue;
    try {
      const row = JSON.parse(line);
      if (row?.type === "order" && row.order_ref === orderRef) found = row as OrderRecord;
    } catch {
      // unreadable line: skip
    }
  }
  return found;
}

/**
 * all / part / rest for a box. `completesSupplier`: with it, everything this
 * supplier makes for the order has shipped. `otherSuppliers`: other suppliers
 * with items in the same checkout (from our record).
 */
export function shipmentKind(input: {
  reshipment?: boolean;
  completesSupplier: boolean;
  earlierBoxes: boolean;
  otherSuppliers: string[];
  emailedSuppliers: Set<string>;
}): ShipmentKind {
  if (input.reshipment) return "replacement";
  const othersPending = input.otherSuppliers.some((s) => !input.emailedSuppliers.has(s));
  if (!input.completesSupplier || othersPending) return "part";
  const earlier = input.earlierBoxes || input.otherSuppliers.some((s) => input.emailedSuppliers.has(s));
  return earlier ? "rest" : "all";
}

export type CustomerSource = "order_record" | "printful_recipient";

export type Package = {
  key: ShipmentKey;
  orderRef: string;
  to: string;
  toSource: CustomerSource;
  email: ShippedEmailInput;
};

export type DeliverDeps = {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  log: (msg: string) => void;
  now: () => Date;
  ledger: ShipmentLedger;
  retryDelayMs?: number;
  /** For John's alert: what happens next ("Printful retries the webhook…"). */
  retryNote: string;
};

export type DeliverResult = {
  key: string;
  status: DeliverStatus;
  retryable?: boolean;
  error?: string;
};

/**
 * One package: claim it, send the email, record the outcome. A failed send is
 * logged, not marked emailed, and John is told (PingPigeon) the first time a
 * package fails.
 */
export async function deliverPackage(pkg: Package, deps: DeliverDeps): Promise<DeliverResult> {
  const key = keyString(pkg.key);
  const tracking = pkg.email.tracking;
  const row = {
    key,
    supplier: pkg.key.supplier,
    order_id: pkg.key.orderId,
    shipment: pkg.key.shipment,
    order_ref: pkg.orderRef,
    to: pkg.to || undefined,
    to_source: pkg.toSource,
    tracking_number: tracking?.number,
    carrier: tracking?.carrier,
    items: pkg.email.items.map((i) => `${i.qty} x ${i.title}${i.options ? ` (${i.options})` : ""}`),
  };
  const r = await deliverOnce<LedgerRow>(
    {
      ledger: deps.ledger,
      row,
      tag: "[shipping]",
      what: "shipped email",
      who: `${pkg.orderRef} (${pkg.key.supplier} ${pkg.key.orderId}, package ${pkg.key.shipment})`,
      to: pkg.to,
      toNote: pkg.toSource,
      noAddressError: "no customer email address (not in our order record or on the supplier's order)",
      build: () => shippedEmail(pkg.email),
      idempotencyKey: `mop-shipped/${key}`,
      alert: (sent) => ({
        subject: `ACTION NEEDED: shipped email failed for ${pkg.orderRef}`,
        body: [
          `The "your order has shipped" email didn't go out.`,
          ``,
          `Why: ${sent.error}`,
          `To: ${pkg.to || "(no address)"} (from ${pkg.toSource === "order_record" ? "our order record" : "the Printful order"})`,
          `Order: ${pkg.orderRef}, ${pkg.key.supplier} order ${pkg.key.orderId}, package ${pkg.key.shipment}`,
          tracking ? `Tracking: ${[tracking.carrier, tracking.service].filter(Boolean).join(" · ")} ${tracking.number}` : `Tracking: none`,
          tracking ? `Link: ${tracking.url}` : ``,
          `In the box: ${row.items.join("; ")}`,
          ``,
          `Next: ${sent.retryable ? deps.retryNote : "retrying won't fix this one. Send the tracking to the customer by hand."}`,
          `Log: journalctl -u mopclothing | grep '\\[shipping\\]' and ${deps.ledger.file}`,
        ]
          .filter((l, i, a) => l || a[i - 1])
          .join("\n"),
      }),
    },
    deps
  );
  return { key: r.key, status: r.status, retryable: r.retryable, error: r.error };
}
