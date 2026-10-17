// The customer's "your order has shipped" email: HTML + plain text.
//
// Email-client rules followed here: table layout, inline styles on everything,
// no external CSS or fonts (the site's Orbitron leads a web-safe stack, so it's
// used only where it's installed), images by absolute https URL, a fluid
// 600px column. The one <style> block only adds what clients that read it can
// use (phone padding, dark mode); the email reads the same without it.
// Dark mode: Apple Mail / Outlook.com use the dark styles below; the header
// band with the logo stays light everywhere (its text is dark), and Gmail's
// apps don't invert a background-image, so the band keeps a white gradient.
import { groupTrackingNumber, type Tracking } from "./tracking.ts";
import { LOGO_URL, SITE, type DisplayItem } from "./item-display.ts";

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

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "ANA maria" -> "Ana"; "" -> "". Names typed all in one case get a capital first letter. */
export function firstName(name: string) {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  return first === first.toUpperCase() || first === first.toLowerCase()
    ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
    : first;
}

/** "mop-0123456789abcdef0123456789r1" -> "MOP-01234567" (a hand re-placed "…r1" order keeps its original number). */
export const shortOrderNumber = (ref: string) => {
  const m = /^mop-([0-9a-z]+)$/i.exec(ref.trim());
  return m ? `MOP-${m[1].slice(0, 8).toUpperCase()}` : ref.trim();
};

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
const REPLY = "Questions? Just reply to this email.";
const FIX = "Something not right? Send us a photo within 30 days and we'll replace it free.";
const SHIPPING_URL = `${SITE}/shipping-returns`;

// Colours: the logo's orange disc (#ee7a30) and bow (#fa9215), the site's sky
// (#d5eaf0 → #bddae4 → #a9c8d2) and photo tile (#ecedee), the logo's #222 text.
// The button orange is a shade deeper than the disc so white text stays readable.
const C = {
  sky: "#bddae4",
  ink: "#222222",
  muted: "#4f646c",
  foot: "#38525c",
  card: "#ffffff",
  panel: "#f1f7f9",
  panelBorder: "#d6e6eb",
  rule: "#c9dde3",
  tile: "#ecedee",
  tileBorder: "#e2eaed",
  orange: "#ee7a30",
  bow: "#fa9215",
  button: "#d45d17",
  link: "#b84f0f",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "Orbitron,'Trebuchet MS','Segoe UI',Verdana,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

const itemLine = (i: DisplayItem) =>
  `${i.qty > 1 ? `${i.qty} x ` : ""}${i.title}${i.options ? ` (${i.options})` : ""}`;

export function shippedEmail(input: ShippedEmailInput): ShippedEmail {
  const { tracking, items, kind } = input;
  const hi = firstName(input.name);
  const greeting = hi ? `Hi ${hi},` : "Hi there,";
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
    "Modern Orange Pineapple · Morro Bay, CA",
    SITE,
    `Order ref: ${input.orderRef}`,
  ].join("\n");

  // ---- HTML ----
  const itemRows = items
    .map((i) => {
      const thumb = i.image
        ? `<img src="${esc(i.image)}" width="72" height="72" alt="${esc(i.title)}" style="display:block;width:70px;height:70px;border:1px solid ${C.tileBorder};border-radius:10px;background-color:${C.tile};" class="mop-tile">`
        : `<div style="width:70px;height:70px;border:1px solid ${C.tileBorder};border-radius:10px;background-color:${C.tile};" class="mop-tile"></div>`;
      return `<tr>
<td width="72" valign="top" style="padding:0 0 14px 0;width:72px;">${thumb}</td>
<td valign="middle" style="padding:0 0 14px 14px;font-family:${FONT};">
<div style="font-size:16px;line-height:22px;font-weight:700;color:${C.ink};" class="mop-text">${esc(i.title)}</div>
${i.options ? `<div style="font-size:14px;line-height:20px;color:${C.muted};" class="mop-muted">${esc(i.options)}</div>` : ""}
${i.qty > 1 ? `<div style="font-size:14px;line-height:20px;color:${C.muted};" class="mop-muted">Qty ${i.qty}</div>` : ""}
</td>
</tr>`;
    })
    .join("\n");

  const trackingBlock = tracking
    ? `<tr><td style="padding:22px 0 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.panel};border:1px solid ${C.panelBorder};border-radius:14px;" class="mop-panel">
<tr><td align="center" style="padding:20px 14px 22px 14px;font-family:${FONT};">
${carrierLine ? `<div style="font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};" class="mop-muted">Shipping with</div>
<div style="font-size:17px;line-height:24px;font-weight:700;color:${C.ink};padding:2px 0 16px 0;" class="mop-text">${esc(carrierLine)}</div>` : ""}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
<tr><td align="center" bgcolor="${C.button}" style="border-radius:12px;background-color:${C.button};background-image:linear-gradient(90deg,${C.button},#e2671f);box-shadow:0 3px 10px rgba(212,93,23,0.35);">
<a href="${esc(tracking.url)}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:${DISPLAY};font-size:18px;line-height:22px;font-weight:700;letter-spacing:0.5px;color:#ffffff;text-decoration:none;border-radius:12px;">Track your package</a>
</td></tr>
</table>
<div style="font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};padding:18px 0 4px 0;" class="mop-muted">Tracking number</div>
<div style="font-family:${MONO};font-size:15px;line-height:22px;font-weight:700;letter-spacing:0.2px;color:${C.ink};word-break:break-all;" class="mop-text">${esc(groupTrackingNumber(tracking.number))}</div>
</td></tr>
</table>
</td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(SUBJECTS[kind])}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (max-width: 620px) {
  .mop-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .mop-h1 { font-size: 23px !important; line-height: 30px !important; }
}
@media (prefers-color-scheme: dark) {
  .mop-bg { background-color: #0f2129 !important; background-image: none !important; }
  .mop-card { background-color: #15262e !important; }
  .mop-text { color: #eef3f5 !important; }
  .mop-muted { color: #a9bcc3 !important; }
  .mop-foot { color: #9fb3ba !important; }
  .mop-panel { background-color: #1b2f37 !important; border-color: #2b434d !important; }
  .mop-rule { border-color: #2b434d !important; }
  .mop-tile { background-color: #26393f !important; border-color: #2b434d !important; }
  .mop-link { color: #ffb36b !important; }
}
[data-ogsc] .mop-text { color: #eef3f5 !important; }
[data-ogsc] .mop-muted, [data-ogsc] .mop-foot { color: #a9bcc3 !important; }
[data-ogsc] .mop-link { color: #ffb36b !important; }
[data-ogsb] .mop-card { background-color: #15262e !important; }
[data-ogsb] .mop-panel { background-color: #1b2f37 !important; }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${C.sky};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;" class="mop-bg">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.sky};">${esc(preheader)}${"&#8199;&#65279;&#847; ".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.sky}" style="width:100%;background-color:${C.sky};background-image:linear-gradient(180deg,#d5eaf0,#bddae4 40%,#a9c8d2);" class="mop-bg">
<tr><td align="center" style="padding:28px 12px 32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

<tr><td align="center" bgcolor="#ffffff" style="padding:26px 24px 20px 24px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border-radius:18px 18px 0 0;">
<a href="${SITE}" target="_blank" style="text-decoration:none;"><img src="${LOGO_URL}" width="230" height="138" alt="MOP Clothing · mopclothing.com" style="display:block;width:230px;max-width:100%;height:auto;border:0;margin:0 auto;"></a>
<div style="font-family:${DISPLAY};font-size:12px;line-height:16px;letter-spacing:2px;color:#4f646c;padding:10px 0 0 0;font-style:italic;">Modern Orange Pineapple</div>
</td></tr>
<tr><td height="6" bgcolor="${C.orange}" style="height:6px;line-height:6px;font-size:6px;background-color:${C.orange};background-image:linear-gradient(90deg,${C.orange},${C.bow});">&nbsp;</td></tr>

<tr><td bgcolor="${C.card}" style="background-color:${C.card};border-radius:0 0 18px 18px;padding:30px 28px 32px 28px;" class="mop-card mop-pad">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font-family:${FONT};font-size:17px;line-height:24px;color:${C.ink};" class="mop-text">${esc(greeting)}</td></tr>
<tr><td style="padding:8px 0 0 0;font-family:${DISPLAY};font-size:26px;line-height:33px;font-weight:700;color:${C.ink};" class="mop-text mop-h1">${esc(headline)}</td></tr>
${shippedLine ? `<tr><td style="padding:8px 0 0 0;font-family:${FONT};font-size:16px;line-height:24px;color:${C.muted};" class="mop-muted">${esc(shippedLine)}</td></tr>` : ""}
${trackingBlock}
<tr><td style="padding:28px 0 12px 0;font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};" class="mop-muted">${esc(boxLabel)}</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${itemRows}
</table>
</td></tr>
${kind === "part" ? `<tr><td style="padding:0 0 4px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.muted};" class="mop-muted">${esc(PART_NOTE)}</td></tr>` : ""}
<tr><td style="padding:10px 0 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.muted};" class="mop-muted">Order <b style="color:${C.ink};font-family:${MONO};letter-spacing:0.5px;" class="mop-text">${esc(orderNo)}</b></td></tr>
<tr><td style="padding:24px 0 0 0;"><div style="height:0;border-top:2px dashed ${C.rule};font-size:0;line-height:0;" class="mop-rule">&nbsp;</div></td></tr>
<tr><td style="padding:22px 0 0 0;font-family:${FONT};font-size:16px;line-height:25px;color:${C.ink};" class="mop-text">${esc(THANKS)}</td></tr>
<tr><td style="padding:18px 0 0 0;font-family:${FONT};font-size:16px;line-height:24px;font-weight:700;color:${C.ink};" class="mop-text">${esc(REPLY)}</td></tr>
<tr><td style="padding:6px 0 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.muted};" class="mop-muted">${esc(FIX)} <a href="${SHIPPING_URL}" target="_blank" style="color:${C.link};text-decoration:underline;font-weight:700;white-space:nowrap;" class="mop-link">Shipping &amp; returns</a></td></tr>
</table>
</td></tr>

<tr><td align="center" style="padding:22px 16px 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.foot};" class="mop-foot">
Modern Orange Pineapple · Morro Bay, CA · <a href="${SITE}" target="_blank" style="color:${C.foot};text-decoration:underline;" class="mop-foot">mopclothing.com</a><br>
You're getting this email because you ordered from mopclothing.com.<br>
<span style="font-family:${MONO};font-size:11px;">Ref ${esc(input.orderRef)}</span>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: SUBJECTS[kind], html, text, preheader };
}
