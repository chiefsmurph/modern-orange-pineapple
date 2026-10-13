// Emails to John, sent through the PingPigeon app on the same box
// (POST <PINGPIGEON_URL>/email, Bearer PINGPIGEON_TOKEN). PingPigeon's hosted
// mode always delivers to the token owner's own verified address, so the token
// decides who gets the email: use a token minted on John's account.
// ORDER_DRY_RUN=1 logs the email instead of sending it.
import { describeFailure, requestJson, sleep, type FetchLike } from "./http.ts";
import { itemSummary } from "./build-items.ts";
import type { OrderCodes, OrderRecord, RoyaltyRow, SupplierResult } from "./types.ts";

export const DEFAULT_PINGPIGEON_URL = "http://127.0.0.1:3141";

export type Email = { subject: string; body: string; html: string };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const supplierName: Record<string, string> = {
  printful: "Printful",
  yoycol: "Yoycol",
  manual: "By hand",
};

const stripeLink = (r: OrderRecord) =>
  r.payment_intent
    ? `https://dashboard.stripe.com/${r.livemode ? "" : "test/"}payments/${r.payment_intent}`
    : `https://dashboard.stripe.com/${r.livemode ? "" : "test/"}checkout/sessions/${r.session_id}`;

export function orderEmail(
  record: OrderRecord,
  results: Record<string, SupplierResult>,
  royalties: RoyaltyRow[],
  codes?: OrderCodes
): Email {
  const failed = Object.values(results).filter((r) => !r.ok);
  const dry = Object.values(results).some((r) => r.dryRun);
  const what =
    record.items.map((i) => `${i.qty > 1 ? `${i.qty} x ` : ""}${i.title} (${itemSummary(i)})`).join(", ") ||
    "unknown items";
  const actionBits = Object.values(results).map((r) =>
    r.ok
      ? r.supplier === "printful"
        ? r.status === "draft"
          ? `confirm Printful draft #${r.id}`
          : `Printful #${r.id} ${r.status ?? ""}`.trim()
        : `pay Yoycol order ${r.number ?? r.id ?? ""}`.trim()
      : `${supplierName[r.supplier]} FAILED`
  );
  const subject =
    `${dry ? "[DRY RUN] " : ""}${failed.length || record.items.length === 0 ? "ACTION NEEDED: " : ""}MOP order: ${what}` +
    (actionBits.length ? ` (${actionBits.join("; ")})` : "");

  const c = record.customer;
  const a = c.address;
  const shipTo = [
    c.name,
    a.line1,
    a.line2,
    [a.city, a.state, a.postal_code].filter(Boolean).join(", "),
    a.country,
    c.phone && `Phone: ${c.phone}`,
    c.email && `Email: ${c.email}`,
  ].filter(Boolean) as string[];

  const lines: string[] = [];
  lines.push(
    `${dry ? "DRY RUN (nothing was sent to a supplier). " : ""}New order on mopclothing.com: ${money(record.amount_total)} paid${record.livemode ? "" : " (Stripe TEST mode)"}.`,
    "",
    "WHAT SOLD"
  );
  if (record.items.length === 0) lines.push("- Couldn't read the items: check the Stripe payment (link below).");
  for (const i of record.items) {
    lines.push(`- ${i.qty} x ${i.title}: ${itemSummary(i) || "no options"}, ${money(i.unitAmount)} each [${supplierName[i.supplier]}]`);
  }
  lines.push("", "WHAT TO DO");
  for (const r of Object.values(results)) {
    if (r.ok) {
      lines.push(`- ${supplierName[r.supplier]}: ${r.action ?? "done"}${r.cost ? ` Supplier cost: ${r.cost}.` : ""}`);
      if (r.url) lines.push(`  ${r.url}`);
    } else if (r.supplier === "manual") {
      lines.push(`- Place by hand: ${r.error}`);
    } else {
      lines.push(
        `- ${supplierName[r.supplier]} order FAILED: ${r.error}`,
        "  The order is saved on the box (orders.jsonl). Create it by hand in the dashboard with the details here."
      );
    }
  }
  if (Object.keys(results).length === 0) lines.push("- Nothing was sent to a supplier: check the items.");
  lines.push("", "SHIP TO", ...shipTo.map((l) => `  ${l}`));
  if (codes?.items.length) {
    lines.push("", "REGISTRATION CODES");
    for (const c of codes.items)
      lines.push(
        `- ${c.code}: ${c.title} (${itemSummary({ opts: c.variant, slug: c.slug })})${
          c.supplier === "printful" ? (codes.order ? "" : ", on the packing slip") : ", NOT printed (send it to them if you like)"
        }`
      );
    if (codes.order) lines.push(`- Order code ${codes.order} (on the packing slip) registers all the Printful items`);
  }
  if (royalties.length) {
    lines.push("", "ROYALTIES");
    for (const r of royalties)
      lines.push(`- ${r.artist}: $${r.amount.toFixed(2)} (${r.qty} x ${r.product}, ${itemSummary({ opts: r.options, slug: r.slug })})`);
  }
  lines.push(
    "",
    `Order ref: ${record.order_ref} (Printful external id / Yoycol store order no.)`,
    `Stripe: ${stripeLink(record)}`
  );
  const body = lines.join("\n");
  const html =
    `<div style="font:15px/1.5 -apple-system,system-ui,sans-serif;color:#111;max-width:640px">` +
    body
      .split("\n")
      .map((l) => {
        const t = esc(l);
        if (/^[A-Z][A-Z ]+$/.test(l)) return `<h3 style="margin:18px 0 6px;font-size:14px;letter-spacing:.5px">${t}</h3>`;
        return `<div>${t.replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>') || "&nbsp;"}</div>`;
      })
      .join("") +
    `</div>`;
  return { subject, body, html };
}

export async function sendEmail(
  email: Email,
  deps: {
    env: Record<string, string | undefined>;
    fetch: FetchLike;
    log: (msg: string) => void;
    retryDelayMs?: number;
  }
): Promise<{ ok: boolean; dryRun?: boolean; error?: string }> {
  const { env, log } = deps;
  if (env.ORDER_DRY_RUN === "1") {
    log(`[orders] DRY-RUN email to John\nSubject: ${email.subject}\n\n${email.body}`);
    return { ok: true, dryRun: true };
  }
  if (!env.PINGPIGEON_TOKEN) return { ok: false, error: "PINGPIGEON_TOKEN is not set" };
  const url = `${(env.PINGPIGEON_URL || DEFAULT_PINGPIGEON_URL).replace(/\/+$/, "")}/email`;
  const send = () =>
    requestJson(deps.fetch, url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PINGPIGEON_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "mopclothing-orders/1",
      },
      body: JSON.stringify({
        subject: email.subject,
        body: email.body,
        ...(email.html ? { html: email.html } : {}),
      }),
    });
  let r = await send();
  if (!(r.ok && r.json?.ok !== false)) {
    log(`[orders] email failed (${describeFailure(r)}); retrying once`);
    await sleep(deps.retryDelayMs ?? 2000);
    r = await send();
  }
  return r.ok && r.json?.ok !== false ? { ok: true } : { ok: false, error: describeFailure(r) };
}
