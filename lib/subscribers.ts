// "Get notified of new drops": the email list.
//
// - Stored in $MOP_DATA_DIR/subscribers.jsonl, one JSON line per new address:
//   { email, ts, source: "home" | "product:<slug>", ua_hash }.
// - Deduplicated case-insensitively. Raw IPs are never stored: the rate limit
//   keys on a salted hash kept in memory only. Addresses never go to logs.
// - A filled-in honeypot field gets a normal-looking "ok" and nothing is saved.
// - After a NEW signup, John gets a short PingPigeon email (never blocks or
//   fails the signup).
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const SUBSCRIBERS_FILE = "subscribers.jsonl";

export type Subscriber = { email: string; ts: string; source: string; ua_hash: string };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

/** Lower-cased, trimmed address, or null when it isn't one. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** "home", "product:<slug>" for a real product, else "other". */
export function normalizeSource(raw: unknown, productExists: (slug: string) => boolean): string {
  if (raw === "home") return "home";
  if (typeof raw === "string" && raw.startsWith("product:") && productExists(raw.slice(8))) return raw;
  return "other";
}

export const hashUa = (ua: string | null | undefined) =>
  crypto.createHash("sha256").update(ua ?? "").digest("hex").slice(0, 16);

/** A fixed-window limiter keyed on a salted hash (the salt lives in memory, so nothing is reversible later). */
export function createRateLimiter({ limit, windowMs, now = Date.now }: { limit: number; windowMs: number; now?: () => number }) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hits = new Map<string, { count: number; reset: number }>();
  return (ip: string) => {
    const key = crypto.createHash("sha256").update(salt + ip).digest("hex");
    const t = now();
    for (const [k, v] of Array.from(hits)) if (v.reset <= t) hits.delete(k); // keep the map small
    const e = hits.get(key) ?? { count: 0, reset: t + windowMs };
    e.count++;
    hits.set(key, e);
    return e.count <= limit;
  };
}

/** The visitor's IP from the proxy headers (Cloudflare, then nginx), for rate limiting only. */
export const clientIp = (h: { get(name: string): string | null }) =>
  h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

export function createSubscriberStore(dir: string) {
  const file = path.join(dir, SUBSCRIBERS_FILE);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const readAll = async (): Promise<Subscriber[]> => {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Subscriber];
        } catch {
          return [];
        }
      });
  };
  return {
    /** Add unless already there. `count` = how many unique addresses after this. */
    add(sub: Subscriber): Promise<{ added: boolean; count: number }> {
      return serial(async () => {
        const all = await readAll();
        const known = new Set(all.map((s) => s.email.toLowerCase()));
        if (known.has(sub.email.toLowerCase())) return { added: false, count: known.size };
        await fs.mkdir(dir, { recursive: true, mode: 0o750 });
        await fs.appendFile(file, JSON.stringify(sub) + "\n", { mode: 0o640 });
        return { added: true, count: known.size + 1 };
      });
    },
    readAll: () => serial(readAll),
  };
}

export type SubscribeDeps = {
  store: ReturnType<typeof createSubscriberStore>;
  allow: (ip: string) => boolean;
  productExists: (slug: string) => boolean;
  now: () => Date;
  /** Tell John (best effort; errors are swallowed by the caller of this result). */
  notify: (count: number, source: string) => Promise<unknown>;
  log: (msg: string) => void;
  /** First-order discount code to show after signing up (MOP_WELCOME_CODE); none = plain thanks. */
  welcomeCode?: string;
};

export type SubscribeResult = { status: number; body: { ok: boolean; error?: string; code?: string } };

/** The POST /api/subscribe logic, independent of Next for testing. */
export async function handleSubscribe(
  body: Record<string, unknown>,
  req: { ip: string; userAgent: string | null },
  deps: SubscribeDeps
): Promise<SubscribeResult & { after?: () => Promise<void> }> {
  if (!deps.allow(req.ip)) return { status: 429, body: { ok: false, error: "Too many tries, please wait a few minutes." } };
  // honeypot: humans never see or fill this field
  if (typeof body.website === "string" && body.website.trim() !== "") return { status: 200, body: { ok: true } };
  const email = normalizeEmail(body.email);
  if (!email) return { status: 400, body: { ok: false, error: "That doesn't look like an email address." } };
  const source = normalizeSource(body.source, deps.productExists);
  let result: { added: boolean; count: number };
  try {
    result = await deps.store.add({ email, ts: deps.now().toISOString(), source, ua_hash: hashUa(req.userAgent) });
  } catch (err) {
    deps.log(`[subscribe] could not save a signup (${source}): ${(err as Error).message}`);
    return { status: 500, body: { ok: false, error: "Something went wrong, please try again." } };
  }
  const ok = { ok: true, ...(deps.welcomeCode ? { code: deps.welcomeCode } : {}) };
  if (!result.added) return { status: 200, body: ok }; // same answer: don't reveal who's on the list
  deps.log(`[subscribe] new subscriber #${result.count} (${source})`);
  return {
    status: 200,
    body: ok,
    after: async () => {
      try {
        await deps.notify(result.count, source);
      } catch (err) {
        deps.log(`[subscribe] notify failed: ${(err as Error).message}`);
      }
    },
  };
}

/** CSV of the list (scripts/export-subscribers.mjs uses the same columns). */
export function subscribersCsv(subs: Subscriber[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const seen = new Set<string>();
  const rows = ["email,subscribed_at,source"];
  for (const s of subs) {
    const key = s.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([s.email, s.ts, s.source].map(esc).join(","));
  }
  return rows.join("\n") + "\n";
}
