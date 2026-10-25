// Shirt ideas (/ideas): anyone sends a T-shirt idea as words, MOP makes the art.
// John approves or denies each one; an idea we make into a shirt earns its
// sender a royalty on every one sold.
//
// The form's fields, the terms and their checks, shared by the form (live
// messages) and the server (the same rules, re-checked). Pure: no Node or
// browser APIs, so both sides import it. The server side is lib/ideas-server.ts.
import { isEmail } from "./custom-request.ts";

export const IDEA_MAX = 1000;
export const IDEA_MIN = 5;
export const NAME_MAX = 100;
export const PAYOUT_MAX = 100;

/** The royalty on every shirt sold from an idea we make (the terms and the emails say it). */
export const ROYALTY = "$1.50";
/** When royalties are paid out. */
export const PAYOUT_MINIMUM = "$20";

export const PITCH = `Got a shirt idea? Send it. If we make it, you get ${ROYALTY} for every one sold.`;

/** Saved on each idea, so we know which wording its sender agreed to. Change it when TERMS change. */
export const TERMS_VERSION = "2026-10-25";

/** The terms shown above the checkbox, in plain English. */
export const TERMS: string[] = [
  "It's your own idea, with no logos, brands or characters from other companies.",
  "You let MOP Clothing make and sell shirts based on it.",
  "We may turn any idea down, and we may already be working on similar ideas. Credit and royalties apply only to ideas we approve and actually make.",
  `Royalty: ${ROYALTY} per shirt sold (on our website or our Etsy shop), paid monthly by Venmo or Zelle once you've earned ${PAYOUT_MINIMUM} or more.`,
  "We may stop the program at any time; royalties already earned are still paid.",
];

export type IdeaStatus = "new" | "approved" | "denied" | "launched";
export const STATUSES: IdeaStatus[] = ["new", "approved", "denied", "launched"];

export type IdeaInput = { idea?: string; name?: string; email?: string; agree?: boolean | string };
export type IdeaFields = { idea: string; name: string; email: string };
export type IdeaErrors = Partial<Record<"idea" | "name" | "email" | "agree", string>>;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Check a submission. Messages are written for the visitor; `value` is the clean idea when there are no errors. */
export function validateIdea(input: IdeaInput): { errors: IdeaErrors; value: IdeaFields | null } {
  const errors: IdeaErrors = {};

  // Not cut to length: the box stops at IDEA_MAX, so a longer one didn't come from the form.
  const idea = typeof input.idea === "string" ? input.idea.trim() : "";
  if (!idea) errors.idea = "Tell us your idea";
  else if (idea.length < IDEA_MIN) errors.idea = "Tell us a bit more";
  else if (idea.length > IDEA_MAX) errors.idea = "Please keep it under 1,000 characters";

  const name = str(input.name, NAME_MAX);
  if (!name) errors.name = "Add your name";

  const email = str(input.email, 254).toLowerCase();
  if (!email) errors.email = "Add your email so we can reach you";
  else if (!isEmail(email)) errors.email = "That email doesn't look right";

  if (!(input.agree === true || input.agree === "true" || input.agree === "on")) errors.agree = "Please agree to the terms";

  if (Object.keys(errors).length) return { errors, value: null };
  return { errors, value: { idea, name, email } };
}

/** John's note of where to pay a sender ("Venmo @ana-d", "Zelle 805…"): trimmed, one line, or null. */
export const cleanPayout = (v: unknown) => str(v, PAYOUT_MAX).replace(/\s+/g, " ") || null;

/** The product page John typed when marking an idea launched: an https link, or null. */
export function cleanProductUrl(v: unknown): string | null {
  const s = str(v, 500);
  if (!/^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/i.test(s)) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}
