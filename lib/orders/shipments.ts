// "Your order has shipped" emails: who gets one, and making sure each package
// gets exactly one.
//
// $MOP_DATA_DIR/shipments-emailed.jsonl is append-only, one line per step for
// a package, keyed "<supplier>:<supplier order id>:<shipment id or tracking number>":
//   sending   written BEFORE the email is sent (the claim, like orders-state's "processing")
//   emailed   written once Resend accepted it; only then is the package done
//   failed    the send failed: not done, the next webhook retry / cron run tries again
//   skipped   MOP_RESEND_API_KEY isn't set: not done, nothing was sent
//   dry_run   MOP_EMAIL_DRY_RUN=1: logged, not sent, not done
// A key with an "emailed" line is never emailed again; a "sending" line younger
// than STALE_MS means another delivery is on it right now; an older one was
// abandoned (crash) and is resumed. The resumed send reuses the same Resend
// Idempotency-Key, so even then the customer gets one email.
// The site (Printful webhook) and the Yoycol cron script both append here; each
// line is one small write, and they never share a key.
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { sendEmail } from "./notify.ts";
import { isEmail, maskEmail, sendCustomerEmail, type SendResult } from "./customer-email.ts";
import { shippedEmail, type ShipmentKind, type ShippedEmailInput } from "./shipped-email.ts";
import type { FetchLike } from "./http.ts";
import type { OrderRecord } from "./types.ts";

export const SHIPMENTS_FILE = "shipments-emailed.jsonl";
export const STALE_MS = 10 * 60 * 1000;

export type ShipSupplier = "printful" | "yoycol";
export type ShipmentKey = { supplier: ShipSupplier; orderId: string; shipment: string };
export const keyString = (k: ShipmentKey) => `${k.supplier}:${k.orderId}:${k.shipment}`;

export type LedgerStatus = "sending" | "emailed" | "failed" | "skipped" | "dry_run";

export type LedgerRow = {
  at: string;
  status: LedgerStatus;
  key: string;
  supplier: ShipSupplier;
  order_id: string;
  shipment: string;
  order_ref: string;
  to?: string;
  to_source?: CustomerSource;
  tracking_number?: string;
  carrier?: string;
  items?: string[];
  resend_id?: string;
  error?: string;
};

/** proceed: go ahead (resumed: an abandoned "sending" is being retried; failures: earlier failed sends). Else `reason`. */
export type Claim = { proceed: boolean; reason?: "emailed" | "in_progress"; resumed?: boolean; failures?: number };

const parseLines = (text: string): LedgerRow[] =>
  text.split("\n").flatMap((l) => {
    if (!l.trim()) return [];
    try {
      return [JSON.parse(l) as LedgerRow];
    } catch {
      return []; // a torn last line from a crash: ignore it, the key is retried
    }
  });

export function createShipmentLedger(dir: string) {
  const file = path.join(dir, SHIPMENTS_FILE);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const rows = async (): Promise<LedgerRow[]> => {
    try {
      return parseLines(await fs.readFile(file, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  };
  const append = async (row: LedgerRow) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    await fs.appendFile(file, JSON.stringify(row) + "\n", { mode: 0o640 });
  };

  return {
    file,
    rows: () => serial(rows),

    /** Take a package for sending (writes its "sending" line), or say why not. */
    claim(row: Omit<LedgerRow, "at" | "status">, now: Date): Promise<Claim> {
      return serial(async () => {
        const mine = (await rows()).filter((r) => r.key === row.key);
        if (mine.some((r) => r.status === "emailed")) return { proceed: false, reason: "emailed" };
        const last = mine[mine.length - 1];
        const fresh = last?.status === "sending" && now.getTime() - Date.parse(last.at) < STALE_MS;
        if (fresh) return { proceed: false, reason: "in_progress" };
        await append({ ...row, at: now.toISOString(), status: "sending" });
        return { proceed: true, resumed: last?.status === "sending", failures: mine.filter((r) => r.status === "failed").length };
      });
    },

    record: (row: LedgerRow) => serial(() => append(row)),

    /** Suppliers whose packages for this order ref were emailed (for "part" / "the rest"). */
    emailedSuppliers: (orderRef: string) =>
      serial(async () => new Set((await rows()).filter((r) => r.order_ref === orderRef && r.status === "emailed").map((r) => r.supplier))),

    /** Was any package of this supplier order emailed? (Yoycol: one parcel per order.) */
    orderEmailed: (supplier: ShipSupplier, orderId: string) =>
      serial(async () => (await rows()).some((r) => r.supplier === supplier && r.order_id === orderId && r.status === "emailed")),
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
  status: "emailed" | "duplicate" | "in_progress" | "dry_run" | "skipped" | "failed";
  retryable?: boolean;
  error?: string;
};

/**
 * One package: claim it, send the email, record the outcome. A failed send is
 * logged, not marked emailed, and John is told (PingPigeon) the first time a
 * package fails.
 */
export async function deliverPackage(pkg: Package, deps: DeliverDeps): Promise<DeliverResult> {
  const { ledger, log } = deps;
  const key = keyString(pkg.key);
  const tracking = pkg.email.tracking;
  const base = {
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
  const who = `${pkg.orderRef} (${pkg.key.supplier} ${pkg.key.orderId}, package ${pkg.key.shipment})`;

  const claim = await ledger.claim(base, deps.now());
  if (!claim.proceed) {
    log(`[shipping] ${who}: ${claim.reason === "emailed" ? "already emailed, not sending again" : "another delivery is sending it right now"}`);
    return { key, status: claim.reason === "emailed" ? "duplicate" : "in_progress" };
  }
  if (claim.resumed) log(`[shipping] ${who}: an earlier attempt stopped mid-send; trying again (same idempotency key)`);

  const email = shippedEmail(pkg.email);
  const sent: SendResult = isEmail(pkg.to)
    ? await sendCustomerEmail(
        { to: pkg.to, subject: email.subject, html: email.html, text: email.text },
        {
          env: deps.env,
          fetch: deps.fetch,
          log,
          // Same key when resuming an abandoned send (Resend dedupes it); a new one after a
          // recorded failure, since the retried email may differ ("part" -> "rest").
          idempotencyKey: `mop-shipped/${key}${claim.failures ? `/retry-${claim.failures}` : ""}`,
          retryDelayMs: deps.retryDelayMs,
        }
      )
    : { ok: false, error: "no customer email address (not in our order record or on the supplier's order)", retryable: false };
  const at = () => deps.now().toISOString();

  if (sent.ok && sent.dryRun) {
    await ledger.record({ ...base, at: at(), status: "dry_run" });
    return { key, status: "dry_run" };
  }
  if (sent.ok) {
    try {
      await ledger.record({ ...base, at: at(), status: "emailed", resend_id: sent.id });
    } catch (err) {
      // Sent but not recorded: a retry may send again within Resend's 24 h idempotency window (deduped there).
      log(`[shipping] ${who}: EMAILED but could not record it in ${ledger.file}: ${(err as Error).message}`);
    }
    log(`[shipping] ${who}: shipped email sent to ${maskEmail(pkg.to)} (${pkg.toSource}), Resend ${sent.id}`);
    return { key, status: "emailed" };
  }
  if (sent.noKey) {
    log(`[shipping] ${who}: MOP_RESEND_API_KEY is not set: shipped email NOT sent (skipped; set the key to send)`);
    await ledger.record({ ...base, at: at(), status: "skipped", error: sent.error });
    return { key, status: "skipped", error: sent.error };
  }

  log(`[shipping] ${who}: SHIPPED EMAIL FAILED: ${sent.error}`);
  await ledger.record({ ...base, at: at(), status: "failed", error: sent.error }).catch((err) =>
    log(`[shipping] ${who}: could not record the failure: ${(err as Error).message}`)
  );
  if (!claim.failures) {
    const alert = await sendEmail(
      {
        subject: `ACTION NEEDED: shipped email failed for ${pkg.orderRef}`,
        body: [
          `The "your order has shipped" email didn't go out.`,
          ``,
          `Why: ${sent.error}`,
          `To: ${pkg.to || "(no address)"} (from ${pkg.toSource === "order_record" ? "our order record" : "the Printful order"})`,
          `Order: ${pkg.orderRef}, ${pkg.key.supplier} order ${pkg.key.orderId}, package ${pkg.key.shipment}`,
          tracking ? `Tracking: ${[tracking.carrier, tracking.service].filter(Boolean).join(" · ")} ${tracking.number}` : `Tracking: none`,
          tracking ? `Link: ${tracking.url}` : ``,
          `In the box: ${base.items.join("; ")}`,
          ``,
          `Next: ${sent.retryable ? deps.retryNote : "retrying won't fix this one. Send the tracking to the customer by hand."}`,
          `Log: journalctl -u mopclothing | grep '\\[shipping\\]' and ${ledger.file}`,
        ]
          .filter((l, i, a) => l || a[i - 1])
          .join("\n"),
        html: "",
      },
      { env: deps.env, fetch: deps.fetch, log, retryDelayMs: deps.retryDelayMs }
    ).catch((err) => ({ ok: false, error: (err as Error).message }));
    if (!alert.ok) log(`[shipping] ${who}: could not alert John either: ${alert.error}`);
  }
  return { key, status: "failed", retryable: sent.retryable, error: sent.error };
}
