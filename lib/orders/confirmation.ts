// The customer's "thanks for your order" email, sent by the Stripe webhook
// (process.ts) once the order is recorded and the supplier orders are placed,
// or by hand with scripts/send-confirmation-email.mjs.
//
//   MOP_CONFIRMATION_EMAIL_ENABLED=1   turns it on. Off (the default): nothing is sent,
//                                      and a debug line says what would have gone out
//                                      (subject + the address's domain only).
//   MOP_EMAIL_DRY_RUN=1                logs the email instead of sending it (customer-email.ts).
//   ORDER_DRY_RUN=1                    the whole webhook is a dry run, so this email is one too.
//
// Exactly once per order ref: $MOP_DATA_DIR/confirmations-emailed.jsonl, the same
// sending -> emailed ledger as the shipped emails (email-once.ts), plus a Resend
// Idempotency-Key. Stripe's retries and replays never send it twice; only
// `--force` on the script does.
//
// It never fails the order: every error is caught, logged ("[confirm]") and,
// for a failed send, John hears once through PingPigeon (notify.ts). Stripe
// doesn't retry a webhook that answered 200, so a failed one is resent by hand.
import legacyProducts, { getDelivery, vendorDelivery, type Delivery } from "../../public/products.ts";
import { getShopProductIncludingRetired } from "../catalog/index.ts";
import { describeFailure, requestJson } from "./http.ts";
import { sendEmail } from "./notify.ts";
import { displayFromRecordItem } from "./item-display.ts";
import { createEmailLedger, deliverOnce, type BaseLedgerRow, type DeliverStatus, type OnceDeps } from "./email-once.ts";
import { money, shortOrderNumber } from "./email-layout.ts";
import {
  CONFIRMATION_SUBJECT,
  confirmationEmail,
  type ConfirmationEmail,
  type ConfirmationEmailInput,
  type ConfirmationItem,
} from "./confirmation-email.ts";
import type { OrderItem, OrderRecord } from "./types.ts";

export const CONFIRMATIONS_FILE = "confirmations-emailed.jsonl";
export const STRIPE_API = "https://api.stripe.com/v1";

export const confirmationEnabled = (env: Record<string, string | undefined>) => env.MOP_CONFIRMATION_EMAIL_ENABLED?.trim() === "1";

export type ConfirmationRow = BaseLedgerRow & {
  session_id: string;
  items?: string[];
  /** Cents paid, from the session. */
  total?: number;
  currency?: string;
  /** Sent again by hand (--force). */
  forced?: boolean;
};

export const createConfirmationLedger = (dir: string) => createEmailLedger<ConfirmationRow>(dir, CONFIRMATIONS_FILE);
export type ConfirmationLedger = ReturnType<typeof createConfirmationLedger>;

const ledgers = new Map<string, ConfirmationLedger>();
/** One ledger (one queue) per data directory for the life of the process. */
export const confirmationLedger = (dir: string) => {
  let l = ledgers.get(dir);
  if (!l) ledgers.set(dir, (l = createConfirmationLedger(dir)));
  return l;
};

/** The delivery times of what was ordered: the product's own (vendorDelivery), by who makes it. */
export function deliveryFor(item: Pick<OrderItem, "slug" | "supplier">): Delivery {
  if (item.supplier === "yoycol") return vendorDelivery.yoycol;
  if (item.supplier === "printful") {
    const product = getShopProductIncludingRetired(item.slug);
    return product ? vendorDelivery[product.delivery] : vendorDelivery.printful;
  }
  // manual: an older product John places by hand; its own platform's times.
  const legacy = legacyProducts.products.find((p) => p.id === item.slug);
  return legacy ? getDelivery(legacy) : vendorDelivery.printful;
}

/** "Made to order · arrives in about 1–2 weeks" -> "about 1–2 weeks". */
export const arrivalText = (d: Delivery) => /arrives in (.+)$/.exec(d.text)?.[1]?.trim() || `${d.minBusinessDays}–${d.maxBusinessDays} business days`;

/**
 * The email's content from the order record (the Stripe session as received).
 * Line prices are the session's per-item amounts; they're left out if they
 * don't add up to the session's subtotal (then only the session's totals show).
 */
export function confirmationInput(record: OrderRecord, discountCodes: string[] = []): ConfirmationEmailInput & { linePricesShown: boolean } {
  const lineSum = record.items.reduce((n, i) => n + i.unitAmount * i.qty, 0);
  const linePricesShown = record.items.length > 0 && lineSum === record.amount_subtotal;
  const items: ConfirmationItem[] = record.items.map((i) => {
    const d = deliveryFor(i);
    return {
      ...displayFromRecordItem(i),
      ...(linePricesShown ? { lineAmount: i.unitAmount * i.qty, unitAmount: i.unitAmount } : {}),
      arrives: arrivalText(d),
      production: d.production,
      group: i.supplier,
    };
  });
  return {
    name: record.customer?.name ?? "",
    orderRef: record.order_ref,
    currency: record.currency || "usd",
    items,
    totals: {
      subtotal: record.amount_subtotal,
      discount: record.amount_discount,
      shipping: record.amount_shipping,
      tax: record.amount_tax,
      total: record.amount_total,
    },
    discountCodes,
    linePricesShown,
  };
}

/**
 * The code the customer typed for a promotion code id: GET /v1/promotion_codes/{id}
 * with STRIPE_SECRET_KEY (a restricted key needs Promotion Codes: Read). Null when
 * it can't be read; the email then says "Discount" without the code.
 */
export async function lookupPromotionCode(id: string, deps: Pick<OnceDeps, "env" | "fetch" | "log">): Promise<string | null> {
  if (!/^promo_[A-Za-z0-9]{1,200}$/.test(id)) return null;
  const key = deps.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    deps.log(`[confirm] promotion code ${id}: STRIPE_SECRET_KEY is not set; the email shows "Discount" without the code`);
    return null;
  }
  const r = await requestJson(deps.fetch, `${STRIPE_API}/promotion_codes/${id}`, { method: "GET", headers: { Authorization: `Bearer ${key}` } }, 5000);
  const code = r.ok && typeof r.json?.code === "string" ? r.json.code.trim() : "";
  if (!code) {
    deps.log(`[confirm] promotion code ${id}: ${r.ok ? "no code in Stripe's answer" : describeFailure(r)}; the email shows "Discount" without the code`);
    return null;
  }
  return code.slice(0, 40);
}

/** The codes used on the order (from the session when Stripe sent them, else looked up). */
export async function discountCodesFor(record: OrderRecord, deps: Pick<OnceDeps, "env" | "fetch" | "log">): Promise<string[]> {
  if (!(record.amount_discount > 0)) return [];
  const codes: string[] = [];
  for (const d of record.discounts ?? []) {
    const code = d.code ?? (d.promotion_code ? await lookupPromotionCode(d.promotion_code, deps).catch(() => null) : null);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

export type ConfirmDeps = OnceDeps & {
  /** $MOP_DATA_DIR. */
  dir: string;
  /** Default: confirmationLedger(dir). */
  ledger?: ConfirmationLedger;
  /** Debug-level log (the webhook: console.debug). Unset: not logged. */
  debug?: (msg: string) => void;
  /** Send even if it was emailed before (scripts/send-confirmation-email.mjs --force). */
  force?: boolean;
  /** For John's alert: how to get it out. */
  retryNote?: string;
};

export type ConfirmResult = {
  ref: string;
  status: DeliverStatus | "disabled" | "no_items" | "error";
  error?: string;
  resendId?: string;
  /** The email, when it was built (for previews). */
  email?: ConfirmationEmail;
};

const domainOf = (email: string) => {
  const d = /@([^@\s]+)$/.exec(email.trim())?.[1];
  return d ? `an address at ${d.toLowerCase()}` : "no address";
};

export const handResendNote = (ref: string) =>
  `send it by hand: node scripts/send-confirmation-email.mjs --order-ref ${ref} (DEPLOY.md, "Order confirmation email").`;

/**
 * Send one order's confirmation (or don't, and say why). Never throws: the
 * webhook awaits it after the order is safe, and nothing here can undo that.
 */
export async function sendOrderConfirmation(record: OrderRecord, deps: ConfirmDeps): Promise<ConfirmResult> {
  const ref = record.order_ref;
  const { log } = deps;
  try {
    if (!confirmationEnabled(deps.env)) {
      deps.debug?.(
        `[confirm] ${ref}: confirmation email is off (MOP_CONFIRMATION_EMAIL_ENABLED is not 1); ` +
          `would have sent "${CONFIRMATION_SUBJECT}" to ${domainOf(record.customer?.email ?? "")}`
      );
      return { ref, status: "disabled" };
    }
    if (!record.items.length) {
      log(`[confirm] ${ref}: no items on the order record; confirmation email not sent (John's order email says ACTION NEEDED)`);
      return { ref, status: "no_items" };
    }

    const ledger = deps.ledger ?? confirmationLedger(deps.dir);
    const to = (record.customer?.email ?? "").trim();
    const items = record.items.map((i) => `${i.qty} x ${i.title}`);
    let email: ConfirmationEmail | undefined;
    const r = await deliverOnce<ConfirmationRow>(
      {
        ledger,
        row: {
          key: ref,
          order_ref: ref,
          session_id: record.session_id,
          to: to || undefined,
          items,
          total: record.amount_total,
          currency: record.currency,
          ...(deps.force ? { forced: true } : {}),
        },
        tag: "[confirm]",
        what: "confirmation email",
        who: ref,
        to,
        noAddressError: "no customer email address on the order (the Stripe session had none)",
        build: async () => {
          const input = confirmationInput(record, await discountCodesFor(record, deps));
          if (!input.linePricesShown) log(`[confirm] ${ref}: the items don't add up to the session subtotal; showing the session's totals only`);
          return (email = confirmationEmail(input));
        },
        idempotencyKey: `mop-confirmation/${ref}`,
        force: deps.force,
        alert: (sent) => ({
          subject: `ACTION NEEDED: order confirmation email failed for ${ref}`,
          body: [
            `The customer's "thanks for your order" email didn't go out. The order itself isn't affected: it's recorded, and the supplier orders are in your order email as usual.`,
            ``,
            `Why: ${sent.error}`,
            `To: ${to || "(no address)"} (from the Stripe checkout)`,
            `Order: ${ref} (${shortOrderNumber(ref)}), ${money(record.amount_total, record.currency || "usd")} paid, Stripe session ${record.session_id}`,
            `Items: ${items.join("; ")}`,
            ``,
            `Next: ${deps.retryNote ?? `Stripe won't retry it (the order went through). Once it's fixed, ${handResendNote(ref)}`}`,
            `Log: journalctl -u mopclothing | grep '\\[confirm\\]' and ${ledger.file}`,
          ].join("\n"),
        }),
      },
      deps
    );
    return { ref, status: r.status, error: r.error, resendId: r.resendId, email };
  } catch (err) {
    // The ledger couldn't be read or written (or something else broke): nothing was sent.
    const message = (err as Error).message;
    log(`[confirm] ${ref}: CONFIRMATION EMAIL ERROR (nothing sent): ${(err as Error).stack ?? message}`);
    const alert = await sendEmail(
      {
        subject: `ACTION NEEDED: order confirmation email failed for ${ref}`,
        body:
          `The customer's "thanks for your order" email couldn't be sent: ${message}\n` +
          `The order itself isn't affected. Once it's fixed, ${handResendNote(ref)}\n` +
          `Log: journalctl -u mopclothing | grep '\\[confirm\\]'`,
        html: "",
      },
      { env: deps.env, fetch: deps.fetch, log, retryDelayMs: deps.retryDelayMs }
    ).catch((e) => ({ ok: false, error: (e as Error).message }));
    if (!alert.ok) log(`[confirm] ${ref}: could not alert John either: ${alert.error}`);
    return { ref, status: "error", error: message };
  }
}
