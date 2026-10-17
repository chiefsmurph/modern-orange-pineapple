// Emails to customers, through Resend's HTTP API (POST https://api.resend.com/emails).
// PingPigeon (notify.ts) can only email John, so customers need a real sender.
//
//   MOP_RESEND_API_KEY   the key (re_…). Unset: nothing is sent, and the caller logs and skips.
//   MOP_EMAIL_FROM       default "MOP Clothing <orders@mopclothing.com>" (a domain verified in Resend).
//   MOP_EMAIL_REPLY_TO   default "orders@mopclothing.com".
//   MOP_EMAIL_DRY_RUN=1  log the email instead of sending it.
//
// Each send carries an Idempotency-Key (Resend keeps it 24 hours), so a retry
// after a lost response, ours or a webhook's, can't deliver the email twice.
import { isRetryable, requestJson, sleep, type FetchLike, type HttpResult } from "./http.ts";

export const RESEND_URL = "https://api.resend.com/emails";
export const DEFAULT_FROM = "MOP Clothing <orders@mopclothing.com>";
export const DEFAULT_REPLY_TO = "orders@mopclothing.com";

export type CustomerEmail = { to: string; subject: string; html: string; text: string };

/** ok: sent (or logged, dryRun). Not ok: `error`, whether a retry could help, and noKey when MOP_RESEND_API_KEY is unset. */
export type SendResult = { ok: boolean; id?: string; dryRun?: boolean; error?: string; retryable?: boolean; noKey?: boolean };

/** A plain, single address (no display name, no list). */
export const isEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(s.trim());

/** "ana@example.com" -> "a***@example.com", for logs. */
export const maskEmail = (s: string) => s.replace(/^(.)[^@]*@/, "$1***@");

const describe = (r: HttpResult) =>
  r.networkError ? r.networkError : `HTTP ${r.status}: ${r.json?.message ?? r.json?.error ?? r.text.slice(0, 200)}`;

export async function sendCustomerEmail(
  email: CustomerEmail,
  deps: {
    env: Record<string, string | undefined>;
    fetch: FetchLike;
    log: (msg: string) => void;
    /** Resend dedupes sends with the same key for 24 hours. */
    idempotencyKey?: string;
    retryDelayMs?: number;
    /** Log prefix (default "[shipping]"; the order confirmation uses "[confirm]"). */
    tag?: string;
  }
): Promise<SendResult> {
  const { env, log } = deps;
  const tag = deps.tag ?? "[shipping]";
  const from = env.MOP_EMAIL_FROM?.trim() || DEFAULT_FROM;
  const replyTo = env.MOP_EMAIL_REPLY_TO?.trim() || DEFAULT_REPLY_TO;
  if (!isEmail(email.to)) return { ok: false, error: "no valid customer email address", retryable: false };

  if (env.MOP_EMAIL_DRY_RUN === "1") {
    log(
      `${tag} DRY-RUN customer email (not sent)\nFrom: ${from}\nTo: ${email.to}\nReply-To: ${replyTo}\n` +
        `Subject: ${email.subject}\n\n${email.text}`
    );
    return { ok: true, dryRun: true };
  }
  const key = env.MOP_RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: "MOP_RESEND_API_KEY is not set", retryable: false, noKey: true };

  const send = () =>
    requestJson(deps.fetch, RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": "mopclothing-orders/1",
        ...(deps.idempotencyKey ? { "Idempotency-Key": deps.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from,
        to: [email.to.trim()],
        reply_to: replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

  let r = await send();
  if (!(r.ok && r.json?.id) && isRetryable(r)) {
    log(`${tag} Resend ${describe(r)}; retrying once`);
    await sleep(deps.retryDelayMs ?? 2000);
    r = await send();
  }
  if (r.ok && r.json?.id) return { ok: true, id: String(r.json.id) };
  // 409: Resend's idempotency conflicts (a concurrent request, or this key with another payload): a later try uses a new key.
  return { ok: false, error: `Resend ${describe(r)}`, retryable: isRetryable(r) || r.status === 409 };
}
