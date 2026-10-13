// Shared wiring for the /register and moderation routes (server only).
import { dataDir } from "./orders/store";
import { itemCodeStore } from "./item-codes";
import { reviewStore } from "./reviews";
import { createRateLimiter, subscriberStore, hashUa } from "./subscribers";
import { sendEmail } from "./orders/notify";

export const siteUrl = () => process.env.MOP_SITE_URL || "https://mopclothing.com";
export const linkSecret = () => process.env.MOP_LINK_SECRET || undefined;

// lookups: 10 per 10 min per visitor (codes are hard to guess, this keeps it that way)
export const allowLookup = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
export const allowRegister = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });

export const stores = () => {
  const dir = dataDir();
  return { dir, codes: itemCodeStore(dir), reviews: reviewStore(dir), subscribers: subscriberStore(dir) };
};

/** Email John via PingPigeon without ever echoing the contents (ORDER_DRY_RUN would print them). */
export const notifyJohn = (subject: string, body: string) =>
  sendEmail(
    { subject, body, html: "" },
    {
      env: process.env,
      fetch: (u, i) => fetch(u, i),
      log: (m) => console.log(m.includes("DRY-RUN email") ? "[register] DRY-RUN: email to John not sent (contents not logged)" : m.split("\n")[0]),
    }
  );

export { hashUa };
