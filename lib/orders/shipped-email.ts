// The customer's "your order has shipped" email: HTML + plain text.
// The shell, header, footer, colours and item rows are shared with the order
// confirmation (email-layout.ts), so the two emails always look like one set.
import { groupTrackingNumber, type Tracking } from "./tracking.ts";
import type { DisplayItem } from "./item-display.ts";
import {
  C,
  FONT,
  MONO,
  REPLY,
  SHIPPING_URL,
  ctaButton,
  emailDocument,
  esc,
  greetingFor,
  greetingRow,
  headlineRow,
  helpRow,
  itemsRow,
  leadRow,
  orderNumberRow,
  panelRow,
  replyRow,
  ruleRow,
  sectionLabelRow,
  shortOrderNumber,
  textFooter,
  thanksRow,
} from "./email-layout.ts";

export { firstName, shortOrderNumber } from "./email-layout.ts";

/**
 * all: everything in the order is in this box.
 * part: more is coming separately.
 * rest: the last box of an order that came in several.
 * replacement: a reshipment (Printful sends one when a package is lost or damaged).
 */
export type ShipmentKind = "all" | "part" | "rest" | "replacement";

export type ShippedEmailInput = {
  /** The customer's full name (the email greets the first word). */
  name: string;
  orderRef: string;
  items: DisplayItem[];
  tracking: Tracking | null;
  /** YYYY-MM-DD. */
  shipDate?: string;
  kind: ShipmentKind;
};

export type ShippedEmail = { subject: string; html: string; text: string; preheader: string };

/** "2026-10-16" -> "Oct 16". */
const shortDate = (ymd?: string) => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

const SUBJECTS: Record<ShipmentKind, string> = {
  all: "Your MOP order has shipped 📦",
  part: "Part of your MOP order has shipped 📦",
  rest: "The rest of your MOP order has shipped 📦",
  replacement: "Your MOP replacement has shipped 📦",
};

const HEADLINES: Record<ShipmentKind, string> = {
  all: "Your order is on its way.",
  part: "Part of your order is on its way.",
  rest: "The rest of your order is on its way.",
  replacement: "Your replacement is on its way.",
};

export const THANKS = "Thank you for supporting original art. Every piece is printed just for you, and we hope this one becomes a favorite.";
const PART_NOTE = "The rest of your order ships separately.";
const FIX = "Something not right? Send us a photo within 30 days and we'll replace it free.";

const itemLine = (i: DisplayItem) =>
  `${i.qty > 1 ? `${i.qty} x ` : ""}${i.title}${i.options ? ` (${i.options})` : ""}`;

export function shippedEmail(input: ShippedEmailInput): ShippedEmail {
  const { tracking, items, kind } = input;
  const greeting = greetingFor(input.name);
  const headline = HEADLINES[kind];
  const date = shortDate(input.shipDate);
  const carrier = tracking?.carrier;
  const shippedLine =
    date && carrier ? `It shipped ${date} with ${carrier}.` : date ? `It shipped ${date}.` : carrier ? `It's with ${carrier} now.` : "";
  const carrierLine = [carrier, tracking?.service].filter(Boolean).join(" · ");
  const orderNo = shortOrderNumber(input.orderRef);
  const boxLabel = kind === "all" ? "Your order" : "In this box";
  const preheader = tracking
    ? `${headline} Track it${carrier ? ` with ${carrier}` : ""}: ${tracking.number}`
    : headline;

  // ---- plain text ----
  const text = [
    greeting,
    "",
    [headline, shippedLine].filter(Boolean).join(" "),
    "",
    ...(tracking
      ? [
          `Track your package: ${tracking.url}`,
          ...(carrierLine ? [`Carrier: ${carrierLine}`] : []),
          `Tracking number: ${tracking.number}`,
          "",
        ]
      : []),
    `${boxLabel}:`,
    ...items.map((i) => `- ${itemLine(i)}`),
    ...(kind === "part" ? ["", PART_NOTE] : []),
    "",
    `Order ${orderNo}`,
    "",
    THANKS,
    "",
    REPLY,
    FIX,
    `Shipping & returns: ${SHIPPING_URL}`,
    "",
    ...textFooter(input.orderRef),
  ].join("\n");

  // ---- HTML ----
  const trackingBlock = tracking
    ? panelRow(`${carrierLine ? `<div style="font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};" class="mop-muted">Shipping with</div>
<div style="font-size:17px;line-height:24px;font-weight:700;color:${C.ink};padding:2px 0 16px 0;" class="mop-text">${esc(carrierLine)}</div>` : ""}
${ctaButton(tracking.url, "Track your package")}
<div style="font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};padding:18px 0 4px 0;" class="mop-muted">Tracking number</div>
<div style="font-family:${MONO};font-size:15px;line-height:22px;font-weight:700;letter-spacing:0.2px;color:${C.ink};word-break:break-all;" class="mop-text">${esc(groupTrackingNumber(tracking.number))}</div>`)
    : "";

  const html = emailDocument({
    title: SUBJECTS[kind],
    preheader,
    orderRef: input.orderRef,
    rows: [
      greetingRow(greeting),
      headlineRow(headline),
      shippedLine ? leadRow(shippedLine) : "",
      trackingBlock,
      sectionLabelRow(boxLabel),
      itemsRow(items),
      kind === "part" ? `<tr><td style="padding:0 0 4px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.muted};" class="mop-muted">${esc(PART_NOTE)}</td></tr>` : "",
      orderNumberRow(orderNo),
      ruleRow(),
      thanksRow(THANKS),
      replyRow(),
      helpRow(FIX),
    ],
  });

  return { subject: SUBJECTS[kind], html, text, preheader };
}
