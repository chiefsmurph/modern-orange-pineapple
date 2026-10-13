// What happens when Stripe says a checkout was paid:
//   1. record the order (orders.jsonl + state) BEFORE anything else,
//   2. create the supplier order(s): Printful draft / Yoycol unpaid order,
//      each call retried once on a network/429/5xx failure,
//   3. append royalty rows,
//   4. email John what sold and what to do (retried once).
// Each finished step is saved in orders-state.json, so a repeated event is a
// no-op and a crashed run picks up where it stopped (see store.ts claim()).
import { buildOrderRecord, type LineItemLike, type SessionLike } from "./session.ts";
import { createPrintfulOrder } from "./printful.ts";
import { createYoycolOrder } from "./yoycol.ts";
import { orderEmail, sendEmail } from "./notify.ts";
import { royaltyRows } from "./royalties.ts";
import type { FetchLike } from "./http.ts";
import type { OrderStore, SessionEntry } from "./store.ts";
import type { OrderCodes, OrderItem, OrderRecord, RoyaltyRow, Supplier, SupplierResult } from "./types.ts";
import { packingSlipMessage, shortName, type ItemCodeStore } from "../item-codes.ts";

export type OrderDeps = {
  env: Record<string, string | undefined>;
  store: OrderStore;
  fetch: FetchLike;
  now: () => Date;
  log: (msg: string) => void;
  /** For sessions without our metadata (made before this code): Stripe's line items. */
  listLineItems?: (sessionId: string) => Promise<LineItemLike[]>;
  /** Pause before a retry (tests use 0). */
  retryDelayMs?: number;
  /** Registration codes (lib/item-codes.ts); without it, no codes are issued. */
  codes?: ItemCodeStore;
};

export type HandleResult = { status: number; body: Record<string, unknown> };

const HANDLED = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const PAID = new Set(["paid", "no_payment_required"]);

export async function handleStripeEvent(
  event: { id?: string; type: string; data: { object: unknown } },
  deps: OrderDeps
): Promise<HandleResult> {
  if (!HANDLED.has(event.type)) return { status: 200, body: { received: true, ignored: event.type } };
  return processSession(event.data.object as SessionLike, deps);
}

const groupBySupplier = (items: OrderItem[]) => {
  const groups = new Map<Supplier, OrderItem[]>();
  for (const i of items) groups.set(i.supplier, [...(groups.get(i.supplier) ?? []), i]);
  return groups;
};

export async function processSession(session: SessionLike, deps: OrderDeps): Promise<HandleResult> {
  const { store, log } = deps;
  const id = session.id;

  let claim: Awaited<ReturnType<OrderStore["claim"]>>;
  try {
    claim = await store.claim(id, deps.now());
  } catch (err) {
    // Can't read/write the state (bad data dir, corrupt file): touch nothing, let Stripe retry.
    log(`[orders] ${id}: ORDER STATE UNAVAILABLE: ${(err as Error).message}`);
    log(`[orders] ${id}: session for manual recovery: ${JSON.stringify(session)}`);
    return { status: 500, body: { error: "order store unavailable" } };
  }
  if (!claim.proceed) {
    if (claim.entry.status === "processing") {
      // Another delivery is working on it right now: ask Stripe to come back later
      // (by then it's done and gets a 200, or it was abandoned and gets resumed).
      return { status: 409, body: { received: true, in_progress: true } };
    }
    return { status: 200, body: { received: true, duplicate: true, status: claim.entry.status } };
  }
  let entry: SessionEntry = claim.entry;
  if (claim.resumed) log(`[orders] ${id}: resuming (attempt ${entry.attempts})`);

  // 1. Record. If this fails nothing else happens: release the claim and let Stripe retry.
  try {
    if (!entry.record) {
      const record = await buildOrderRecord(session, {
        listLineItems: deps.listLineItems,
        env: deps.env,
        log,
      });
      const at = deps.now().toISOString();
      await store.appendOrder({ type: "order", at, ...record });
      entry = await store.update(id, deps.now(), (e) => {
        e.record = record;
        e.order_ref = record.order_ref;
      });
      log(
        `[orders] ${id}: recorded ${record.order_ref}, ${record.items.length} item(s), ` +
          `${record.amount_total} ${record.currency}, payment ${record.payment_status}`
      );
    }
  } catch (err) {
    log(`[orders] ${id}: COULD NOT RECORD ORDER: ${(err as Error).stack ?? err}`);
    log(`[orders] ${id}: session for manual recovery: ${JSON.stringify(session)}`);
    await store.release(id).catch(() => undefined);
    return { status: 500, body: { error: "could not record order" } };
  }

  const record = entry.record!;
  try {
    if (!PAID.has(record.payment_status)) {
      await store.update(id, deps.now(), (e) => {
        e.status = "awaiting_payment";
      });
      log(`[orders] ${id}: payment ${record.payment_status}; waiting for async_payment_succeeded`);
      return { status: 200, body: { received: true, awaiting_payment: true } };
    }

    // 2. Registration codes, one per unit sold; the Printful ones go on its packing slip.
    if (deps.codes && !entry.codes && record.items.length) {
      const codes = await issueCodes(record, deps.codes, deps.now().toISOString());
      entry = await store.update(id, deps.now(), (e) => {
        e.codes = codes;
      });
      log(`[orders] ${id}: ${codes.items.length} registration code(s)${codes.order ? " + an order code" : ""}`);
    }
    const slip = entry.codes?.slip ? { message: entry.codes.slip, store_name: "Modern Orange Pineapple" } : null;

    // 3. Suppliers, one order per supplier.
    for (const [supplier, items] of Array.from(groupBySupplier(record.items))) {
      if (entry.suppliers[supplier]) continue; // done in an earlier run
      let result: SupplierResult;
      if (supplier === "printful") result = await createPrintfulOrder(record, items, deps, slip);
      else if (supplier === "yoycol") result = await createYoycolOrder(record, items, deps);
      else
        result = {
          supplier: "manual",
          ok: false,
          error: items.map((i) => `${i.title} (${Object.values(i.opts).join(" / ")}): ${i.manual ?? "no supplier mapping"}`).join("; "),
          at: deps.now().toISOString(),
        };
      if (!result.ok) log(`[orders] ${id}: ${supplier} not placed: ${result.error}`);
      else log(`[orders] ${id}: ${supplier} order ${result.id ?? ""} ${result.status ?? ""}${result.existing ? " (already existed)" : ""}`);
      entry = await store.update(id, deps.now(), (e) => {
        e.suppliers[supplier] = result;
      });
    }

    // 3. Royalties.
    const royalties: RoyaltyRow[] = royaltyRows(record, deps.now().toISOString(), deps.env);
    if (!entry.royalties_written) {
      await store.appendRoyalties(royalties);
      entry = await store.update(id, deps.now(), (e) => {
        e.royalties_written = true;
        e.royalty_total = royalties.reduce((n, r) => n + r.amount, 0);
      });
    }

    // 4. Email John. A failed email never undoes anything; it's logged and kept in the state.
    if (!entry.emailed) {
      const email = orderEmail(record, entry.suppliers, royalties, entry.codes);
      const sent = await sendEmail(email, deps);
      if (!sent.ok) log(`[orders] ${id}: EMAIL TO JOHN FAILED: ${sent.error}. Subject was: ${email.subject}`);
      entry = await store.update(id, deps.now(), (e) => {
        e.emailed = sent.ok;
        e.email_error = sent.ok ? undefined : sent.error;
      });
    }

    const allOk = Object.values(entry.suppliers).every((r) => r.ok) && record.items.length > 0;
    entry = await store.update(id, deps.now(), (e) => {
      e.status = allOk && e.emailed ? "done" : "done_with_errors";
    });
    await store.appendFulfilment({
      type: "fulfilment",
      at: deps.now().toISOString(),
      session_id: id,
      order_ref: record.order_ref,
      status: entry.status,
      suppliers: entry.suppliers,
      emailed: !!entry.emailed,
    });
    return { status: 200, body: { received: true, order_ref: record.order_ref, status: entry.status } };
  } catch (err) {
    // The order is recorded; mark it so Stripe's retry resumes the missing steps.
    log(`[orders] ${id}: processing failed after recording: ${(err as Error).stack ?? err}`);
    await store
      .update(id, deps.now(), (e) => {
        e.status = "error";
        e.error = (err as Error).message;
      })
      .catch(() => undefined);
    // Tell John once (best effort): Stripe will retry, but he should know.
    if (entry.attempts === 1) {
      await sendEmail(
        {
          subject: `ACTION NEEDED: MOP order ${record.order_ref} hit an error`,
          body:
            `A paid order was saved but processing stopped: ${(err as Error).message}\n` +
            `Stripe will retry the webhook. Session: ${id}\nCheck journalctl -u mopclothing and orders.jsonl.`,
          html: "",
        },
        deps
      ).catch(() => undefined);
    }
    return { status: 500, body: { error: "processing failed; will retry" } };
  }
}

/** Issue one code per unit, then fit the Printful ones on the slip (or fall back to one order code). */
async function issueCodes(record: OrderRecord, codes: ItemCodeStore, at: string): Promise<OrderCodes> {
  const issued = await codes.issue(
    { session_id: record.session_id, order_ref: record.order_ref, items: record.items.map((i) => ({ slug: i.slug, title: i.title, qty: i.qty, opts: i.opts })) },
    at
  );
  const same = (a: Record<string, string> = {}, b: Record<string, string> = {}) =>
    Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
  const items = issued.map((c) => ({
    code: c.code,
    slug: c.slug!,
    title: c.title!,
    variant: c.variant ?? {},
    supplier: record.items.find((i) => i.slug === c.slug && same(i.opts, c.variant))?.supplier ?? ("manual" as Supplier),
  }));
  const printful = items.filter((c) => c.supplier === "printful").map((c) => ({ name: shortName(c.title), code: c.code }));
  let order: string | null = null;
  let slip = packingSlipMessage(printful, null);
  if (printful.length && !slip) {
    order = (await codes.issueOrderCode(record.session_id, record.order_ref, printful.map((p) => p.code), at)).code;
    slip = packingSlipMessage(printful, order);
  }
  return { items, order, slip };
}
