// Old two-part card codes (COW-76) at /redeem: a claim John checks by hand.
//
// The saved list of printed codes (codes.json) was lost in an old deploy, so a
// code is claimable when it has the old card format (one of 9 animals, two
// digits from 2 3 6 7 8: only 225 codes, so easy to guess) OR is still on that
// list. That's why a claim needs a photo of the shirt or card, and John
// approves or rejects each one; nothing is paid or sent automatically.
// Each code can be claimed once (a rejected claim frees it again).
//
// Storage: $MOP_DATA_DIR/legacy-claims.jsonl, append-only (claims, then status
// changes), and the photos in $MOP_DATA_DIR/claim-uploads/. Never in the repo,
// so a deploy can't overwrite it. When John approves a code that is on
// codes.json, it's marked redeemed there too.
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ANIMALS, DIGITS } from "./item-codes.ts";
import { UPLOAD_MAX_BYTES, isEmail } from "./custom-request.ts";
import { sniffImage, type UploadIn } from "./custom-request-server.ts";

export const LEGACY_CLAIMS_FILE = "legacy-claims.jsonl";
export const CLAIM_UPLOADS_DIR = "claim-uploads";
export const CODES_JSON = "codes.json";

export type ClaimStatus = "pending" | "approved" | "rejected";

export type Claim = {
  id: string;
  code: string;
  /** Was the code on codes.json when it was claimed? */
  listed: boolean;
  name: string;
  fact: string | null;
  contact: string | null;
  photo: string;
  status: ClaimStatus;
  created_at: string;
  decided_at?: string | null;
};

type Row =
  | ({ type: "claim" } & Omit<Claim, "status" | "decided_at">)
  | { type: "status"; id: string; status: ClaimStatus; at: string };

const LEGACY_RE = new RegExp(`^(${ANIMALS.join("|")})-([${DIGITS}]{2})$`);
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "cow 76" / "COW76" -> "COW-76" when it has the old card format, else null. */
export function legacyFormat(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = squash(input);
  const m = /^([A-Z]{3})(\d{2})$/.exec(s);
  if (!m) return null;
  const code = `${m[1]}-${m[2]}`;
  return LEGACY_RE.test(code) ? code : null;
}

type CodesJsonEntry = { value: string; redeemed?: boolean; redeemedAt?: string | null; user?: unknown };

async function readCodesJson(dir: string): Promise<CodesJsonEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, CODES_JSON), "utf8"));
    return Array.isArray(parsed?.codes) ? parsed.codes : [];
  } catch {
    return [];
  }
}

/**
 * What the visitor typed -> the code as it's stored: the old card format, or a
 * code still on codes.json (any format), or null.
 */
export async function claimableCode(input: unknown, dir: string): Promise<{ code: string; listed: CodesJsonEntry | null } | null> {
  if (typeof input !== "string" || !input.trim() || input.length > 40) return null;
  const listed = (await readCodesJson(dir)).find((c) => typeof c.value === "string" && squash(c.value) === squash(input)) ?? null;
  if (listed) return { code: listed.value.toUpperCase(), listed };
  const code = legacyFormat(input);
  return code ? { code, listed: null } : null;
}

/** On approval: the code's codes.json entry (if any) is marked redeemed. */
export async function markRedeemedInCodesJson(dir: string, code: string, user: { name: string; fact: string }, at: string) {
  const file = path.join(dir, CODES_JSON);
  let data: { codes?: CodesJsonEntry[] };
  try {
    data = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return false;
  }
  const entry = (data.codes ?? []).find((c) => typeof c.value === "string" && squash(c.value) === squash(code));
  if (!entry || entry.redeemed) return false;
  entry.redeemed = true;
  entry.redeemedAt = at;
  entry.user = user;
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o640 });
  await fs.rename(tmp, file);
  return true;
}

export function createClaimStore(dir: string) {
  const file = path.join(dir, LEGACY_CLAIMS_FILE);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const readAll = async (): Promise<Claim[]> => {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const byId = new Map<string, Claim>();
    for (const line of text.split("\n")) {
      if (!line) continue;
      let r: Row;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (r.type === "claim") {
        const { type: _t, ...c } = r;
        byId.set(c.id, { ...c, status: "pending", decided_at: null });
      } else if (r.type === "status") {
        const c = byId.get(r.id);
        if (c) byId.set(r.id, { ...c, status: r.status, decided_at: r.at });
      }
    }
    return Array.from(byId.values());
  };
  const append = async (row: Row) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    await fs.appendFile(file, JSON.stringify(row) + "\n", { mode: 0o640 });
  };
  /** A pending or approved claim on this code, if any (a rejected one doesn't count). */
  const activeFor = (all: Claim[], code: string) => all.find((c) => c.code === code && c.status !== "rejected");
  return {
    readAll: () => serial(readAll),
    get: (id: string) => serial(async () => (await readAll()).find((c) => c.id === id)),
    activeFor: (code: string) => serial(async () => activeFor(await readAll(), code)),
    /** Adds the claim unless the code already has an active one (checked and written in one step). */
    add: (claim: Omit<Claim, "status" | "decided_at">) =>
      serial(async () => {
        if (activeFor(await readAll(), claim.code)) return false;
        await append({ type: "claim", ...claim });
        return true;
      }),
    setStatus: (id: string, status: ClaimStatus, at: string) =>
      serial(async () => {
        const c = (await readAll()).find((x) => x.id === id);
        if (!c) return undefined;
        if (c.status !== status) await append({ type: "status", id, status, at });
        return { ...c, status, decided_at: at };
      }),
  };
}

export type ClaimStore = ReturnType<typeof createClaimStore>;

// --- signed links for John (the email and the /moderate page) -------------------

export type ClaimAction = "view-claim" | "approve-claim" | "reject-claim";
export const CLAIM_ACTIONS: ClaimAction[] = ["view-claim", "approve-claim", "reject-claim"];

const hmac = (secret: string, what: string) => crypto.createHmac("sha256", secret).update(what).digest("hex").slice(0, 32);
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const claimSignature = (id: string, action: ClaimAction, secret: string) => hmac(secret, `legacy-claim:${id}:${action}`);
export const claimPhotoSignature = (id: string, secret: string) => hmac(secret, `legacy-claim-photo:${id}`);

export function verifyClaim(id: string, action: string, sig: string | null | undefined, secret: string | undefined) {
  if (!secret || !sig || !/^[0-9a-f]{32}$/.test(sig) || !/^[0-9a-f]{16}$/.test(id) || !CLAIM_ACTIONS.includes(action as ClaimAction)) return false;
  return same(claimSignature(id, action as ClaimAction, secret), sig);
}

export function verifyClaimPhoto(id: string, sig: string | null | undefined, secret: string | undefined) {
  if (!secret || !sig || !/^[0-9a-f]{32}$/.test(sig) || !/^[0-9a-f]{16}$/.test(id)) return false;
  return same(claimPhotoSignature(id, secret), sig);
}

// --- the visitor's side -------------------------------------------------------------

export type ClaimLookup = { status: "ok"; code: string } | { status: "claimed" } | { status: "invalid" } | { status: "limited" };

export const CLAIMED_MESSAGE = "This code has already been claimed. If that wasn't you, message us on Instagram.";

export async function lookupClaim(
  input: unknown,
  deps: { dir: string; claims: ClaimStore; allow: (ip: string) => boolean },
  ip: string
): Promise<ClaimLookup> {
  if (!deps.allow(ip)) return { status: "limited" };
  const hit = await claimableCode(input, deps.dir);
  if (!hit) return { status: "invalid" };
  if (hit.listed?.redeemed || (await deps.claims.activeFor(hit.code))) return { status: "claimed" };
  return { status: "ok", code: hit.code };
}

export type ClaimInput = { code?: string; name?: string; fact?: string; contact?: string; website?: string };
export type ClaimErrors = Partial<Record<"code" | "name" | "fact" | "contact" | "photo", string>>;

export type ClaimDeps = {
  dir: string;
  claims: ClaimStore;
  allow: (ip: string) => boolean;
  now: () => Date;
  notify: (subject: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  log: (msg: string) => void;
  siteUrl: string;
  linkSecret?: string;
};

export type ClaimResult = {
  status: number;
  body: { ok: boolean; error?: string; errors?: ClaimErrors; claimed?: boolean };
  after?: () => Promise<void>;
};

/** Email, or an Instagram handle (@name), or nothing. */
export function cleanContact(raw: string | undefined): { value: string | null; error?: string } {
  const s = (raw ?? "").trim();
  if (!s) return { value: null };
  if (s.includes("@") && s.indexOf("@") > 0) {
    const email = s.toLowerCase();
    return isEmail(email) ? { value: email } : { value: null, error: "That email doesn't look right" };
  }
  const handle = s.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/+$/, "");
  if (/^[A-Za-z0-9._]{1,30}$/.test(handle)) return { value: `@${handle}` };
  return { value: null, error: "Add an email or an Instagram handle (like @modernorangepineapple)" };
}

export async function handleClaim(input: ClaimInput, photo: UploadIn | null, ip: string, deps: ClaimDeps): Promise<ClaimResult> {
  if (!deps.allow(ip)) return { status: 429, body: { ok: false, error: "Too many tries; please wait a few minutes." } };
  if (input.website && input.website.trim()) return { status: 200, body: { ok: true } }; // honeypot

  const hit = await claimableCode(input.code, deps.dir);
  if (!hit) return { status: 400, body: { ok: false, errors: { code: "Invalid code." } } };
  if (hit.listed?.redeemed) return { status: 409, body: { ok: false, claimed: true, error: CLAIMED_MESSAGE } };

  const errors: ClaimErrors = {};
  const name = (input.name ?? "").trim().slice(0, 60);
  if (!name) errors.name = "Add your name";
  const fact = (input.fact ?? "").trim().slice(0, 300) || null;
  const contact = cleanContact(input.contact);
  if (contact.error) errors.contact = contact.error;

  let upload: { bytes: Uint8Array; ext: string } | null = null;
  if (!photo || photo.size === 0) errors.photo = "Add a photo of your shirt or card";
  else if (photo.size > UPLOAD_MAX_BYTES) errors.photo = "That photo is over 10 MB; try a smaller one";
  else {
    const bytes = await photo.bytes();
    const ext = sniffImage(bytes);
    if (!ext) errors.photo = "Photos only, please (JPG, PNG, WebP or HEIC)";
    else upload = { bytes, ext };
  }
  if (Object.keys(errors).length || !upload) return { status: 400, body: { ok: false, errors } };

  const id = crypto.randomBytes(8).toString("hex");
  const at = deps.now().toISOString();
  const photoFile = `${id}.${upload.ext}`;
  // the photo first, so a saved claim always has its photo
  await fs.mkdir(path.join(deps.dir, CLAIM_UPLOADS_DIR), { recursive: true, mode: 0o750 });
  await fs.writeFile(path.join(deps.dir, CLAIM_UPLOADS_DIR, photoFile), upload.bytes, { mode: 0o640 });
  const claim = { id, code: hit.code, listed: !!hit.listed, name, fact, contact: contact.value, photo: photoFile, created_at: at };
  const added = await deps.claims.add(claim);
  if (!added) {
    await fs.rm(path.join(deps.dir, CLAIM_UPLOADS_DIR, photoFile), { force: true });
    return { status: 409, body: { ok: false, claimed: true, error: CLAIMED_MESSAGE } };
  }
  deps.log(`[claim] ${id}: old card code claimed (pending)`);

  const email = claimEmail({ ...claim, status: "pending" }, deps);
  return {
    status: 200,
    body: { ok: true },
    after: async () => {
      try {
        const r = await deps.notify(email.subject, email.body);
        if (!r.ok) deps.log(`[claim] ${id}: email to John failed (${r.error ?? "unknown"})`);
      } catch (e) {
        deps.log(`[claim] ${id}: email to John failed (${(e as Error).message})`);
      }
    },
  };
}

export function claimLinks(id: string, siteUrl: string, secret: string | undefined) {
  if (!secret) return null;
  const site = siteUrl.replace(/\/+$/, "");
  const link = (action: ClaimAction) => `${site}/moderate/${id}?action=${action}&sig=${claimSignature(id, action, secret)}`;
  return {
    view: link("view-claim"),
    photo: `${site}/api/claim-photo/${id}?sig=${claimPhotoSignature(id, secret)}`,
  };
}

export function claimEmail(c: Claim, deps: Pick<ClaimDeps, "siteUrl" | "linkSecret">) {
  const links = claimLinks(c.id, deps.siteUrl, deps.linkSecret);
  const subject = `MOP old card claim: ${c.code} from ${c.name}`;
  const lines = [
    `${c.name} claimed the old card code ${c.code}.`,
    c.listed ? "It's on the saved list (codes.json)." : "It's not on the saved list (the list was lost), but it has the old card format.",
    "",
    `Fun fact: ${c.fact ?? "(none)"}`,
    `Contact: ${c.contact ?? "(none given)"}`,
    "",
    `PHOTO: ${links?.photo ?? `saved on the server as ${CLAIM_UPLOADS_DIR}/${c.photo}`}`,
    "",
    links ? `Check it and approve or reject: ${links.view}` : "(Set MOP_LINK_SECRET to get the approve/reject link here.)",
    "",
    "Approving only marks the claim approved. Nothing is paid or sent automatically: any reward is up to you.",
  ];
  return { subject, body: lines.join("\n") };
}

/** John's approve / reject (from the /moderate page). Approving also marks the code redeemed on codes.json. */
export async function decideClaim(id: string, action: "approve-claim" | "reject-claim", deps: { dir: string; claims: ClaimStore; now: () => Date }) {
  const at = deps.now().toISOString();
  const c = await deps.claims.setStatus(id, action === "approve-claim" ? "approved" : "rejected", at);
  if (c && c.status === "approved" && c.listed)
    await markRedeemedInCodesJson(deps.dir, c.code, { name: c.name, fact: c.fact ?? "" }, at).catch(() => false);
  return c;
}
