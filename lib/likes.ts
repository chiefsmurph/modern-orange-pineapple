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
// - A NEW like from a real person (not a bot, not John, not an un-like) emails John with the shirt,
//   the design and the visitor's city from Cloudflare's location headers (John 10/21), at most
//   LIKE_EMAILS_PER_DAY a day. The row keeps the city, region and country; never the IP.
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { withoutAddedDefaults } from "./catalog/added.ts";

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
  /** From Cloudflare's visitor location headers; absent when Cloudflare didn't send them. */
  city?: string;
  region?: string;
  country?: string;
};

export const LIKE_EMAILS_PER_DAY = 25;

const header = (h: { get(name: string): string | null }, name: string) => {
  const raw = h.get(name)?.trim();
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw).slice(0, 60);
  } catch {
    return raw.slice(0, 60);
  }
};

/** The visitor's city, region and country from Cloudflare ("Add visitor location headers"); XX/T1 = unknown/Tor. */
export function geoFrom(h: { get(name: string): string | null }) {
  const country = header(h, "cf-ipcountry");
  return {
    city: header(h, "cf-ipcity"),
    region: header(h, "cf-region") ?? header(h, "cf-region-code"),
    country: country && !["XX", "T1"].includes(country.toUpperCase()) ? country.toUpperCase() : undefined,
  };
}

/** "Glendale, California, US", or null when nothing is known. */
export const placeOf = (g: { city?: string; region?: string; country?: string }) =>
  [g.city, g.region, g.country].filter(Boolean).join(", ") || null;

/** At most `limit` sends per Pacific day (in memory, so a restart starts the day over). */
export function createDailyCap(limit: number, now: () => Date = () => new Date()) {
  let day = "";
  let n = 0;
  return () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now());
    if (today !== day) {
      day = today;
      n = 0;
    }
    if (n >= limit) return false;
    n++;
    return true;
  };
}

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
    /** Record a tap; returns the product's count after it and whether this changed anything. */
    tap(row: LikeRow): Promise<{ count: number; changed: boolean }> {
      return serial(async () => {
        const s = await load();
        const key = `${row.device}|${row.slug}|${row.design}`;
        const changed = (s.get(key)?.on ?? false) !== row.on;
        if (changed) {
          await fs.mkdir(dir, { recursive: true, mode: 0o750 });
          await fs.appendFile(file, JSON.stringify(row) + "\n", { mode: 0o640 });
          s.set(key, row);
        }
        return { count: countFor(s, row.slug), changed };
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
  /** Tell John about a NEW like from a real person (best effort; runs after the response). */
  notify?: (row: LikeRow, count: number) => Promise<unknown>;
};

export type LikeResult = {
  status: number;
  body: { ok: boolean; count?: number | null; error?: string };
  /** The email to John, to run after the response so it never slows or fails the tap. */
  after?: () => Promise<void>;
};

/** The POST /api/likes logic, independent of Next for testing. */
export async function handleLike(
  body: Record<string, unknown>,
  req: { ip: string; userAgent: string | null; geo?: { city?: string; region?: string; country?: string } },
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
    // the star before its Bolt existed and the star now are the same design (lib/catalog/added.ts)
    design: designKey(withoutAddedDefaults(slug, opts)),
    device: hash(device),
    on: body.on,
    src: normalizeSrc(body.src),
    self: body.self === true,
    ua_hash: hash(req.userAgent ?? ""),
    ...(req.geo?.city && { city: req.geo.city }),
    ...(req.geo?.region && { region: req.geo.region }),
    ...(req.geo?.country && { country: req.geo.country }),
  };
  try {
    const { count, changed } = await deps.store.tap(row);
    const result: LikeResult = { status: 200, body: { ok: true, count: shownCount(count) } };
    if (changed && row.on && !row.self && deps.notify) {
      const notify = deps.notify;
      result.after = async () => {
        try {
          await notify(row, count);
        } catch (err) {
          deps.log(`[likes] notify failed: ${(err as Error).message}`);
        }
      };
    }
    return result;
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

/** The email to John for one new like: shirt, design, where the person is and where the visit came from. */
export function likeEmail(
  row: LikeRow,
  info: { title: string; designLabel?: string; count: number; url: string }
): { subject: string; body: string; html: string } {
  const what = info.designLabel ? `${info.title} · ${info.designLabel}` : info.title;
  const place = placeOf(row);
  const src = row.src === "direct" ? "a direct visit" : row.src;
  const subject = `♥ New like: ${what}${place ? ` (${place})` : ""}`;
  const lines = [
    `Someone tapped "I'd wear this" on the ${what}.`,
    "",
    `Where: ${place ?? "unknown (no location from Cloudflare)"}`,
    `Came from: ${src}`,
    `People who like the ${info.title} now: ${info.count}`,
    "",
    info.url,
  ];
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font:15px/1.5 -apple-system,system-ui,sans-serif;color:#111;max-width:560px">
<p style="font-size:18px;margin:0 0 8px">♥ <b>${esc(what)}</b></p>
<p style="margin:0 0 4px">Where: <b>${esc(place ?? "unknown")}</b></p>
<p style="margin:0 0 4px;color:#555">Came from: ${esc(src)} · people who like the ${esc(info.title)} now: ${info.count}</p>
<p style="margin:10px 0 0"><a href="${esc(info.url)}">${esc(info.url)}</a></p></div>`;
  return { subject, body: lines.join("\n"), html };
}
