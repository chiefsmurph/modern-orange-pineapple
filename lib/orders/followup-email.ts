// The two follow-up emails, HTML + plain text, built from the same pieces as the
// order confirmation and the shipped email (email-layout.ts: shell, header band,
// footer, colours, item rows, button), so all four read as one set:
//
//   fitEmail        "How's it fit?": a few days after the last package arrived
//                   (followups.ts decides when), asking for a photo for
//                   "Out in the wild" with a mailto: button to orders@.
//   beingMadeEmail  "Your Blue Sky Cotton Shorts are being made": Yoycol's
//                   made-to-order pieces, about 12–14 days in, if they haven't shipped.
//
// No prices and nobody else's name: these only greet the customer and show what
// they ordered.
import type { DisplayItem } from "./item-display.ts";
import { SITE } from "./item-display.ts";
import { DEFAULT_REPLY_TO } from "./customer-email.ts";
import {
  C,
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
  REPLY,
  ruleRow,
  sectionLabelRow,
  shortOrderNumber,
  textFooter,
  thanksRow,
} from "./email-layout.ts";

export type FollowupEmail = { subject: string; html: string; text: string; preheader: string };

/** Where customer photos go (the reply-to address too). */
export const PHOTO_TO = DEFAULT_REPLY_TO;
/** The home page's "Out in the wild" section. */
export const WILD_URL = `${SITE}/#out-in-the-wild`;

/** "My MOP photo, order MOP-B25662F9". */
export const photoSubject = (orderRef: string) => `My MOP photo, order ${shortOrderNumber(orderRef)}`;
/** mailto:orders@mopclothing.com?subject=My%20MOP%20photo%2C%20order%20MOP-B25662F9 */
export const photoMailto = (orderRef: string) => `mailto:${PHOTO_TO}?subject=${encodeURIComponent(photoSubject(orderRef))}`;

const units = (items: DisplayItem[]) => items.reduce((n, i) => n + (i.qty || 1), 0);

// ---- "How's it fit?" -------------------------------------------------------------

export type FitEmailInput = {
  /** The customer's full name (the email greets the first word). */
  name: string;
  orderRef: string;
  /** Everything in the order. */
  items: DisplayItem[];
  /** delivered: a carrier said it arrived. Otherwise it's an estimate ("should be with you"). */
  delivered: boolean;
};

export const FIX_LINE = "Something not right? Reply and we'll make it right.";
const FIX_HELP = "How replacements and returns work:";
const FIT_THANKS = "Thank you for supporting original art.";

export function fitEmail(input: FitEmailInput): FollowupEmail {
  const several = units(input.items) > 1;
  const subject = several ? "How's everything fit? 📸" : "How's it fit? 📸";
  const headline = several ? "How's everything fit?" : "How's it fit?";
  const arrived = input.delivered ? "Your MOP order arrived a few days ago." : "Your MOP order should be with you by now.";
  const lead = `${arrived} We hope ${several ? "everything fits" : "it fits"} just right and that you love ${several ? "it all" : "it"}.`;
  const ask = `Send us a photo of you wearing ${several ? "them" : "it"}.`;
  const feature = "We feature real customers in “Out in the wild” on mopclothing.com.";
  const orderNo = shortOrderNumber(input.orderRef);
  const greeting = greetingFor(input.name);
  const preheader = `We hope ${several ? "everything fits" : "it fits"} just right. Send us a photo for “Out in the wild” on mopclothing.com.`;

  const text = [
    greeting,
    "",
    `${headline} ${lead}`,
    "",
    "Your order:",
    ...input.items.map((i) => `- ${i.qty > 1 ? `${i.qty} x ` : ""}${i.title}${i.options ? ` (${i.options})` : ""}`),
    "",
    `${ask} ${feature}`,
    `Email it to ${PHOTO_TO} with the subject "${photoSubject(input.orderRef)}", or just reply with it.`,
    `Out in the wild: ${WILD_URL}`,
    "",
    `Order ${orderNo}`,
    "",
    FIT_THANKS,
    "",
    FIX_LINE,
    `${FIX_HELP} ${SHIPPING_URL}`,
    "",
    ...textFooter(input.orderRef),
  ].join("\n");

  const photoBlock = panelRow(`<div style="font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};" class="mop-muted">Out in the wild</div>
<div style="font-size:19px;line-height:26px;font-weight:700;color:${C.ink};padding:6px 0 4px 0;" class="mop-text">${esc(ask)}</div>
<div style="font-size:15px;line-height:22px;color:${C.muted};padding:0 0 18px 0;" class="mop-muted">We feature real customers in <a href="${WILD_URL}" target="_blank" style="color:${C.link};text-decoration:underline;font-weight:700;" class="mop-link">“Out in the wild”</a> on mopclothing.com.</div>
${ctaButton(photoMailto(input.orderRef), "Send us a photo", { newTab: false })}
<div style="font-size:14px;line-height:20px;color:${C.muted};padding:14px 0 0 0;" class="mop-muted">Or just reply to this email with it.</div>`);

  const html = emailDocument({
    title: subject,
    preheader,
    orderRef: input.orderRef,
    rows: [
      greetingRow(greeting),
      headlineRow(headline),
      leadRow(lead),
      photoBlock,
      sectionLabelRow("Your order"),
      itemsRow(input.items),
      orderNumberRow(orderNo),
      ruleRow(),
      thanksRow(FIT_THANKS),
      replyRow(FIX_LINE),
      helpRow(FIX_HELP),
    ],
  });
  return { subject, html, text, preheader };
}

// ---- "Your Blue Sky Cotton Shorts are being made" ---------------------------------------

export type BeingMadeEmailInput = {
  name: string;
  orderRef: string;
  /** Only the made-to-order (Yoycol) items. */
  items: DisplayItem[];
  /** "about 3–4 weeks": order to door (vendorDelivery.yoycol). */
  total: string;
};

/**
 * "Your Blue Sky Cotton Shorts are being made" / "Your Clouds In Sky Shirt is being made" /
 * "Your made-to-order pieces are being made". Plural when the name already is ("Shorts"),
 * there's more than one, or the items differ.
 */
export function beingMadeSubject(items: DisplayItem[]) {
  const titles = Array.from(new Set(items.map((i) => i.title)));
  if (titles.length !== 1) return { what: "made-to-order pieces", plural: true };
  const title = titles[0];
  const many = units(items) > 1;
  if (/s$/i.test(title)) return { what: title, plural: true };
  return many ? { what: `${title}s`, plural: true } : { what: title, plural: false };
}

const BEING_MADE_THANKS = "Thank you for supporting original art. We think they'll be worth the wait.";
const BEING_MADE_THANKS_ONE = "Thank you for supporting original art. We think it'll be worth the wait.";
const BEING_MADE_HELP = "How delivery and replacements work:";

export function beingMadeEmail(input: BeingMadeEmailInput): FollowupEmail {
  const { what, plural } = beingMadeSubject(input.items);
  const headline = `Your ${what} ${plural ? "are" : "is"} being made.`;
  const subject = `Your ${what} ${plural ? "are" : "is"} being made ☁️`;
  const they = plural ? "they" : "it";
  const lead = `A quick update: ${plural ? "they're" : "it's"} made to order, just for you, so ${they} take${plural ? "" : "s"} a little longer than a regular tee.`;
  const total = input.total.replace(/^about\s+/i, "");
  const totalLine = `About ${total} in total, from order to your door.`;
  const shipLine = `We'll email tracking as soon as ${they} ship${plural ? "" : "s"}.`;
  const thanks = plural ? BEING_MADE_THANKS : BEING_MADE_THANKS_ONE;
  const orderNo = shortOrderNumber(input.orderRef);
  const greeting = greetingFor(input.name);
  const preheader = `Made to order, about ${total} from order to door. ${shipLine}`;

  const text = [
    greeting,
    "",
    `${headline} ${lead}`,
    "",
    totalLine,
    shipLine,
    "",
    "Being made:",
    ...input.items.map((i) => `- ${i.qty > 1 ? `${i.qty} x ` : ""}${i.title}${i.options ? ` (${i.options})` : ""}`),
    "",
    `Order ${orderNo}`,
    "",
    thanks,
    "",
    REPLY,
    `${BEING_MADE_HELP} ${SHIPPING_URL}`,
    "",
    ...textFooter(input.orderRef),
  ].join("\n");

  const timeBlock = panelRow(`<div style="font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};" class="mop-muted">From order to your door</div>
<div style="font-size:19px;line-height:26px;font-weight:700;color:${C.ink};padding:6px 0 6px 0;" class="mop-text">About <span style="white-space:nowrap;">${esc(total)}</span> in total</div>
<div style="font-size:15px;line-height:22px;color:${C.muted};" class="mop-muted">${esc(shipLine)}</div>`);

  const html = emailDocument({
    title: subject,
    preheader,
    orderRef: input.orderRef,
    rows: [
      greetingRow(greeting),
      headlineRow(headline),
      leadRow(lead),
      timeBlock,
      sectionLabelRow("Being made"),
      itemsRow(input.items),
      orderNumberRow(orderNo),
      ruleRow(),
      thanksRow(thanks),
      replyRow(),
      helpRow(BEING_MADE_HELP),
    ],
  });
  return { subject, html, text, preheader };
}

