// The look shared by every customer email (shipped-email.ts, confirmation-email.ts):
// the document shell (head, dark-mode styles, preheader), the header band with
// the logo, the white card, the footer, and the rows both emails are built from
// (greeting, headline, item rows with thumbnails, order number, thanks, help).
// Change something here and both emails change together, so they stay one set.
//
// Email-client rules followed here: table layout, inline styles on everything,
// no external CSS or fonts (the site's Orbitron leads a web-safe stack, so it's
// used only where it's installed), images by absolute https URL, a fluid
// 600px column. The one <style> block only adds what clients that read it can
// use (phone padding, dark mode); the email reads the same without it.
// Dark mode: Apple Mail / Outlook.com use the dark styles below; the header
// band with the logo stays light everywhere (its text is dark), and Gmail's
// apps don't invert a background-image, so the band keeps a white gradient.
import { LOGO_URL, SITE, type DisplayItem } from "./item-display.ts";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "ANA maria" -> "Ana"; "" -> "". Names typed all in one case get a capital first letter. */
export function firstName(name: string) {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  return first === first.toUpperCase() || first === first.toLowerCase()
    ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
    : first;
}

/** "Hi Ana," or "Hi there,". */
export const greetingFor = (name: string) => {
  const hi = firstName(name);
  return hi ? `Hi ${hi},` : "Hi there,";
};

/** "mop-0123456789abcdef0123456789r1" -> "MOP-01234567" (a hand re-placed "…r1" order keeps its original number). */
export const shortOrderNumber = (ref: string) => {
  const m = /^mop-([0-9a-z]+)$/i.exec(ref.trim());
  return m ? `MOP-${m[1].slice(0, 8).toUpperCase()}` : ref.trim();
};

/** 2900 -> "$29.00" (cents, in the order's currency). */
export const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

export const REPLY = "Questions? Just reply to this email.";
export const SHIPPING_URL = `${SITE}/shipping-returns`;

// Colours: the logo's orange disc (#ee7a30) and bow (#fa9215), the site's sky
// (#d5eaf0 → #bddae4 → #a9c8d2) and photo tile (#ecedee), the logo's #222 text.
// The button orange is a shade deeper than the disc so white text stays readable.
export const C = {
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
export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const DISPLAY = "Orbitron,'Trebuchet MS','Segoe UI',Verdana,Arial,sans-serif";
export const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

// ---- rows inside the card (each one <tr>) ----

export const greetingRow = (greeting: string) =>
  `<tr><td style="font-family:${FONT};font-size:17px;line-height:24px;color:${C.ink};" class="mop-text">${esc(greeting)}</td></tr>`;

export const headlineRow = (headline: string) =>
  `<tr><td style="padding:8px 0 0 0;font-family:${DISPLAY};font-size:26px;line-height:33px;font-weight:700;color:${C.ink};" class="mop-text mop-h1">${esc(headline)}</td></tr>`;

/** The muted line under the headline. */
export const leadRow = (text: string) =>
  `<tr><td style="padding:8px 0 0 0;font-family:${FONT};font-size:16px;line-height:24px;color:${C.muted};" class="mop-muted">${esc(text)}</td></tr>`;

/** "YOUR ORDER", "IN THIS BOX", ...: the small uppercase label over a section. */
export const sectionLabelRow = (label: string, padding = "28px 0 12px 0") =>
  `<tr><td style="padding:${padding};font-family:${FONT};font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};" class="mop-muted">${esc(label)}</td></tr>`;

/** A light panel (the shipped email's tracking box, the confirmation's timeline). `inner` is raw HTML. */
export const panelRow = (inner: string, { align = "center", padding = "20px 14px 22px 14px" } = {}) =>
  `<tr><td style="padding:22px 0 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.panel};border:1px solid ${C.panelBorder};border-radius:14px;" class="mop-panel">
<tr><td align="${align}" style="padding:${padding};font-family:${FONT};">
${inner}
</td></tr>
</table>
</td></tr>`;

export type ItemRowOptions<T extends DisplayItem = DisplayItem> = {
  /** The muted line under the options. Default: "Qty 2" when more than one, else nothing. */
  qtyText?: (item: T) => string;
  /** A right-aligned amount for the row ("$29.00"); none = no price column. */
  price?: (item: T, index: number) => string | undefined;
};

/** One row per item: a 70px catalog thumbnail, the name, the options, the quantity (and a price). */
export function itemRows<T extends DisplayItem>(items: T[], { qtyText = (i) => (i.qty > 1 ? `Qty ${i.qty}` : ""), price }: ItemRowOptions<T> = {}) {
  return items
    .map((i, n) => {
      const thumb = i.image
        ? `<img src="${esc(i.image)}" width="72" height="72" alt="${esc(i.title)}" style="display:block;width:70px;height:70px;border:1px solid ${C.tileBorder};border-radius:10px;background-color:${C.tile};" class="mop-tile">`
        : `<div style="width:70px;height:70px;border:1px solid ${C.tileBorder};border-radius:10px;background-color:${C.tile};" class="mop-tile"></div>`;
      const qty = qtyText(i);
      const amount = price?.(i, n);
      return `<tr>
<td width="72" valign="top" style="padding:0 0 14px 0;width:72px;">${thumb}</td>
<td valign="middle" style="padding:0 0 14px 14px;font-family:${FONT};">
<div style="font-size:16px;line-height:22px;font-weight:700;color:${C.ink};" class="mop-text">${esc(i.title)}</div>
${i.options ? `<div style="font-size:14px;line-height:20px;color:${C.muted};" class="mop-muted">${esc(i.options)}</div>` : ""}
${qty ? `<div style="font-size:14px;line-height:20px;color:${C.muted};" class="mop-muted">${esc(qty)}</div>` : ""}
</td>${
        amount
          ? `\n<td valign="middle" align="right" style="padding:0 0 14px 12px;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:${C.ink};white-space:nowrap;" class="mop-text">${esc(amount)}</td>`
          : ""
      }
</tr>`;
    })
    .join("\n");
}

/** The items as a row of the card. */
export const itemsRow = <T extends DisplayItem>(items: T[], opts?: ItemRowOptions<T>) => `<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${itemRows(items, opts)}
</table>
</td></tr>`;

export const orderNumberRow = (orderNo: string) =>
  `<tr><td style="padding:10px 0 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.muted};" class="mop-muted">Order <b style="color:${C.ink};font-family:${MONO};letter-spacing:0.5px;" class="mop-text">${esc(orderNo)}</b></td></tr>`;

/** The dashed line before the sign-off. */
export const ruleRow = () =>
  `<tr><td style="padding:24px 0 0 0;"><div style="height:0;border-top:2px dashed ${C.rule};font-size:0;line-height:0;" class="mop-rule">&nbsp;</div></td></tr>`;

export const thanksRow = (text: string) =>
  `<tr><td style="padding:22px 0 0 0;font-family:${FONT};font-size:16px;line-height:25px;color:${C.ink};" class="mop-text">${esc(text)}</td></tr>`;

/** The bold line before the help link (default "Questions? Just reply to this email."). */
export const replyRow = (text = REPLY) =>
  `<tr><td style="padding:18px 0 0 0;font-family:${FONT};font-size:16px;line-height:24px;font-weight:700;color:${C.ink};" class="mop-text">${esc(text)}</td></tr>`;

/**
 * The orange button (the shipped email's "Track your package", the fit email's
 * "Send us a photo"), centred. `newTab: false` for a mailto: link, so webmail
 * doesn't open an empty tab.
 */
export const ctaButton = (href: string, label: string, { newTab = true }: { newTab?: boolean } = {}) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
<tr><td align="center" bgcolor="${C.button}" style="border-radius:12px;background-color:${C.button};background-image:linear-gradient(90deg,${C.button},#e2671f);box-shadow:0 3px 10px rgba(212,93,23,0.35);">
<a href="${esc(href)}"${newTab ? ` target="_blank"` : ""} style="display:inline-block;padding:15px 34px;font-family:${DISPLAY};font-size:18px;line-height:22px;font-weight:700;letter-spacing:0.5px;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(label)}</a>
</td></tr>
</table>`;

/** A muted line ending in the Shipping & returns link. */
export const helpRow = (lead: string) =>
  `<tr><td style="padding:6px 0 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.muted};" class="mop-muted">${esc(lead)} <a href="${SHIPPING_URL}" target="_blank" style="color:${C.link};text-decoration:underline;font-weight:700;white-space:nowrap;" class="mop-link">Shipping &amp; returns</a></td></tr>`;

// ---- the shell ----

/** The light band with the logo and the orange stripe under it. */
export const emailHeader = () => `<tr><td align="center" bgcolor="#ffffff" style="padding:26px 24px 20px 24px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border-radius:18px 18px 0 0;">
<a href="${SITE}" target="_blank" style="text-decoration:none;"><img src="${LOGO_URL}" width="230" height="138" alt="MOP Clothing · mopclothing.com" style="display:block;width:230px;max-width:100%;height:auto;border:0;margin:0 auto;"></a>
<div style="font-family:${DISPLAY};font-size:12px;line-height:16px;letter-spacing:2px;color:#4f646c;padding:10px 0 0 0;font-style:italic;">Modern Orange Pineapple</div>
</td></tr>
<tr><td height="6" bgcolor="${C.orange}" style="height:6px;line-height:6px;font-size:6px;background-color:${C.orange};background-image:linear-gradient(90deg,${C.orange},${C.bow});">&nbsp;</td></tr>`;

/** Under the card: who we are, why they got it, and the full order ref. */
export const emailFooter = (orderRef: string) => `<tr><td align="center" style="padding:22px 16px 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.foot};" class="mop-foot">
Modern Orange Pineapple · Morro Bay, CA · <a href="${SITE}" target="_blank" style="color:${C.foot};text-decoration:underline;" class="mop-foot">mopclothing.com</a><br>
You're getting this email because you ordered from mopclothing.com.<br>
<span style="font-family:${MONO};font-size:11px;">Ref ${esc(orderRef)}</span>
</td></tr>`;

/** The plain-text part's last lines. */
export const textFooter = (orderRef: string) => ["Modern Orange Pineapple · Morro Bay, CA", SITE, `Order ref: ${orderRef}`];

export const HEAD_STYLE = `<style>
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
</style>`;

/**
 * The whole HTML email: `rows` (the card's <tr>s, joined by newlines) inside the
 * shared head, header and footer. `title` is the subject; `preheader` is the
 * inbox preview line.
 */
export function emailDocument({ title, preheader, orderRef, rows }: { title: string; preheader: string; orderRef: string; rows: string[] }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
${HEAD_STYLE}
</head>
<body style="margin:0;padding:0;width:100%;background-color:${C.sky};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;" class="mop-bg">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.sky};">${esc(preheader)}${"&#8199;&#65279;&#847; ".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.sky}" style="width:100%;background-color:${C.sky};background-image:linear-gradient(180deg,#d5eaf0,#bddae4 40%,#a9c8d2);" class="mop-bg">
<tr><td align="center" style="padding:28px 12px 32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

${emailHeader()}

<tr><td bgcolor="${C.card}" style="background-color:${C.card};border-radius:0 0 18px 18px;padding:30px 28px 32px 28px;" class="mop-card mop-pad">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows.join("\n")}
</table>
</td></tr>

${emailFooter(orderRef)}

</table>
</td></tr>
</table>
</body>
</html>`;
}
