// The two emails to an idea's sender (lib/ideas-server.ts sends them), HTML + plain
// text, built from the same pieces as the order emails (orders/email-layout.ts):
//
//   ideaLiveEmail     "Your idea is live": when John marks an idea launched, with the
//                     product link to share and the royalty line.
//   ideaDeclineEmail  "not this time": only when John denies an idea AND ticks
//                     "send the 'not this time' email".
//
// Both are OFF until John approves this exact wording (MOP_IDEA_LIVE_EMAIL_ENABLED,
// MOP_IDEA_DECLINE_EMAIL_ENABLED; DEPLOY.md "Shirt ideas"). Neither shows the
// sender's email or payout handle.
import { SITE } from "./orders/item-display.ts";
import {
  C,
  FONT,
  REPLY,
  ctaButton,
  emailDocument,
  esc,
  greetingFor,
  greetingRow,
  headlineRow,
  leadRow,
  panelRow,
  replyRow,
  ruleRow,
  sectionLabelRow,
  thanksRow,
} from "./orders/email-layout.ts";
import { PAYOUT_MINIMUM, ROYALTY } from "./ideas.ts";

export type IdeaEmail = { subject: string; html: string; text: string; preheader: string };

export const IDEAS_URL = `${SITE}/ideas`;
const WHY = "You're getting this email because you sent us a shirt idea at mopclothing.com/ideas.";
const QUOTE_MAX = 300;

/** The idea as the email quotes it: one paragraph, cut at 300 characters. */
export const quoteIdea = (idea: string) => {
  const s = idea.trim().replace(/\s+/g, " ");
  return s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX - 1).trimEnd()}…` : s;
};

const footerRow = (ref: string) => `<tr><td align="center" style="padding:22px 16px 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.foot};" class="mop-foot">
Modern Orange Pineapple · Morro Bay, CA · <a href="${SITE}" target="_blank" style="color:${C.foot};text-decoration:underline;" class="mop-foot">mopclothing.com</a><br>
${esc(WHY)}<br>
<span style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:11px;">Ref ${esc(ref)}</span>
</td></tr>`;

const textFooter = (ref: string) => ["Modern Orange Pineapple · Morro Bay, CA", SITE, WHY, `Ref: ${ref}`];

const quoteRow = (idea: string) =>
  `<tr><td style="padding:0 0 0 12px;border-left:3px solid ${C.orange};font-family:${FONT};font-size:16px;line-height:24px;font-style:italic;color:${C.ink};" class="mop-text">“${esc(quoteIdea(idea))}”</td></tr>`;

// ---- (b) "Your idea is live" -----------------------------------------------------------

export type LiveEmailInput = {
  /** The sender's name as typed (the email greets the first word). */
  name: string;
  idea: string;
  productUrl: string;
  /** Has John recorded where to pay them (Venmo / Zelle)? */
  payoutOnFile: boolean;
  /** "idea-<id>", in the footer. */
  ref: string;
};

export const LIVE_SUBJECT = "Your idea is live! 🎉";
export const LIVE_HEADLINE = "Your idea is live!";
export const LIVE_LEAD = "We made your idea into a shirt, and it's on sale now. Share it with anyone you like!";
export const ROYALTY_LINE = `Your royalty: ${ROYALTY} for every one sold, on our website or our Etsy shop. We pay monthly by Venmo or Zelle once you've earned ${PAYOUT_MINIMUM} or more.`;
export const PAYOUT_ASK = "Reply to this email with your Venmo or Zelle so we can pay you.";
export const PAYOUT_KNOWN = "We'll pay the Venmo or Zelle you sent us. To change it, just reply to this email.";
const LIVE_THANKS = "Thank you for the idea!";

export function ideaLiveEmail(input: LiveEmailInput): IdeaEmail {
  const greeting = greetingFor(input.name);
  const payoutLine = input.payoutOnFile ? PAYOUT_KNOWN : PAYOUT_ASK;
  const preheader = `Your idea is live: share it! You get ${ROYALTY} for every one sold.`;

  const text = [
    greeting,
    "",
    `Your idea is live: ${input.productUrl}`,
    LIVE_LEAD,
    "",
    "Your idea:",
    `“${quoteIdea(input.idea)}”`,
    "",
    ROYALTY_LINE,
    payoutLine,
    "",
    LIVE_THANKS,
    "",
    REPLY,
    "",
    ...textFooter(input.ref),
  ].join("\n");

  const royalty = panelRow(`<div style="font-size:12px;line-height:16px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};" class="mop-muted">Your royalty</div>
<div style="font-size:19px;line-height:26px;font-weight:700;color:${C.ink};padding:6px 0 6px 0;" class="mop-text">${esc(ROYALTY)} for every one sold</div>
<div style="font-size:15px;line-height:22px;color:${C.muted};" class="mop-muted">On our website or our Etsy shop. We pay monthly by Venmo or Zelle once you've earned ${esc(PAYOUT_MINIMUM)} or more.</div>
<div style="font-size:15px;line-height:22px;color:${C.ink};font-weight:700;padding:10px 0 0 0;" class="mop-text">${esc(payoutLine)}</div>`);

  const html = emailDocument({
    title: LIVE_SUBJECT,
    preheader,
    orderRef: input.ref,
    footer: footerRow(input.ref),
    rows: [
      greetingRow(greeting),
      headlineRow(LIVE_HEADLINE),
      leadRow(LIVE_LEAD),
      `<tr><td align="center" style="padding:24px 0 0 0;">${ctaButton(input.productUrl, "See your shirt")}</td></tr>`,
      `<tr><td align="center" style="padding:10px 0 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};word-break:break-all;" class="mop-muted"><a href="${esc(input.productUrl)}" target="_blank" style="color:${C.link};" class="mop-link">${esc(input.productUrl)}</a></td></tr>`,
      sectionLabelRow("Your idea"),
      quoteRow(input.idea),
      royalty,
      ruleRow(),
      thanksRow(LIVE_THANKS),
      replyRow(),
    ],
  });
  return { subject: LIVE_SUBJECT, html, text, preheader };
}

// ---- (c) "not this time" ---------------------------------------------------------------

export type DeclineEmailInput = { name: string; idea: string; ref: string };

export const DECLINE_SUBJECT = "About your MOP shirt idea";
export const DECLINE_HEADLINE = "Thanks for your idea";
export const DECLINE_LEAD = "We've decided not to make this one, so it won't become a shirt this time.";
export const DECLINE_MORE = "We read every idea, and you're welcome to send more any time.";
const DECLINE_THANKS = "Thanks again for thinking of us.";

export function ideaDeclineEmail(input: DeclineEmailInput): IdeaEmail {
  const greeting = greetingFor(input.name);
  const preheader = DECLINE_LEAD;
  const text = [
    greeting,
    "",
    `Thank you for sending us your shirt idea. ${DECLINE_LEAD}`,
    "",
    "Your idea:",
    `“${quoteIdea(input.idea)}”`,
    "",
    DECLINE_MORE,
    `Send another idea: ${IDEAS_URL}`,
    "",
    DECLINE_THANKS,
    "",
    REPLY,
    "",
    ...textFooter(input.ref),
  ].join("\n");

  const html = emailDocument({
    title: DECLINE_SUBJECT,
    preheader,
    orderRef: input.ref,
    footer: footerRow(input.ref),
    rows: [
      greetingRow(greeting),
      headlineRow(DECLINE_HEADLINE),
      leadRow(`Thank you for sending us your shirt idea. ${DECLINE_LEAD}`),
      sectionLabelRow("Your idea"),
      quoteRow(input.idea),
      panelRow(`<div style="font-size:15px;line-height:22px;color:${C.muted};padding:0 0 16px 0;" class="mop-muted">${esc(DECLINE_MORE)}</div>
${ctaButton(IDEAS_URL, "Send another idea")}`),
      ruleRow(),
      thanksRow(DECLINE_THANKS),
      replyRow(),
    ],
  });
  return { subject: DECLINE_SUBJECT, html, text, preheader };
}
