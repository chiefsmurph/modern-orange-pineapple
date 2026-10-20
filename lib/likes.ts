// "♡ I'd wear this": a like from anyone, no purchase needed (John, 2026-10-20).
// Not a review: verified buyers review from /register (lib/reviews.ts); this is
// one tap saying a design appeals, so John sees which designs and skies people like.
//
// - Stored in $MOP_DATA_DIR/likes.jsonl, one JSON line per tap:
//   { ts, slug, design, device, on, src, self, ua_hash }
//   design = the visual picks without size ("sky=aurora", "" for one-design products),
//   device = a hash of the random id the browser made for itself (localStorage
//   "mop-device"), src = the visit's utm_source ("direct" without one),
//   self = John's own browsers (opted out of stats with ?nostats).
//   No IP, email or account is stored.
// - The latest line per (device, slug, design) decides whether it's liked.
// - Crawler / headless user agents get a normal-looking answer and nothing is saved;
//   taps are rate limited on a salted, in-memory IP hash, like the signup form.
// - The public count = devices that like at least one design of the product, not
//   counting John's, shown only from LIKES_SHOW_MIN: "2 likes" sells nothing.
//   John sees every count: scripts/likes-summary.mjs.
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const LIKES_FILE = "likes.jsonl";
export const LIKES_SHOW_MIN = 10;

export type LikeRow = {
  ts: string;
  slug: string;
  design: string;
  device: string;
  on: boolean;
  src: string;
  self: boolean;
  ua_hash: string;
};

const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|phantom|selenium|puppeteer|playwright|python|curl|wget|httpclient|okhttp|go-http|java\/|scrapy|axios|node-fetch/i;

/** No user agent, or a crawler / headless browser / HTTP library. */
export const isBotUa = (ua: string | null | undefined) => !ua || BOT_UA.test(ua);

/** The visual picks without size, in a fixed order: "color=Ivory&style=beanie". */
export const designKey = (opts: Record<string, string | undefined>) =>
  Object.keys(opts)
    .filter((k) => k !== "size" && opts[k])
    .sort()
    .map((k) => `${k}=${opts[k]}`)
    .join("&");

const DEVICE_RE = /^[a-f0-9]{32}$/;

/** utm_source as sent ("popads", "ig"), else "direct". */
export const normalizeSrc = (raw: unknown) =>
  typeof raw === "string" && /^[a-z0-9_.-]{1,40}$/i.test(raw.trim()) ? raw.trim().toLowerCase() : "direct";

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

export function createLikeStore(dir: string) {
  const file = path.join(dir, LIKES_FILE);
  // (device|slug|design) -> liked, plus slug -> device -> liked designs, rebuilt from the file once
  let state: Map<string, LikeRow> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const load = async () => {
    if (state) return state;
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const s = new Map<string, LikeRow>();
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as LikeRow;
        s.set(`${r.device}|${r.slug}|${r.design}`, r);
      } catch {
        // a torn last line after a crash: skip it
      }
    }
    return (state = s);
  };
  const countFor = (s: Map<string, LikeRow>, slug: string) => {
    const devices = new Set<string>();
    for (const r of Array.from(s.values())) if (r.slug === slug && r.on && !r.self) devices.add(r.device);
    return devices.size;
  };
  return {
    /** Record a tap; returns the product's count after it. */
    tap(row: LikeRow): Promise<number> {
      return serial(async () => {
        const s = await load();
        const key = `${row.device}|${row.slug}|${row.design}`;
        if ((s.get(key)?.on ?? false) !== row.on) {
          await fs.mkdir(dir, { recursive: true, mode: 0o750 });
          await fs.appendFile(file, JSON.stringify(row) + "\n", { mode: 0o640 });
          s.set(key, row);
        }
        return countFor(s, row.slug);
      });
    },
    count: (slug: string) => serial(async () => countFor(await load(), slug)),
    /** Every current like (latest state per device and design), for the summary. */
    current: () => serial(async () => Array.from((await load()).values()).filter((r) => r.on)),
  };
}

/** The public number: null below LIKES_SHOW_MIN. */
export const shownCount = (n: number) => (n >= LIKES_SHOW_MIN ? n : null);

export type LikeDeps = {
  store: ReturnType<typeof createLikeStore>;
  allow: (ip: string) => boolean;
  /** A product's picker options (on sale only), or undefined when there's no such product. */
  optionsFor: (slug: string) => Record<string, string[] | undefined> | undefined;
  now: () => Date;
  log: (msg: string) => void;
};

export type LikeResult = { status: number; body: { ok: boolean; count?: number | null; error?: string } };

/** The POST /api/likes logic, independent of Next for testing. */
export async function handleLike(
  body: Record<string, unknown>,
  req: { ip: string; userAgent: string | null },
  deps: LikeDeps
): Promise<LikeResult> {
  if (!deps.allow(req.ip)) return { status: 429, body: { ok: false, error: "Too many taps, please wait a few minutes." } };
  const slug = typeof body.slug === "string" ? body.slug : "";
  const options = deps.optionsFor(slug);
  if (!options) return { status: 404, body: { ok: false, error: "no such product" } };
  if (isBotUa(req.userAgent)) return { status: 200, body: { ok: true, count: null } };
  const device = typeof body.device === "string" ? body.device : "";
  if (!DEVICE_RE.test(device)) return { status: 400, body: { ok: false, error: "invalid request" } };
  if (typeof body.on !== "boolean") return { status: 400, body: { ok: false, error: "invalid request" } };
  // Only the product's own visual picks, each one a value it sells now.
  const raw = typeof body.opts === "object" && body.opts ? (body.opts as Record<string, unknown>) : {};
  const opts: Record<string, string> = {};
  for (const [name, values] of Object.entries(options)) {
    if (name === "size" || !values || values.length < 2) continue;
    const v = raw[name];
    if (v === undefined) continue;
    const hit = typeof v === "string" ? values.find((x) => x.toLowerCase() === v.toLowerCase()) : undefined;
    if (!hit) return { status: 400, body: { ok: false, error: `invalid ${name}` } };
    opts[name] = hit;
  }
  const row: LikeRow = {
    ts: deps.now().toISOString(),
    slug,
    design: designKey(opts),
    device: hash(device),
    on: body.on,
    src: normalizeSrc(body.src),
    self: body.self === true,
    ua_hash: hash(req.userAgent ?? ""),
  };
  try {
    const n = await deps.store.tap(row);
    return { status: 200, body: { ok: true, count: shownCount(n) } };
  } catch (err) {
    deps.log(`[likes] could not save a tap (${slug}): ${(err as Error).message}`);
    return { status: 500, body: { ok: false, error: "Something went wrong, please try again." } };
  }
}

/** One like store per data directory for the whole process. */
export const likeStore = (dir: string) => {
  const g = globalThis as unknown as { __mopLikes?: Map<string, ReturnType<typeof createLikeStore>> };
  g.__mopLikes ??= new Map();
  let s = g.__mopLikes.get(dir);
  if (!s) g.__mopLikes.set(dir, (s = createLikeStore(dir)));
  return s;
};
