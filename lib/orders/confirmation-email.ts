// The customer's "thanks for your order" email: HTML + plain text. Built from
// the same pieces as the shipped email (email-layout.ts: shell, header, footer,
// colours, item rows), so the two read as one set.
//
// Every amount comes from the order record, which is the Stripe session as the
// webhook received it: the line prices are the session's per-item amounts and
// the subtotal, discount, shipping, tax and total are the session's own totals.
// Nothing is re-priced here (confirmation.ts builds the input).
import type { DisplayItem } from "./item-display.ts";
import {
  C,
  DISPLAY,
  FONT,
  REPLY,
  SHIPPING_URL,
  emailDocument,
  esc,
  greetingFor,
  greetingRow,
  headlineRow,
  helpRow,
  itemsRow,
  leadRow,
  money,
  orderNumberRow,
  panelRow,
  replyRow,
  ruleRow,
  sectionLabelRow,
  shortOrderNumber,
  textFooter,
  thanksRow,
} from "./email-layout.ts";

export const CONFIRMATION_SUBJECT = "Thanks for your MOP order! Here's what happens next";

export type ConfirmationItem = DisplayItem & {
  /** Cents for the whole line (unit amount x qty) from the session; unset = no prices shown. */
  lineAmount?: number;
  unitAmount?: number;
  /** "about 1–2 weeks": the product's delivery estimate (vendorDelivery in public/products.ts). */
  arrives: string;
  /** "2–5 business days": making + packing. */
  production: string;
  /** The supplier order it's in. Items in different ones may ship separately. */
  group: string;
};

export type ConfirmationEmailInput = {
  /** The customer's full name (the email greets the first word). */
  name: string;
  orderRef: string;
  currency: string;
  items: ConfirmationItem[];
  /** Cents, all from the session. */
  totals: { subtotal: number; discount: number; shipping: number; tax: number; total: number };
  /** The codes used ("WELCOME10"); empty with a discount = a discount whose code we couldn't read. */
  discountCodes: string[];
};

export type ConfirmationEmail = { subject: string; html: string; text: string; preheader: string };

export type TimelineStep = { title: string; detail: string[] };

const HEADLINE = "Thanks for your order!";
const LEAD = "We've got it. Here's what happens next.";
const MADE = "We make it after you order. Nothing sits in a warehouse.";
const SPLIT = "Your pieces are made by different print partners, so they may arrive in separate packages, each with its own tracking email.";
const CARE_LABEL = "Caring for it";
export const CARE_TIPS = ["Wash cold, inside out. Hang dry or tumble dry low.", "Don't iron directly on the print."];
const HELP = "How delivery and replacements work:";
// Hats aren't washed like shirts, so an order of only hats gets no washing tips.
const isHat = (i: { title: string }) => /\b(snapback|hat|cap)\b/i.test(i.title);

/** Items grouped by a value, in order of first appearance. */
const groupBy = <T,>(list: T[], key: (t: T) => string) => {
  const m = new Map<string, T[]>();
  for (const t of list) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
  return Array.from(m.entries());
};
const names = (list: { title: string }[]) => Array.from(new Set(list.map((i) => i.title))).join(", ");

/** Made -> printed & packed -> shipped -> at the door, with each item's own times when they differ. */
export function timeline(items: ConfirmationItem[]): TimelineStep[] {
  const split = new Set(items.map((i) => i.group)).size > 1;
  const making = groupBy(items, (i) => i.production);
  const arriving = groupBy(items, (i) => i.arrives);
  return [
    { title: "Made just for you", detail: [MADE] },
    making.length === 1
      ? { title: `Printed & packed (${making[0][0]})`, detail: [] }
      : { title: "Printed & packed", detail: making.map(([time, list]) => `${names(list)}: ${time}`) },
    { title: "Shipped, with a tracking email from us", detail: split ? [SPLIT] : [] },
    arriving.length === 1
      ? { title: `At your door in ${arriving[0][0]}`, detail: [] }
      : { title: "At your door", detail: arriving.map(([time, list]) => `${names(list)}: ${time}`) },
  ];
}

/** Subtotal, discount (with the code), shipping, tax (only if any), total paid. */
export function totalLines(input: ConfirmationEmailInput): { label: string; amount: string; strong?: boolean; discount?: boolean }[] {
  const { totals: t, currency } = input;
  const codes = input.discountCodes.filter(Boolean);
  return [
    { label: "Subtotal", amount: money(t.subtotal, currency) },
    ...(t.discount > 0
      ? [{ label: codes.length ? `Discount (${codes.join(", ")})` : "Discount", amount: `-${money(t.discount, currency)}`, discount: true }]
      : []),
    { label: "Shipping", amount: t.shipping > 0 ? money(t.shipping, currency) : "Free" },
    ...(t.tax > 0 ? [{ label: "Tax", amount: money(t.tax, currency) }] : []),
    { label: "Total paid", amount: money(t.total, currency), strong: true },
  ];
}

/** "Blue Sky Cotton Shorts: about 3–4 weeks": the time after the colon never breaks across lines on a phone. */
const keepTimeTogether = (html: string) => html.replace(/: ([^:<]{1,30})$/, ': <span style="white-space:nowrap;">$1</span>');

const itemLine = (i: ConfirmationItem, currency: string) =>
  `${i.qty > 1 ? `${i.qty} x ` : ""}${i.title}${i.options ? ` (${i.options})` : ""}${i.lineAmount != null ? `: ${money(i.lineAmount, currency)}` : ""}`;

export function confirmationEmail(input: ConfirmationEmailInput): ConfirmationEmail {
  const { items, currency } = input;
  const greeting = greetingFor(input.name);
  const orderNo = shortOrderNumber(input.orderRef);
  const steps = timeline(items);
  const totals = totalLines(input);
  const care = items.some((i) => !isHat(i)) ? CARE_TIPS : [];
  const split = new Set(items.map((i) => i.group)).size > 1;
  const arrivals = new Set(items.map((i) => i.arrives));
  const thanks = `Thank you for supporting original art. We hope ${items.length > 1 || items.some((i) => i.qty > 1) ? "they become favorites" : "it becomes a favorite"}.`;
  const preheader = `Your order ${orderNo} is in. Made just for you, ${
    split ? "and your pieces may ship separately." : arrivals.size === 1 ? `at your door in ${Array.from(arrivals)[0]}.` : "then shipped with tracking."
  }`;

  // ---- plain text ----
  const text = [
    greeting,
    "",
    `${HEADLINE} ${LEAD}`,
    "",
    "What happens next:",
    ...steps.flatMap((s, n) => [`${n + 1}. ${s.title}`, ...s.detail.map((d) => `   ${d}`)]),
    "",
    "Your order:",
    ...items.map((i) => `- ${itemLine(i, currency)}`),
    "",
    ...totals.map((t) => `${t.label}: ${t.amount}`),
    "",
    `Order ${orderNo}`,
    ...(care.length ? ["", `${CARE_LABEL}:`, ...care.map((c) => `- ${c}`)] : []),
    "",
    thanks,
    "",
    REPLY,
    `${HELP} ${SHIPPING_URL}`,
    "",
    ...textFooter(input.orderRef),
  ].join("\n");

  // ---- HTML ----
  const stepRows = steps
    .map(
      (s, n) => `<tr>
<td width="30" valign="top" style="width:30px;padding:0 0 ${n === steps.length - 1 ? 16 : 14}px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="26" height="26" bgcolor="${C.button}" style="width:26px;height:26px;border-radius:13px;background-color:${C.button};font-family:${DISPLAY};font-size:13px;line-height:26px;font-weight:700;color:#ffffff;">${n + 1}</td></tr></table>
</td>
<td valign="top" style="padding:2px 0 ${n === steps.length - 1 ? 16 : 14}px 12px;font-family:${FONT};">
<div style="font-size:16px;line-height:22px;font-weight:700;color:${C.ink};" class="mop-text">${esc(s.title)}</div>
${s.detail.map((d) => `<div style="font-size:14px;line-height:20px;color:${C.muted};padding:2px 0 0 0;" class="mop-muted">${keepTimeTogether(esc(d))}</div>`).join("\n")}
</td>
</tr>`
    )
    .join("\n");
  const timelineBlock = panelRow(
    `<div style="font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};padding:0 0 14px 0;" class="mop-muted">What happens next</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${stepRows}
</table>`,
    { align: "left", padding: "20px 18px 4px 18px" }
  );

  const totalsBlock = `<tr><td style="padding:2px 0 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.rule};" class="mop-rule">
${totals
  .map((t, n) => {
    const pad = n === 0 ? "14px 0 0 0" : t.strong ? "10px 0 0 0" : "6px 0 0 0";
    const size = t.strong ? "font-size:18px;line-height:26px;font-weight:700;" : "font-size:15px;line-height:22px;";
    const labelColor = t.strong ? `color:${C.ink};" class="mop-text"` : `color:${C.muted};" class="mop-muted"`;
    const amountColor = t.discount ? `color:${C.link};" class="mop-link"` : `color:${C.ink};" class="mop-text"`;
    return `<tr><td style="padding:${pad};font-family:${FONT};${size}${labelColor}>${esc(t.label)}</td><td align="right" style="padding:${pad};font-family:${FONT};${size}white-space:nowrap;${amountColor}>${t.discount ? esc(t.amount).replace(/^-/, "&minus;") : esc(t.amount)}</td></tr>`;
  })
  .join("\n")}
</table>
</td></tr>`;

  const careBlock = care.length
    ? [
        sectionLabelRow(CARE_LABEL, "26px 0 8px 0"),
        `<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${care
  .map(
    (c) =>
      `<tr><td width="18" valign="top" style="width:18px;font-family:${FONT};font-size:15px;line-height:22px;font-weight:700;color:${C.orange};">&bull;</td><td style="padding:0 0 4px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink};" class="mop-text">${esc(c)}</td></tr>`
  )
  .join("\n")}
</table>
</td></tr>`,
      ].join("\n")
    : "";

  const html = emailDocument({
    title: CONFIRMATION_SUBJECT,
    preheader,
    orderRef: input.orderRef,
    rows: [
      greetingRow(greeting),
      headlineRow(HEADLINE),
      leadRow(LEAD),
      timelineBlock,
      sectionLabelRow("Your order"),
      itemsRow(items, {
        qtyText: (i) => `Qty ${i.qty}${i.qty > 1 && i.unitAmount != null ? ` · ${money(i.unitAmount, currency)} each` : ""}`,
        price: (i) => (i.lineAmount != null ? money(i.lineAmount, currency) : undefined),
      }),
      totalsBlock,
      orderNumberRow(orderNo),
      careBlock,
      ruleRow(),
      thanksRow(thanks),
      replyRow(),
      helpRow(HELP),
    ],
  });

  return { subject: CONFIRMATION_SUBJECT, html, text, preheader };
}
