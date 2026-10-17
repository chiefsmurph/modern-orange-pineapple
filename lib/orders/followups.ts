// Follow-up emails to customers, decided once a day by scripts/followup-emails.mjs
// (cron; DEPLOY.md "Follow-up emails"). Both are off unless switched on:
//
//   MOP_FOLLOWUP_FIT_ENABLED=1     "How's it fit?" (every supplier), once per order,
//                                  FIT_AFTER_DELIVERY_DAYS after the LAST package was delivered.
//   MOP_FOLLOWUP_YOYCOL_ENABLED=1  "Your Blue Sky Cotton Shorts are being made", once per order
//                                  with Yoycol items, 12–14 days after it was paid, only if the
//                                  Yoycol parcel hasn't shipped (no shipped email recorded).
//
// Off: nothing is sent or written; the run logs what it would send (the address's
// domain only). --dry-run prints the emails and sends nothing, on or off.
//
// What it reads ($MOP_DATA_DIR; it never writes the site's files):
//   orders.jsonl            the order (customer, items) and when it was paid (the line's `at`)
//   orders-state.json       the supplier order ids (Printful id, Yoycol orderId)
//   shipments-emailed.jsonl which packages got a shipped email, when, and whether that box
//                           finished the order (`kind` all / rest; lines from before 2026-10-17
//                           have no kind)
// and, read only, at most one call per supplier order per run, a short pause between calls:
//   Printful  GET /v2/orders/{id}/shipments   delivery_status / delivered_at (v1 has neither)
//   Yoycol    GET /api/2025/open/v4/orders/{id}/tracking   tracking events (fit email)
//             GET /api/2025/open/v4/orders/{id}            paid / cancelled (being-made note)
// (Not read: confirmations-emailed.jsonl. Neither email depends on the confirmation having
// gone out; the being-made note restates the 3–4 weeks rather than "as we said".)
//
// When "How's it fit?" is due (fitDecision):
//   - every supplier in the order has shipped everything (shippingComplete), and the email
//     waits for the last box: one email per order, however many packages;
//   - every package delivered: the last delivery + 3 days;
//   - a carrier never reported (no data, "unknown", Printful unreachable): the last shipped
//     email + 12 days; a carrier still reporting it in transit: + 21 days;
//   - a package returned / failed (and not reshipped): held, never sent automatically.
// Orders with items John places by hand ("manual") aren't tracked, so they get none.
//
// No backfill: $MOP_DATA_DIR/followups-start.json records when each email was first switched
// on (the first run with the switch on). Only orders delivered after that (no delivery date:
// whose last shipped email went out after it), or for the being-made note paid after it,
// qualify. `--include-before <date>` opts in orders from that date on, by hand.
//
// Exactly once: $MOP_DATA_DIR/followups-emailed.jsonl, the same sending -> emailed ledger as
// the other customer emails (email-once.ts), keys "fit:<ref>" / "being-made:<ref>", plus a
// Resend Idempotency-Key. A failed send alerts John once (PingPigeon) and is retried the next day.
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { vendorDelivery } from "../../public/products.ts";
import { arrivalText, domainOf } from "./confirmation.ts";
import { createEmailLedger, deliverOnce, type BaseLedgerRow } from "./email-once.ts";
import { shortOrderNumber } from "./email-layout.ts";
import { beingMadeEmail, fitEmail, type FollowupEmail } from "./followup-email.ts";
import { describeFailure, isRetryable, sleep, type FetchLike } from "./http.ts";
import { displayFromRecordItem } from "./item-display.ts";
import { fetchPrintfulShipments } from "./printful-shipped.ts";
import { SHIPMENTS_FILE, type LedgerRow as ShippedRow } from "./shipments.ts";
import type { SessionEntry } from "./store.ts";
import type { OrderRecord } from "./types.ts";
import {
  deliveredStatuses,
  parseYoycolDelivery,
  parseYoycolOrderState,
  yoycolGet,
  yoycolOrderPath,
  yoycolTrackingPath,
} from "./yoycol-tracking.ts";

export const FOLLOWUPS_FILE = "followups-emailed.jsonl";
export const START_FILE = "followups-start.json";

const DAY = 86_400_000;
/** "How's it fit?": this long after the last package was delivered. */
export const FIT_AFTER_DELIVERY_DAYS = 3;
/** No carrier ever reported delivery: this long after the last shipped email. */
export const FIT_FALLBACK_DAYS = 12;
/** The carrier still says in transit: ask anyway this long after the last shipped email. */
export const FIT_IN_TRANSIT_DAYS = 21;
/** Stop looking at an order this long after its last shipped email (no more supplier calls). */
export const FIT_GIVE_UP_DAYS = 60;
/** The being-made note: from this many days after the order was paid... */
export const BEING_MADE_FROM_DAYS = 12;
/** ...through this day (a run on day 15 or later doesn't send it). */
export const BEING_MADE_UNTIL_DAYS = 14;
/** Pause between supplier API calls. */
export const API_DELAY_MS = 600;

export type FollowupType = "fit" | "being_made";

export const fitEnabled = (env: Record<string, string | undefined>) => env.MOP_FOLLOWUP_FIT_ENABLED?.trim() === "1";
export const beingMadeEnabled = (env: Record<string, string | undefined>) => env.MOP_FOLLOWUP_YOYCOL_ENABLED?.trim() === "1";
const SWITCH: Record<FollowupType, string> = { fit: "MOP_FOLLOWUP_FIT_ENABLED", being_made: "MOP_FOLLOWUP_YOYCOL_ENABLED" };
const enabled = (type: FollowupType, env: Record<string, string | undefined>) => (type === "fit" ? fitEnabled(env) : beingMadeEnabled(env));

export const followupKey = (type: FollowupType, ref: string) => `${type === "fit" ? "fit" : "being-made"}:${ref}`;

export type FollowupRow = BaseLedgerRow & {
  type: FollowupType;
  /** fit: delivered / fallback / in_transit; being_made: paid. */
  basis?: string;
  due?: string;
  items?: string[];
};

export const createFollowupLedger = (dir: string) => createEmailLedger<FollowupRow>(dir, FOLLOWUPS_FILE);
export type FollowupLedger = ReturnType<typeof createFollowupLedger>;

const ledgers = new Map<string, FollowupLedger>();
/** One ledger (one queue) per data directory for the life of the process. */
export const followupLedger = (dir: string) => {
  let l = ledgers.get(dir);
  if (!l) ledgers.set(dir, (l = createFollowupLedger(dir)));
  return l;
};

// ---- the start file (no backfill) ------------------------------------------------------

export type StartFile = Partial<Record<FollowupType, string>>;

/** $MOP_DATA_DIR/followups-start.json: when each email was first switched on. Missing = never. */
export function readStart(dir: string): StartFile {
  let text: string;
  try {
    text = readFileSync(path.join(dir, START_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  // A corrupt file must stop the run, not reset it: resetting would backfill everything.
  const json = JSON.parse(text);
  const out: StartFile = {};
  for (const t of ["fit", "being_made"] as const) if (typeof json?.[t] === "string" && Number.isFinite(Date.parse(json[t]))) out[t] = json[t];
  return out;
}

export async function writeStart(dir: string, start: StartFile) {
  await fs.mkdir(dir, { recursive: true, mode: 0o750 });
  const file = path.join(dir, START_FILE);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body = { ...start, note: "When each follow-up email was first switched on. Orders before this aren't backfilled (scripts/followup-emails.mjs --include-before)." };
  await fs.writeFile(tmp, JSON.stringify(body, null, 1) + "\n", { mode: 0o640 });
  await fs.rename(tmp, file);
}

/** The earliest moment an order's anchor (delivery / last shipped email / payment) may be. Undefined = no limit (previews only). */
export function gateFor(start: string | undefined, includeBefore: Date | undefined): number | undefined {
  const s = start ? Date.parse(start) : undefined;
  const i = includeBefore?.getTime();
  if (s != null && i != null) return Math.min(s, i);
  return s ?? i;
}

// ---- reading $MOP_DATA_DIR ---------------------------------------------------------------

const jsonl = <T>(file: string): T[] => {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return text.split("\n").flatMap((l) => {
    if (!l.trim()) return [];
    try {
      return [JSON.parse(l) as T];
    } catch {
      return [];
    }
  });
};

export type FollowupOrder = { record: OrderRecord; paidAt: number; entry?: SessionEntry };

/** Each order ref's last "order" line in orders.jsonl (paid = the line's `at`), with its orders-state entry. */
export function loadOrders(dir: string, state: { sessions?: Record<string, SessionEntry> } | null): FollowupOrder[] {
  const byRef = new Map<string, FollowupOrder>();
  for (const row of jsonl<any>(path.join(dir, "orders.jsonl"))) {
    if (row?.type !== "order" || typeof row.order_ref !== "string" || !Array.isArray(row.items)) continue;
    if (!["paid", "no_payment_required"].includes(row.payment_status)) continue;
    const paidAt = Date.parse(row.at) || Date.parse(row.created);
    if (!Number.isFinite(paidAt)) continue;
    const { type: _type, at: _at, ...record } = row;
    byRef.set(row.order_ref, { record: record as OrderRecord, paidAt, entry: state?.sessions?.[row.session_id] });
  }
  return Array.from(byRef.values()).sort((a, b) => a.paidAt - b.paidAt);
}

/** The packages that got a shipped email, by order ref. */
export function shippedByRef(dir: string): Map<string, ShippedRow[]> {
  const m = new Map<string, ShippedRow[]>();
  for (const r of jsonl<ShippedRow>(path.join(dir, SHIPMENTS_FILE))) {
    if (r?.status !== "emailed" || !r.order_ref || !Number.isFinite(Date.parse(r.at))) continue;
    if (m.get(r.order_ref)?.some((x) => x.key === r.key)) continue; // a forced resend
    m.set(r.order_ref, [...(m.get(r.order_ref) ?? []), r]);
  }
  m.forEach((rows) => rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
  return m;
}

// ---- packages and when "How's it fit?" is due (pure) -----------------------------------------

/**
 * delivered: arrived at `deliveredAt`. in_transit: the carrier is reporting, not delivered yet.
 * no_report: no delivery information at all. problem: returned / failed / cancelled in transit.
 */
export type PackageState = "delivered" | "in_transit" | "no_report" | "problem";

export type TrackedPackage = {
  supplier: "printful" | "yoycol";
  id: string;
  state: PackageState;
  shippedAt?: number;
  deliveredAt?: number;
  reshipment?: boolean;
  /** The supplier's own status, for the log. */
  status?: string;
};

const PRINTFUL_IN_TRANSIT = new Set(["in_transit", "out_for_delivery", "available_for_pickup"]);
const PRINTFUL_PROBLEM = new Set(["return_to_sender", "failure", "canceled"]);
const ms = (iso: unknown) => (typeof iso === "string" ? Date.parse(iso) : NaN);

/**
 * Printful v2 shipments -> the packages that have shipped (with their delivery state) and how
 * many of the order's items they hold (reshipments not counted; a shipment without an item
 * list counts as the whole order, like the shipped email).
 */
export function printfulPackages(shipments: any[]): { packages: TrackedPackage[]; shippedQty: number } {
  const packages: TrackedPackage[] = [];
  let shippedQty = 0;
  for (const s of Array.isArray(shipments) ? shipments : []) {
    const status = String(s?.shipment_status ?? "");
    const shippedAt = ms(s?.shipped_at);
    const shipped = status === "shipped" || status === "returned" || (Number.isFinite(shippedAt) && status !== "canceled");
    if (!shipped) continue;
    const reshipment = s?.is_reshipment === true;
    const items: any[] = Array.isArray(s?.shipment_items) ? s.shipment_items : [];
    if (!reshipment) shippedQty += items.length ? items.reduce((n, i) => n + (Number(i?.quantity) || 0), 0) : Number.POSITIVE_INFINITY;
    const ds = String(s?.delivery_status ?? "unknown");
    const events: number[] = (Array.isArray(s?.tracking_events) ? s.tracking_events : []).map((e: any) => ms(e?.triggered_at)).filter(Number.isFinite);
    let deliveredAt = ms(s?.delivered_at);
    if (ds === "delivered" && !Number.isFinite(deliveredAt) && events.length) deliveredAt = Math.max(...events);
    const state: PackageState =
      status === "returned" || PRINTFUL_PROBLEM.has(ds)
        ? "problem"
        : ds === "delivered"
          ? Number.isFinite(deliveredAt)
            ? "delivered"
            : "no_report"
          : PRINTFUL_IN_TRANSIT.has(ds)
            ? "in_transit"
            : "no_report";
    packages.push({
      supplier: "printful",
      id: String(s?.id ?? s?.tracking_number ?? packages.length + 1),
      state,
      ...(Number.isFinite(shippedAt) ? { shippedAt } : {}),
      ...(state === "delivered" ? { deliveredAt } : {}),
      reshipment,
      status: status === "returned" ? "returned" : ds,
    });
  }
  return { packages, shippedQty };
}

/**
 * Has everything in the order shipped? Every supplier has a shipped email; Printful's
 * shipments hold every Printful item (when Printful answered); otherwise the last box's
 * shipped email said it finished the order ("all" / "rest").
 */
export function shippingComplete(input: {
  record: OrderRecord;
  /** The order's shipped emails (emailed lines of shipments-emailed.jsonl), oldest first. */
  shipped: ShippedRow[];
  /** From Printful's shipments; null = Printful didn't answer (or there's no Printful order). */
  printful: { shippedQty: number } | null;
}): { complete: boolean; reason: string } {
  const suppliers = Array.from(new Set(input.record.items.map((i) => i.supplier)));
  if (!suppliers.length) return { complete: false, reason: "no items on the order" };
  if (suppliers.includes("manual")) return { complete: false, reason: "it has items John places by hand, which aren't tracked" };
  for (const s of suppliers)
    if (!input.shipped.some((r) => r.supplier === s)) return { complete: false, reason: `the ${s === "printful" ? "Printful" : "Yoycol"} part hasn't shipped yet` };
  if (suppliers.includes("printful") && input.printful) {
    const ordered = input.record.items.filter((i) => i.supplier === "printful").reduce((n, i) => n + i.qty, 0);
    if (input.printful.shippedQty < ordered)
      return { complete: false, reason: `Printful has shipped ${input.printful.shippedQty} of ${ordered} item(s)` };
  } else if (suppliers.includes("printful")) {
    const last = input.shipped.filter((r) => r.kind !== "replacement").pop();
    if (last?.kind && last.kind !== "all" && last.kind !== "rest") return { complete: false, reason: "the last shipped email was for part of the order" };
  }
  return { complete: true, reason: "everything has shipped" };
}

export type FitBasis = "delivered" | "fallback" | "in_transit";
type Timed = { dueAt: number; basis: FitBasis; anchor: number; reason: string };
export type FitDecision = ({ status: "due" } & Timed) | ({ status: "waiting" } & Timed) | { status: "incomplete"; reason: string } | { status: "held"; reason: string };

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** When "How's it fit?" is due, from the order's packages (see the top of the file). */
export function fitDecision(input: {
  now: number;
  /** When the order's last shipped email went out. */
  lastShippedAt: number;
  packages: TrackedPackage[];
  complete: { complete: boolean; reason: string };
}): FitDecision {
  if (!input.complete.complete) return { status: "incomplete", reason: input.complete.reason };
  const { packages } = input;
  // A returned / failed package counts unless a reshipment went out after it.
  const superseded = (p: TrackedPackage) => packages.some((q) => q !== p && q.reshipment && (q.shippedAt ?? Infinity) > (p.shippedAt ?? 0));
  const problems = packages.filter((p) => p.state === "problem" && !superseded(p));
  if (problems.length)
    return { status: "held", reason: `${problems.map((p) => `${p.supplier} package ${p.id} is ${p.status ?? "a problem"}`).join("; ")}: not asking how it fits` };
  const live = packages.filter((p) => p.state !== "problem");
  const delivered = live.filter((p) => p.state === "delivered");
  const lastDelivered = delivered.length ? Math.max(...delivered.map((p) => p.deliveredAt!)) : undefined;
  let dueAt: number, basis: FitBasis, anchor: number, reason: string;
  if (live.length && delivered.length === live.length) {
    dueAt = lastDelivered! + FIT_AFTER_DELIVERY_DAYS * DAY;
    basis = "delivered";
    anchor = lastDelivered!;
    reason = `${live.length > 1 ? `all ${live.length} packages` : "delivered"} ${live.length > 1 ? "delivered, the last " : ""}${day(lastDelivered!)}`;
  } else {
    const moving = live.some((p) => p.state === "in_transit");
    dueAt = input.lastShippedAt + (moving ? FIT_IN_TRANSIT_DAYS : FIT_FALLBACK_DAYS) * DAY;
    if (lastDelivered != null) dueAt = Math.max(dueAt, lastDelivered + FIT_AFTER_DELIVERY_DAYS * DAY);
    basis = moving ? "in_transit" : "fallback";
    anchor = input.lastShippedAt;
    reason = moving
      ? `still in transit (last shipped ${day(input.lastShippedAt)}); asking ${FIT_IN_TRANSIT_DAYS} days after shipping at the latest`
      : `no delivery report (last shipped ${day(input.lastShippedAt)}); ${FIT_FALLBACK_DAYS} days after the shipped email`;
  }
  return input.now >= dueAt ? { status: "due", dueAt, basis, anchor, reason } : { status: "waiting", dueAt, basis, anchor, reason };
}

/** The being-made note's window: early before day 12, due days 12–14, late from day 15. */
export function beingMadeWindow(paidAt: number, now: number): "early" | "due" | "late" {
  if (now < paidAt + BEING_MADE_FROM_DAYS * DAY) return "early";
  if (now >= paidAt + (BEING_MADE_UNTIL_DAYS + 1) * DAY) return "late";
  return "due";
}

// ---- the daily run ---------------------------------------------------------------------------

export type FollowupDeps = {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  log: (msg: string) => void;
  now: () => Date;
  /** $MOP_DATA_DIR. */
  dir: string;
  /** Parsed orders-state.json (read only). */
  state: { sessions?: Record<string, SessionEntry> } | null;
  /** Default: followupLedger(dir). */
  ledger?: FollowupLedger;
  /** --dry-run: print the emails (on or off), send none, don't record a start. */
  dryRun?: boolean;
  /** --include-before: orders from this date on count even if they came before the start. */
  includeBefore?: Date;
  /** Print what the suppliers answered. */
  verbose?: boolean;
  apiDelayMs?: number;
  retryDelayMs?: number;
};

export type FollowupOutcome = "sent" | "dry_run" | "would_send" | "waiting" | "held" | "skipped" | "failed" | "duplicate" | "in_progress";
export type FollowupResult = { type: FollowupType; ref: string; outcome: FollowupOutcome; reason?: string; dueAt?: string };
export type FollowupSummary = { results: FollowupResult[]; errors: number; start: StartFile };

const WHAT: Record<FollowupType, string> = { fit: `"How's it fit?" email`, being_made: `"being made" note` };

export async function runFollowups(deps: FollowupDeps): Promise<FollowupSummary> {
  const { env, log, dir } = deps;
  const now = deps.now();
  const ledger = deps.ledger ?? followupLedger(dir);
  const results: FollowupResult[] = [];
  let errors = 0;

  // The start of each switch: recorded the first time it runs switched on (not a dry run).
  const start = readStart(dir);
  const live = (t: FollowupType) => enabled(t, env) && !deps.dryRun;
  let changed = false;
  for (const t of ["fit", "being_made"] as const) {
    if (live(t) && !start[t]) {
      start[t] = now.toISOString();
      changed = true;
      log(`[followup] ${WHAT[t]}: switched on for the first time; only orders ${t === "fit" ? "delivered" : "paid"} from now on count (${START_FILE}; --include-before <date> for older ones)`);
    }
  }
  if (changed) await writeStart(dir, start);
  const gate: Record<FollowupType, number | undefined> = {
    fit: gateFor(start.fit, deps.includeBefore),
    being_made: gateFor(start.being_made, deps.includeBefore),
  };
  for (const t of ["fit", "being_made"] as const) {
    if (live(t)) continue;
    const mode = deps.dryRun ? "dry run: printing what's due, sending nothing" : `off (${SWITCH[t]} isn't 1): logging what it would send`;
    log(
      `[followup] ${WHAT[t]}: ${mode}${
        gate[t] == null ? "; it has never been switched on, so every order due by date is listed (once on, only orders after that count)" : ""
      }`
    );
  }

  let calls = 0;
  const api = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (calls++) await sleep(deps.apiDelayMs ?? API_DELAY_MS);
    return fn();
  };
  const done = new Set((await ledger.rows()).filter((r) => r.status === "emailed").map((r) => r.key));
  const shipped = shippedByRef(dir);
  const yoycolKeys = !!(env.YOYCOL_ACCESS_KEY && env.YOYCOL_SECRET_KEY);
  let toldNoYoycolKeys = false;
  const noYoycolKeys = () => {
    if (!toldNoYoycolKeys) log("[followup] YOYCOL_ACCESS_KEY / YOYCOL_SECRET_KEY are not set: Yoycol can't be asked");
    toldNoYoycolKeys = true;
  };

  /** Send (or preview, or say what would be sent). */
  const deliver = async (type: FollowupType, order: FollowupOrder, email: () => FollowupEmail, extra: { basis: string; due: string; items: string[] }) => {
    const ref = order.record.order_ref;
    const who = `${ref} (${shortOrderNumber(ref)})`;
    const to = (order.record.customer?.email ?? "").trim();
    if (!live(type) && !deps.dryRun) {
      log(`[followup] ${type} ${who}: would send "${email().subject}" to ${domainOf(to)} (${extra.basis}); ${SWITCH[type]} isn't 1`);
      results.push({ type, ref, outcome: "would_send", dueAt: extra.due });
      return;
    }
    const key = followupKey(type, ref);
    const r = await deliverOnce<FollowupRow>(
      {
        ledger,
        row: { key, order_ref: ref, type, to: to || undefined, ...extra },
        tag: "[followup]",
        what: WHAT[type],
        who,
        to,
        noAddressError: "no customer email address on the order (the Stripe session had none)",
        build: email,
        idempotencyKey: `mop-followup/${key}`,
        alert: (sent) => ({
          subject: `ACTION NEEDED: ${type === "fit" ? `"How's it fit?" email` : `"being made" note`} failed for ${ref}`,
          body: [
            `The ${WHAT[type]} to the customer didn't go out.`,
            ``,
            `Why: ${sent.error}`,
            `To: ${to || "(no address)"} (from the Stripe checkout)`,
            `Order: ${ref} (${shortOrderNumber(ref)})`,
            `Items: ${extra.items.join("; ")}`,
            ``,
            `Next: ${
              sent.retryable
                ? `the daily follow-up run (scripts/followup-emails.mjs, cron) tries again tomorrow${type === "being_made" ? ", while the order is still within 14 days" : ""}.`
                : "retrying probably won't fix this one; it's tried again tomorrow anyway. You can also email the customer by hand."
            }`,
            `Log: /var/lib/mopclothing/followup-emails.log and ${ledger.file}`,
          ].join("\n"),
        }),
      },
      deps.dryRun ? { ...deps, env: { ...env, MOP_EMAIL_DRY_RUN: "1" } } : deps
    );
    const outcome: FollowupOutcome =
      r.status === "emailed" ? "sent" : r.status === "dry_run" ? "dry_run" : r.status === "duplicate" ? "duplicate" : r.status === "in_progress" ? "in_progress" : r.status === "skipped" ? "skipped" : "failed";
    if (outcome === "failed") errors++;
    results.push({ type, ref, outcome, reason: r.error, dueAt: extra.due });
  };

  for (const order of loadOrders(dir, deps.state)) {
    const { record } = order;
    const ref = record.order_ref;
    const who = `${ref} (${shortOrderNumber(ref)})`;
    const itemLines = (items: OrderRecord["items"]) => items.map((i) => `${i.qty} x ${i.title}`);

    // ---- "How's it fit?" ----
    const boxes = shipped.get(ref) ?? [];
    const lastShippedAt = boxes.length ? Math.max(...boxes.map((r) => Date.parse(r.at))) : 0;
    if (boxes.length && !done.has(followupKey("fit", ref)) && now.getTime() - lastShippedAt <= FIT_GIVE_UP_DAYS * DAY) {
      const packages: TrackedPackage[] = [];
      let printful: { shippedQty: number } | null = null;
      let retryLater = "";

      const pfIds = Array.from(
        new Set(
          [
            ...(() => {
              const p = order.entry?.suppliers?.printful;
              return p?.ok && !p.dryRun && p.id && /^\d{1,15}$/.test(p.id) ? [p.id] : [];
            })(),
            ...boxes.filter((b) => b.supplier === "printful").map((b) => b.order_id),
          ].filter(Boolean)
        )
      );
      if (record.items.some((i) => i.supplier === "printful") && pfIds.length) {
        let qty = 0;
        let allAnswered = true;
        for (const id of pfIds) {
          const r = await api(() => fetchPrintfulShipments(id, deps));
          if (deps.verbose) log(`[followup] fit ${who}: Printful order ${id} shipments: ${JSON.stringify(r.shipments ?? r.error).slice(0, 2000)}`);
          if (!r.ok) {
            allAnswered = false;
            errors++;
            log(`[followup] fit ${who}: Printful order ${id}: couldn't read its shipments: ${r.error}${r.retryable ? " (trying again next run)" : " (going by the shipped emails)"}`);
            if (r.retryable) retryLater = `Printful didn't answer for order ${id}`;
            continue;
          }
          const p = printfulPackages(r.shipments!);
          packages.push(...p.packages);
          qty += p.shippedQty;
        }
        // Printful answered but shows nothing shipped, though a shipped email went out: its
        // answer doesn't look like the spec, so go by the shipped emails instead of waiting forever.
        if (allAnswered && !packages.length) log(`[followup] fit ${who}: Printful's shipments show nothing shipped, but a shipped email went out; going by the shipped emails`);
        else if (allAnswered) printful = { shippedQty: qty };
      }

      const yBox = boxes.find((b) => b.supplier === "yoycol");
      if (yBox && !retryLater) {
        if (!yoycolKeys) {
          noYoycolKeys();
          packages.push({ supplier: "yoycol", id: yBox.order_id, state: "no_report", shippedAt: Date.parse(yBox.at) });
        } else {
          const r = (await api(() => yoycolGet(yoycolTrackingPath(yBox.order_id), deps)))!;
          if (deps.verbose) log(`[followup] fit ${who}: Yoycol ${yBox.order_id} tracking response: ${r.text.slice(0, 2000)}`);
          if (!r.ok) {
            errors++;
            log(`[followup] fit ${who}: Yoycol order ${yBox.order_id} tracking: ${describeFailure(r)}${isRetryable(r) ? " (trying again next run)" : ""}`);
            if (isRetryable(r)) retryLater = `Yoycol didn't answer for order ${yBox.order_id}`;
          } else if (String(r.json?.code) !== "100000") {
            log(`[followup] fit ${who}: Yoycol code ${r.json?.code}: ${r.json?.msg ?? ""} (treated as no delivery report)`);
          }
          const d = r.ok ? parseYoycolDelivery(r.json, deliveredStatuses(env)) : { state: "no_report" as const };
          packages.push({
            supplier: "yoycol",
            id: yBox.order_id,
            state: d.state,
            shippedAt: Date.parse(yBox.at),
            ...(d.state === "delivered" ? { deliveredAt: d.at } : {}),
            status: d.state,
          });
        }
      }

      if (retryLater) {
        results.push({ type: "fit", ref, outcome: "waiting", reason: `${retryLater}; trying again next run` });
      } else {
        const decision = fitDecision({ now: now.getTime(), lastShippedAt, packages, complete: shippingComplete({ record, shipped: boxes, printful }) });
        if (decision.status === "incomplete" || decision.status === "held") {
          log(`[followup] fit ${who}: ${decision.status === "held" ? "HELD: " : "waiting: "}${decision.reason}`);
          results.push({ type: "fit", ref, outcome: decision.status === "held" ? "held" : "waiting", reason: decision.reason });
        } else if (decision.status === "waiting") {
          log(`[followup] fit ${who}: due ${day(decision.dueAt)} (${decision.reason})`);
          results.push({ type: "fit", ref, outcome: "waiting", reason: decision.reason, dueAt: new Date(decision.dueAt).toISOString() });
        } else if (gate.fit != null && decision.anchor < gate.fit) {
          const what = decision.basis === "delivered" ? `delivered ${day(decision.anchor)}` : `last shipped ${day(decision.anchor)}`;
          log(`[followup] fit ${who}: not sending: ${what}, before ${day(gate.fit)} (no backfill; --include-before ${day(decision.anchor)} to send it)`);
          results.push({ type: "fit", ref, outcome: "skipped", reason: "before the start" });
        } else {
          const items = record.items.map((i) => displayFromRecordItem(i));
          await deliver("fit", order, () => fitEmail({ name: record.customer?.name ?? "", orderRef: ref, items, delivered: decision.basis === "delivered" }), {
            basis: `${decision.basis}: ${decision.reason}`,
            due: new Date(decision.dueAt).toISOString(),
            items: itemLines(record.items),
          });
        }
      }
    }

    // ---- "being made" (Yoycol) ----
    const yItems = record.items.filter((i) => i.supplier === "yoycol");
    const y = order.entry?.suppliers?.yoycol;
    if (!yItems.length || !y?.ok || y.dryRun || !y.id || !/^\d{1,20}$/.test(y.id)) continue;
    if (done.has(followupKey("being_made", ref)) || beingMadeWindow(order.paidAt, now.getTime()) !== "due") continue;
    if (boxes.some((b) => b.supplier === "yoycol" && b.order_id === y.id)) {
      results.push({ type: "being_made", ref, outcome: "skipped", reason: "already shipped" });
      continue;
    }
    if (gate.being_made != null && order.paidAt < gate.being_made) {
      log(`[followup] being_made ${who}: not sending: paid ${day(order.paidAt)}, before ${day(gate.being_made)} (no backfill; --include-before ${day(order.paidAt)} to send it)`);
      results.push({ type: "being_made", ref, outcome: "skipped", reason: "before the start" });
      continue;
    }
    if (!yoycolKeys) {
      noYoycolKeys();
      errors++;
      results.push({ type: "being_made", ref, outcome: "waiting", reason: "Yoycol keys not set" });
      continue;
    }
    const r = (await api(() => yoycolGet(yoycolOrderPath(y.id!), deps)))!;
    if (deps.verbose) log(`[followup] being_made ${who}: Yoycol order ${y.number ?? y.id}: ${r.text.slice(0, 2000)}`);
    const status = r.ok ? parseYoycolOrderState(r.json) : null;
    if (!status) {
      errors++;
      log(`[followup] being_made ${who}: couldn't read Yoycol order ${y.number ?? y.id}: ${r.ok ? `code ${r.json?.code}: ${r.json?.msg ?? "no order in the answer"}` : describeFailure(r)} (trying again next run)`);
      results.push({ type: "being_made", ref, outcome: "waiting", reason: "Yoycol order unreadable" });
      continue;
    }
    if (status.state !== "in_production") {
      log(
        `[followup] being_made ${who}: ${status.state === "unpaid" ? "NOT SENT: Yoycol order is still unpaid, so nothing is being made" : "not sending: Yoycol order is cancelled"} (Yoycol ${y.number ?? y.id}: ${status.label})`
      );
      results.push({ type: "being_made", ref, outcome: status.state === "unpaid" ? "held" : "skipped", reason: `Yoycol: ${status.label}` });
      continue;
    }
    const items = yItems.map((i) => displayFromRecordItem(i));
    await deliver(
      "being_made",
      order,
      () => beingMadeEmail({ name: record.customer?.name ?? "", orderRef: ref, items, total: arrivalText(vendorDelivery.yoycol) }),
      { basis: `paid ${day(order.paidAt)}; Yoycol ${y.number ?? y.id}: ${status.label}`, due: new Date(order.paidAt + BEING_MADE_FROM_DAYS * DAY).toISOString(), items: itemLines(yItems) }
    );
  }
  return { results, errors, start };
}
