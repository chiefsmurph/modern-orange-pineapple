// Shirt ideas, the server side: POST /api/ideas (the /ideas form), John's review
// page (/moderate/ideas) and its actions (POST /api/ideas/admin), and the emails.
//
// - Honeypot + per-visitor rate limit (the salted in-memory IP hash the signup and
//   /custom use). The saved idea keeps only `ipHash`, an HMAC of the IP with
//   MOP_LINK_SECRET, so John can see that several ideas came from one sender;
//   the raw IP is never stored.
// - Saved to $MOP_DATA_DIR/ideas.jsonl (one line per idea) BEFORE John is emailed,
//   so a failed email never loses an idea. Every write rewrites the file to a temp
//   file and renames it over the old one (atomic), inside one queue per process.
// - Emails and payout handles are private: they live in ideas.jsonl and John's own
//   email/review page only. Logs carry the idea's id, never an address or a handle.
// - John's review page and its buttons use the same protection as the other
//   /moderate pages: links signed with MOP_LINK_SECRET (HMAC), a 404 without one.
// - The two emails to the sender (lib/ideas-email.ts) are OFF unless switched on:
//   MOP_IDEA_LIVE_EMAIL_ENABLED=1 / MOP_IDEA_DECLINE_EMAIL_ENABLED=1.
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROYALTY, TERMS_VERSION, cleanPayout, cleanProductUrl, validateIdea, type IdeaErrors, type IdeaInput, type IdeaStatus } from "./ideas.ts";
import { ideaDeclineEmail, ideaLiveEmail } from "./ideas-email.ts";
import { createEmailLedger, deliverOnce, type BaseLedgerRow, type DeliverStatus, type OnceDeps } from "./orders/email-once.ts";

export const IDEAS_FILE = "ideas.jsonl";
export const IDEA_EMAILS_FILE = "idea-emails.jsonl";
export const NOTES_MAX = 2000;

export type Idea = {
  id: string;
  createdAt: string;
  idea: string;
  name: string;
  email: string;
  /** Where to pay them (Venmo / Zelle): John records it on the review page once they reply. Private. */
  payout: string | null;
  /** HMAC of the sender's IP (never the IP itself). */
  ipHash: string;
  status: IdeaStatus;
  notes: string | null;
  productUrl: string | null;
  /** When the status last changed (approve / deny / launch). */
  decidedAt: string | null;
  /** Which terms they agreed to (TERMS_VERSION). */
  terms: string;
};

// --- store ------------------------------------------------------------------------------

export function createIdeaStore(dir: string) {
  const file = path.join(dir, IDEAS_FILE);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const readAll = async (): Promise<Idea[]> => {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return text.split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l) as Idea];
      } catch {
        return [];
      }
    });
  };
  /** The whole list to a temp file, flushed, then renamed over ideas.jsonl: never half-written. */
  const writeAll = async (all: Idea[]) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const fh = await fs.open(tmp, "w", 0o640);
    try {
      await fh.writeFile(all.map((x) => JSON.stringify(x) + "\n").join(""));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, file);
  };
  return {
    file,
    readAll: () => serial(readAll),
    get: (id: string) => serial(async () => (await readAll()).find((x) => x.id === id)),
    /** Adds the idea; `count` = how many ideas there are now. */
    add: (idea: Idea) =>
      serial(async () => {
        const all = await readAll();
        all.push(idea);
        await writeAll(all);
        return { count: all.length };
      }),
    /** Change one idea; returns it as saved (undefined: no such idea). */
    update: (id: string, change: (x: Idea) => Idea) =>
      serial(async () => {
        const all = await readAll();
        const i = all.findIndex((x) => x.id === id);
        if (i < 0) return undefined;
        all[i] = change(all[i]);
        await writeAll(all);
        return all[i];
      }),
    /** Deletes one idea (scripts/ideas-admin.mjs --delete, for test entries). */
    remove: (id: string) =>
      serial(async () => {
        const all = await readAll();
        const rest = all.filter((x) => x.id !== id);
        if (rest.length === all.length) return false;
        await writeAll(rest);
        return true;
      }),
  };
}

export type IdeaStore = ReturnType<typeof createIdeaStore>;

/** One idea store (one write queue) per data directory for the whole process. */
export const ideaStore = (dir: string): IdeaStore => {
  const g = globalThis as unknown as { __mopIdeas?: Map<string, IdeaStore> };
  g.__mopIdeas ??= new Map();
  let s = g.__mopIdeas.get(dir);
  if (!s) g.__mopIdeas.set(dir, (s = createIdeaStore(dir)));
  return s;
};

// --- signed links for John (his email, the review page, its buttons) ----------------------

export type IdeaAction = "approve" | "deny" | "launch" | "save";
export const IDEA_ACTIONS: IdeaAction[] = ["approve", "deny", "launch", "save"];

const hmac = (secret: string, what: string) => crypto.createHmac("sha256", secret).update(what).digest("hex").slice(0, 32);
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const ideasListSignature = (secret: string) => hmac(secret, "ideas:list");
export const ideaSignature = (id: string, action: IdeaAction, secret: string) => hmac(secret, `idea:${id}:${action}`);

export function verifyIdeasList(sig: string | null | undefined, secret: string | undefined) {
  if (!secret || !sig || !/^[0-9a-f]{32}$/.test(sig)) return false;
  return same(ideasListSignature(secret), sig);
}

export function verifyIdea(id: string, action: string, sig: string | null | undefined, secret: string | undefined) {
  if (!secret || !sig || !/^[0-9a-f]{32}$/.test(sig) || !/^[0-9a-f]{16}$/.test(id) || !IDEA_ACTIONS.includes(action as IdeaAction)) return false;
  return same(ideaSignature(id, action as IdeaAction, secret), sig);
}

/** John's review page, optionally filtered and scrolled to one idea. Null without MOP_LINK_SECRET. */
export function ideasAdminUrl(siteUrl: string, secret: string | undefined, { status, id, saved, email }: { status?: string; id?: string; saved?: string; email?: string } = {}) {
  if (!secret) return null;
  const u = new URL("/moderate/ideas", siteUrl.replace(/\/+$/, "") + "/");
  u.searchParams.set("sig", ideasListSignature(secret));
  if (status) u.searchParams.set("status", status);
  if (saved) u.searchParams.set("saved", saved);
  if (email) u.searchParams.set("email", email);
  if (id) u.hash = `idea-${id}`;
  return u.toString();
}

/** The sender's IP as stored: an HMAC with MOP_LINK_SECRET (stable), else a per-process salted hash. Never reversible. */
const processSalt = crypto.randomBytes(16).toString("hex");
export const hashIp = (ip: string, secret: string | undefined) =>
  secret ? hmac(secret, `idea-ip:${ip}`).slice(0, 16) : crypto.createHash("sha256").update(processSalt + ip).digest("hex").slice(0, 16);

/** Any email address in a log line -> "[address hidden]" (the idea logs never show one). */
export const hideAddresses = (msg: string) => msg.replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, "[address hidden]");

// --- the visitor's side: POST /api/ideas ---------------------------------------------------

export type SubmitDeps = {
  store: IdeaStore;
  allow: (ip: string) => boolean;
  now: () => Date;
  siteUrl: string;
  linkSecret?: string;
  /** Email John (PingPigeon, the order helper). */
  notify: (subject: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  log: (msg: string) => void;
};

export type SubmitResult = {
  status: number;
  body: { ok: boolean; error?: string; errors?: IdeaErrors };
  after?: () => Promise<void>;
};

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** John's email for a new idea: everything but the IP, with the link to review it. */
export function newIdeaEmail(x: Idea, count: number, deps: Pick<SubmitDeps, "siteUrl" | "linkSecret">) {
  const review = ideasAdminUrl(deps.siteUrl, deps.linkSecret, { status: "new", id: x.id });
  const when = new Date(x.createdAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
  const subject = `New shirt idea #${count} from ${oneLine(x.name, 40)}: ${oneLine(x.idea, 60)}`;
  const lines = [
    `${x.name} sent a shirt idea on mopclothing.com/ideas (${when} PT).`,
    "",
    "THE IDEA",
    x.idea,
    "",
    `From: ${x.name}`,
    `Email: ${x.email}`,
    `Agreed to the terms of ${x.terms} (their own idea; we can make and sell it; ${ROYALTY} a shirt if we make it).`,
    "",
    review ? `Approve, deny or mark it launched: ${review}` : "(Set MOP_LINK_SECRET to get the review link here.)",
    "",
    `Idea ${x.id}, saved in ${IDEAS_FILE}. Nothing is sent to them unless you switch the emails on.`,
  ];
  return { subject, body: lines.join("\n") };
}

export async function handleIdea(input: IdeaInput & { website?: string }, req: { ip: string }, deps: SubmitDeps): Promise<SubmitResult> {
  if (!deps.allow(req.ip)) return { status: 429, body: { ok: false, error: "Too many tries; please wait a few minutes." } };
  // honeypot: a normal-looking "thanks", nothing saved or sent
  if (typeof input.website === "string" && input.website.trim()) return { status: 200, body: { ok: true } };

  const { errors, value } = validateIdea(input);
  if (!value) return { status: 400, body: { ok: false, errors } };

  const idea: Idea = {
    id: crypto.randomBytes(8).toString("hex"),
    createdAt: deps.now().toISOString(),
    ...value,
    payout: null,
    ipHash: hashIp(req.ip, deps.linkSecret),
    status: "new",
    notes: null,
    productUrl: null,
    decidedAt: null,
    terms: TERMS_VERSION,
  };
  let count: number;
  try {
    ({ count } = await deps.store.add(idea));
  } catch (err) {
    deps.log(`[ideas] could not save idea ${idea.id}: ${(err as Error).message}`);
    return { status: 500, body: { ok: false, error: "Something went wrong saving your idea; please try again." } };
  }
  deps.log(`[ideas] idea ${idea.id} saved (#${count})`);
  const email = newIdeaEmail(idea, count, deps);
  return {
    status: 200,
    body: { ok: true },
    // after the response: the email helper retries once; a failure is logged (id only), the idea stays saved
    after: async () => {
      try {
        const r = await deps.notify(email.subject, email.body);
        if (!r.ok) deps.log(`[ideas] idea ${idea.id}: email to John failed (${r.error ?? "unknown"}); it's saved in ${IDEAS_FILE}`);
      } catch (err) {
        deps.log(`[ideas] idea ${idea.id}: email to John failed (${(err as Error).message}); it's saved in ${IDEAS_FILE}`);
      }
    },
  };
}

// --- the emails to the sender (off unless switched on) -----------------------------------

export const liveEmailEnabled = (env: Record<string, string | undefined>) => env.MOP_IDEA_LIVE_EMAIL_ENABLED?.trim() === "1";
export const declineEmailEnabled = (env: Record<string, string | undefined>) => env.MOP_IDEA_DECLINE_EMAIL_ENABLED?.trim() === "1";

export type IdeaEmailKind = "live" | "decline";
export type IdeaEmailRow = BaseLedgerRow & { idea_id: string; kind: IdeaEmailKind };
export const createIdeaEmailLedger = (dir: string) => createEmailLedger<IdeaEmailRow>(dir, IDEA_EMAILS_FILE);
export type IdeaEmailLedger = ReturnType<typeof createIdeaEmailLedger>;

const ledgers = new Map<string, IdeaEmailLedger>();
export const ideaEmailLedger = (dir: string) => {
  let l = ledgers.get(dir);
  if (!l) ledgers.set(dir, (l = createIdeaEmailLedger(dir)));
  return l;
};

/** "off": the switch isn't on, nothing sent. Else deliverOnce's outcome (emailed, duplicate, failed, …). */
export type EmailOutcome = DeliverStatus | "off";

const KIND = {
  live: { what: '"your idea is live" email', flag: "MOP_IDEA_LIVE_EMAIL_ENABLED", enabled: liveEmailEnabled },
  decline: { what: '"not this time" email', flag: "MOP_IDEA_DECLINE_EMAIL_ENABLED", enabled: declineEmailEnabled },
} as const;

/** One email to an idea's sender, at most once per idea and kind (idea-emails.jsonl + a Resend Idempotency-Key). */
export async function sendIdeaEmail(kind: IdeaEmailKind, x: Idea, deps: OnceDeps & { dir: string; ledger?: IdeaEmailLedger }): Promise<EmailOutcome> {
  const k = KIND[kind];
  const log = (m: string) => deps.log(hideAddresses(m));
  if (!k.enabled(deps.env)) {
    log(`[ideas] idea ${x.id}: the ${k.what} is off (${k.flag} is not 1); not sent`);
    return "off";
  }
  const ref = `idea-${x.id}`;
  const r = await deliverOnce<IdeaEmailRow>(
    {
      ledger: deps.ledger ?? ideaEmailLedger(deps.dir),
      row: { key: `idea-${kind}:${x.id}`, order_ref: ref, idea_id: x.id, kind, to: x.email },
      tag: "[ideas]",
      what: k.what,
      who: `idea ${x.id}`,
      to: x.email,
      noAddressError: "no valid email address on the idea",
      build: () =>
        kind === "live"
          ? ideaLiveEmail({ name: x.name, idea: x.idea, productUrl: x.productUrl ?? "", payoutOnFile: !!x.payout, ref })
          : ideaDeclineEmail({ name: x.name, idea: x.idea, ref }),
      idempotencyKey: `mop-idea-${kind}/${x.id}`,
      alert: (sent) => ({
        subject: `ACTION NEEDED: idea email failed for ${x.name}`,
        body: [
          `The ${k.what} to ${x.name} (${x.email}) didn't go out.`,
          "",
          `Why: ${sent.error}`,
          `Idea ${x.id}: ${oneLine(x.idea, 120)}`,
          "",
          "Press the button again on the review page to retry, or email them yourself.",
        ].join("\n"),
      }),
    },
    { ...deps, log }
  );
  return r.status;
}

// --- John's buttons: POST /api/ideas/admin -------------------------------------------------

export type AdminInput = { id?: string; action?: string; sig?: string; notes?: string; payout?: string; productUrl?: string; sendEmail?: string };

export type AdminDeps = OnceDeps & { store: IdeaStore; dir: string; linkSecret?: string; ledger?: IdeaEmailLedger };

export type AdminResult =
  | { status: 404 }
  | { status: 400; id: string; error: string }
  | { status: 200; idea: Idea; email?: EmailOutcome };

export async function handleIdeaAdmin(input: AdminInput, deps: AdminDeps): Promise<AdminResult> {
  const id = String(input.id ?? "");
  const action = String(input.action ?? "");
  if (!verifyIdea(id, action, input.sig, deps.linkSecret)) return { status: 404 };
  const at = deps.now().toISOString();

  if (action === "save") {
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, NOTES_MAX) || null : undefined;
    const payout = typeof input.payout === "string" ? cleanPayout(input.payout) : undefined;
    const x = await deps.store.update(id, (old) => ({ ...old, ...(notes !== undefined ? { notes } : {}), ...(payout !== undefined ? { payout } : {}) }));
    if (!x) return { status: 404 };
    deps.log(`[ideas] idea ${id}: notes saved`);
    return { status: 200, idea: x };
  }

  let productUrl: string | null = null;
  if (action === "launch") {
    productUrl = cleanProductUrl(input.productUrl);
    if (!productUrl) return { status: 400, id, error: "Add the shirt's page (a link starting https://) to mark it launched." };
  }
  const status: IdeaStatus = action === "approve" ? "approved" : action === "deny" ? "denied" : "launched";
  const x = await deps.store.update(id, (old) => ({
    ...old,
    status,
    decidedAt: old.status === status && old.decidedAt ? old.decidedAt : at,
    ...(productUrl ? { productUrl } : {}),
  }));
  if (!x) return { status: 404 };
  deps.log(`[ideas] idea ${id}: ${status}`);

  if (action === "launch") return { status: 200, idea: x, email: await sendIdeaEmail("live", x, deps) };
  if (action === "deny" && input.sendEmail === "1") return { status: 200, idea: x, email: await sendIdeaEmail("decline", x, deps) };
  return { status: 200, idea: x };
}
