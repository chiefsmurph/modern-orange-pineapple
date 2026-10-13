#!/usr/bin/env node
// "MOP weekly": a Monday-morning scorecard email for the last 7 days vs the 7
// before (Pacific time, whole days): visitors and where they came from, top
// pages and Umami events (read straight from Umami's Postgres, read-only), plus
// orders, signups, registrations and custom requests from $MOP_DATA_DIR.
// Sent to John through PingPigeon (PINGPIGEON_URL, PINGPIGEON_TOKEN).
//
//   node --env-file=/srv/mopclothing/.env scripts/weekly-scorecard.mjs        # last 7 days, email
//   node scripts/weekly-scorecard.mjs --dry-run                              # print only
//   --end 2026-10-12       the week ends at that day's midnight PT (default: today's)
//   --fixture file.json    Umami rows from a file instead of the database (tests, trying it out)
//   --include-test         also count Stripe test-mode orders (skipped by default)
//
// MOP_UMAMI_DB_URL is a read-only Postgres user on Umami's database (DEPLOY.md).
// Queries only the columns Umami v2 and v3 share (website_event, session, event_data).
import fs from "node:fs";
import path from "node:path";

export const WEBSITE_ID = "ba4cac44-a005-45f5-8d24-3b897178364c";
export const TZ = "America/Los_Angeles";
const SITE_HOST = "mopclothing.com";

// --- dates ---------------------------------------------------------------

const ymdOf = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);

const ptHourMinute = (date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);

/** The instant of 00:00 Pacific on a YYYY-MM-DD (DST-aware: 07:00 or 08:00 UTC). */
export function ptMidnight(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  for (const offset of [7, 8]) {
    const t = new Date(Date.UTC(y, m - 1, d, offset));
    if (ymdOf(t) === ymd && ptHourMinute(t) === "00:00") return t;
  }
  throw new Error(`no Pacific midnight for ${ymd}`);
}

/** YYYY-MM-DD plus n calendar days. */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/**
 * The last 7 whole days (Pacific) before `endYmd`'s midnight, and the 7 before
 * those. Run Monday morning: Monday to Sunday of last week vs the week before.
 */
export function weekWindows(now = new Date(), endYmd = ymdOf(now)) {
  const days = (start) => ({ startYmd: start, lastYmd: addDays(start, 6), start: ptMidnight(start), end: ptMidnight(addDays(start, 7)) });
  return { cur: days(addDays(endYmd, -7)), prev: days(addDays(endYmd, -14)) };
}

const inWindow = (w, at) => {
  const t = at instanceof Date ? at.getTime() : Date.parse(at);
  return Number.isFinite(t) && t >= w.start.getTime() && t < w.end.getTime();
};

const shortDay = (ymd) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const range = (w) => `${shortDay(w.startYmd)} – ${shortDay(w.lastYmd)}`;

// --- sources -------------------------------------------------------------

/** In the email's order. */
export const BUCKETS = ["Google Shopping", "Google search", "Instagram", "Facebook", "Old cards", "Direct/none", "Other referrers"];

const host = (d) => String(d ?? "").trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
const isGoogle = (d) => /(^|\.)google\.[a-z.]{2,6}$/.test(d) || d === "com.google.android.googlequicksearchbox" || d === "com.google.android.gm";
const isInstagram = (d) => d === "instagram.com" || d.endsWith(".instagram.com") || d === "com.instagram.android";
const isFacebook = (d) =>
  d === "facebook.com" || d.endsWith(".facebook.com") || d === "fb.me" || d === "fb.com" || d === "com.facebook.katana" || d === "com.facebook.orca";

/**
 * Where a visit came from, from its landing page view (Umami's url_query and
 * referrer_domain). Feed links are tagged (Google: utm_medium=shopping; Meta:
 * utm_source=meta, which can't say Facebook or Instagram, so an Instagram
 * referrer wins); our own links carry ?ref=ig / ?ref=card.
 */
export function sourceOf({ url_query, referrer_domain }) {
  const q = new URLSearchParams(String(url_query ?? "").replace(/^\?/, ""));
  const p = (k) => (q.get(k) ?? "").trim().toLowerCase();
  const ref = host(referrer_domain);
  if (p("utm_medium") === "shopping" || ref === "shopping.google.com") return { bucket: "Google Shopping" };
  if (p("ref") === "card") return { bucket: "Old cards" };
  if (isInstagram(ref) || p("ref") === "ig" || ["instagram", "ig"].includes(p("utm_source"))) return { bucket: "Instagram" };
  if (isFacebook(ref) || ["meta", "facebook", "fb"].includes(p("utm_source"))) return { bucket: "Facebook" };
  if (isGoogle(ref)) return { bucket: "Google search" };
  if (!ref || ref === SITE_HOST || ref.endsWith(`.${SITE_HOST}`)) return { bucket: "Direct/none" };
  return { bucket: "Other referrers", domain: ref };
}

// --- Umami rows -> numbers -------------------------------------------------

/**
 * Meta's catalog-review crawler (seen 10/12, the night the Meta Shop was set up:
 * ~250 "visitors" in 25 minutes): one page view per session, a feed variant link
 * (?color=…&size=…) with fbclid, referred by facebook.com, from desktop Windows
 * (Chrome/Firefox; US, IE, SE). Real Facebook and Instagram visitors are mostly
 * on phones, and come from l.facebook.com / l.instagram.com.
 */
const FEED_VARIANT_PARAMS = ["size", "color", "sky", "style", "print"];
export function isMetaCatalogCrawler(session) {
  if (session.views.length > 1) return false;
  const v = session.views[0];
  const ref = host(v.referrer_domain);
  if (ref !== "facebook.com" && ref !== "m.facebook.com") return false;
  const q = new URLSearchParams(String(v.url_query ?? "").replace(/^\?/, ""));
  if (!q.get("fbclid") || !FEED_VARIANT_PARAMS.some((k) => q.has(k))) return false;
  return String(session.device ?? "").toLowerCase() === "desktop" && /^windows/i.test(String(session.os ?? ""));
}

/**
 * rows: { views: [{ session_id, created_at, url_path, url_query, referrer_domain, country, device, os }],
 *         events: [{ session_id, created_at, event_name, data: { key: value } }] }
 * Sessions that look like bots are left out and counted: Meta's catalog crawler
 * (isMetaCatalogCrawler), a single page view from China (crawlers), or several
 * page views all within the same second.
 */
export function analyzeTraffic(rows, w) {
  const views = (rows.views ?? []).filter((v) => inWindow(w, v.created_at)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const bySession = new Map();
  for (const v of views) {
    const s = bySession.get(v.session_id) ?? { views: [], country: v.country ?? null, device: v.device ?? null, os: v.os ?? null };
    s.views.push(v);
    bySession.set(v.session_id, s);
  }
  const bots = { metaCrawler: 0, cnSingle: 0, instant: 0 };
  const human = new Map();
  for (const [id, s] of bySession) {
    const first = Date.parse(s.views[0].created_at);
    const last = Date.parse(s.views[s.views.length - 1].created_at);
    if (isMetaCatalogCrawler(s)) bots.metaCrawler++;
    else if ((s.country ?? "").toUpperCase() === "CN" && s.views.length === 1) bots.cnSingle++;
    else if (s.views.length >= 2 && Math.floor(last / 1000) === Math.floor(first / 1000)) bots.instant++;
    else human.set(id, s);
  }

  const sources = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  const otherDomains = new Map();
  const pages = new Map();
  let pageviews = 0;
  for (const s of human.values()) {
    const src = sourceOf(s.views[0]);
    sources[src.bucket]++;
    if (src.domain) otherDomains.set(src.domain, (otherDomains.get(src.domain) ?? 0) + 1);
    for (const v of s.views) {
      pageviews++;
      const page = pages.get(v.url_path) ?? { path: v.url_path, views: 0, visitors: new Set() };
      page.views++;
      page.visitors.add(v.session_id);
      pages.set(v.url_path, page);
    }
  }

  // Events from bot sessions go too; server-sent events (meta-checkout) have no page view, so they're kept.
  const botIds = new Set([...bySession.keys()].filter((id) => !human.has(id)));
  const events = (rows.events ?? []).filter((e) => inWindow(w, e.created_at) && !botIds.has(e.session_id));
  const count = (name) => events.filter((e) => e.event_name === name).length;
  const by = (name, key) => {
    const m = new Map();
    for (const e of events) if (e.event_name === name) {
      const k = String(e.data?.[key] ?? "unknown");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  return {
    visitors: human.size,
    pageviews,
    bots,
    sources,
    otherTop: [...otherDomains].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3),
    topPages: [...pages.values()]
      .map((p) => ({ path: p.path, views: p.views, visitors: p.visitors.size }))
      .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
      .slice(0, 5),
    events: {
      buyClick: count("buy-click"),
      buyClickTop: by("buy-click", "slug").slice(0, 5),
      signup: count("signup"),
      customRequest: count("custom-request"),
      galleryOpen: count("gallery-open"),
      register: count("register"),
      metaCheckout: count("meta-checkout"),
      metaCheckoutByOrigin: by("meta-checkout", "origin"),
    },
  };
}

// --- the data dir ------------------------------------------------------------

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

export function readShop(dir) {
  return {
    orders: readJsonl(path.join(dir, "orders.jsonl")),
    subscribers: readJsonl(path.join(dir, "subscribers.jsonl")),
    registrations: readJsonl(path.join(dir, "registrations.jsonl")),
    reviews: readJsonl(path.join(dir, "reviews.jsonl")),
    requests: readJsonl(path.join(dir, "custom-requests.jsonl")),
  };
}

export function analyzeShop(shop, w, { includeTest = false } = {}) {
  const seen = new Set();
  const orders = shop.orders.filter((r) => {
    if (r?.type !== "order" || !inWindow(w, r.created ?? r.at)) return false;
    if (!includeTest && r.livemode === false) return false;
    if (seen.has(r.session_id)) return false;
    seen.add(r.session_id);
    return true;
  });
  return {
    orders: orders.length,
    revenueCents: orders.reduce((n, r) => n + (Number(r.amount_total) || 0), 0),
    signups: shop.subscribers.filter((s) => inWindow(w, s.ts)).length,
    registrations: shop.registrations.filter((r) => inWindow(w, r.at)).length,
    requests: shop.requests.filter((r) => inWindow(w, r.at)).length,
  };
}

/** Waiting for John right now (not per week). */
export const pendingNow = (shop) => ({
  reviews: shop.reviews.filter((r) => r.review_status === "pending").length,
  photos: shop.reviews.filter((r) => r.photo_status === "pending").length,
  listSize: new Set(shop.subscribers.map((s) => String(s.email ?? "").toLowerCase())).size,
});

// --- the email ---------------------------------------------------------------

export function change(cur, prev) {
  if (cur === prev) return "same";
  if (prev === 0) return "up from 0";
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const list = (pairs) => pairs.map(([k, n]) => `${k} ${n}`).join(", ");

export function scorecardEmail({ windows, traffic, prevTraffic, shop, prevShop, pending, trafficError }) {
  const t = traffic;
  const headline = [
    t ? `${plural(t.visitors, "visitor")} (${change(t.visitors, prevTraffic.visitors)})` : "visitors unknown",
    `${plural(shop.orders, "order")}${shop.orders ? ` (${money(shop.revenueCents)})` : ""}`,
    plural(shop.signups, "signup"),
  ].join(", ");
  const subject = `MOP weekly: ${headline}`;

  // sections: [title, rows of [label, value, note?]]
  const sections = [];
  if (t) {
    sections.push(["Visitors", [
      ["Unique visitors", t.visitors, `last week ${prevTraffic.visitors}, ${change(t.visitors, prevTraffic.visitors)}`],
      ["Page views", t.pageviews, `last week ${prevTraffic.pageviews}, ${change(t.pageviews, prevTraffic.pageviews)}`],
      ...(t.bots.metaCrawler || prevTraffic.bots.metaCrawler
        ? [["Meta catalog crawler (left out)", t.bots.metaCrawler, `last week ${prevTraffic.bots.metaCrawler}; desktop Windows, one feed-link page from facebook.com`]]
        : []),
      ...(t.bots.cnSingle + t.bots.instant
        ? [["Other likely bots (left out)", t.bots.cnSingle + t.bots.instant, [t.bots.cnSingle && `${t.bots.cnSingle} single page from CN`, t.bots.instant && `${t.bots.instant} all pages in 0 s`].filter(Boolean).join(", ")]]
        : []),
    ]]);
    sections.push(["Where visitors came from", BUCKETS.filter((b) => t.sources[b] || prevTraffic.sources[b]).map((b) => [
      b,
      t.sources[b],
      [`last week ${prevTraffic.sources[b]}`, b === "Other referrers" && t.otherTop.length ? list(t.otherTop) : ""].filter(Boolean).join("; "),
    ])]);
    if (!BUCKETS.some((b) => t.sources[b] || prevTraffic.sources[b])) sections[sections.length - 1][1].push(["No visitors", "", ""]);
    sections.push(["Top pages (views)", t.topPages.length ? t.topPages.map((p) => [p.path, p.views, plural(p.visitors, "visitor")]) : [["No page views", "", ""]]]);
    const e = t.events;
    const pe = prevTraffic.events;
    sections.push(["What visitors did", [
      ["Buy clicks", e.buyClick, [`last week ${pe.buyClick}`, list(e.buyClickTop)].filter(Boolean).join("; ")],
      ["Signups (form)", e.signup, `last week ${pe.signup}`],
      ["Custom requests (form)", e.customRequest, `last week ${pe.customRequest}`],
      ["Gallery opens", e.galleryOpen, `last week ${pe.galleryOpen}`],
      ["Meta Shop checkouts", e.metaCheckout, [`last week ${pe.metaCheckout}`, list(e.metaCheckoutByOrigin)].filter(Boolean).join("; ")],
    ]]);
  } else {
    sections.push(["Visitors", [["Umami not read", "", trafficError ?? "no database"]]]);
  }
  sections.push(["Shop", [
    ["Orders", shop.orders, `${money(shop.revenueCents)}; last week ${prevShop.orders}, ${money(prevShop.revenueCents)}`],
    ["New subscribers", shop.signups, `last week ${prevShop.signups}; list ${pending.listSize}`],
    ["Shirt registrations", shop.registrations, `last week ${prevShop.registrations}`],
    ["Custom requests", shop.requests, `last week ${prevShop.requests}`],
    ["Waiting for approval", pending.reviews + pending.photos, `${plural(pending.reviews, "review")}, ${plural(pending.photos, "photo")}; the approve links are in their emails`],
  ]]);

  const note =
    "Your own visits count unless that browser has opened mopclothing.com/?nostats once (it turns Umami off there). " +
    "Orders are Stripe live mode, by the time they were paid.";
  const title = `${range(windows.cur)} (vs ${range(windows.prev)}), Pacific time`;

  const text = [
    `MOP weekly, ${title}`,
    headline,
    "",
    ...sections.flatMap(([name, rows]) => [
      name.toUpperCase(),
      ...rows.map(([label, value, extra]) => `${label}${value === "" ? "" : `: ${value}`}${extra ? ` (${extra})` : ""}`),
      "",
    ]),
    note,
  ].join("\n");

  const cell = 'style="padding:4px 8px 0 0;vertical-align:top"';
  const num = 'style="padding:4px 0 0;vertical-align:top;text-align:right;font-weight:600;white-space:nowrap"';
  const html =
    `<div style="font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;max-width:560px">` +
    `<p style="margin:0 0 4px;color:#666;font-size:13px">MOP weekly, ${esc(title)}</p>` +
    `<p style="margin:0 0 16px;font-size:18px;font-weight:600">${esc(headline)}</p>` +
    sections
      .map(
        ([name, rows]) =>
          `<h3 style="margin:18px 0 6px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#d96f00">${esc(name)}</h3>` +
          `<table style="border-collapse:collapse;width:100%">` +
          rows
            .map(
              ([label, value, extra]) =>
                `<tr><td ${cell}>${esc(label)}</td><td ${num}>${esc(value)}</td></tr>` +
                (extra ? `<tr><td colspan="2" style="padding:0 0 6px;color:#666;font-size:13px">${esc(extra)}</td></tr>` : "")
            )
            .join("") +
          `</table>`
      )
      .join("") +
    `<p style="margin:20px 0 0;color:#666;font-size:12px">${esc(note)}</p></div>`;

  return { subject, body: text, html, headline };
}

// --- Umami's database --------------------------------------------------------

export const VIEWS_SQL = `
  SELECT e.session_id, e.created_at, e.url_path, e.url_query, e.referrer_domain, s.country, s.device, s.os
  FROM website_event e JOIN session s ON s.session_id = e.session_id
  WHERE e.website_id = $1 AND e.event_type = 1 AND e.created_at >= $2 AND e.created_at < $3`;

export const EVENTS_SQL = `
  SELECT e.event_id, e.session_id, e.created_at, e.event_name, d.data_key, d.string_value, d.number_value
  FROM website_event e LEFT JOIN event_data d ON d.website_event_id = e.event_id
  WHERE e.website_id = $1 AND e.event_type = 2 AND e.created_at >= $2 AND e.created_at < $3`;

/** event rows (one per data key) -> one event with its data. */
export function groupEvents(rows) {
  const byId = new Map();
  for (const r of rows) {
    const e = byId.get(r.event_id) ?? { session_id: r.session_id, created_at: new Date(r.created_at).toISOString(), event_name: r.event_name, data: {} };
    if (r.data_key) e.data[r.data_key] = r.string_value ?? (r.number_value == null ? null : Number(r.number_value));
    byId.set(r.event_id, e);
  }
  return [...byId.values()];
}

async function readUmami(url, from, to) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, statement_timeout: 20_000, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const params = [WEBSITE_ID, from, to];
    const views = (await client.query(VIEWS_SQL, params)).rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
    const events = groupEvents((await client.query(EVENTS_SQL, params)).rows);
    return { views, events };
  } finally {
    await client.end().catch(() => {});
  }
}

// --- main -------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export async function buildScorecard({ now = new Date(), endYmd, dir, umami, includeTest = false }) {
  const windows = weekWindows(now, endYmd);
  let rows = null;
  let trafficError;
  try {
    rows = await umami(windows.prev.start, windows.cur.end);
  } catch (err) {
    trafficError = err.message;
  }
  const shopRows = readShop(dir);
  return scorecardEmail({
    windows,
    traffic: rows && analyzeTraffic(rows, windows.cur),
    prevTraffic: rows && analyzeTraffic(rows, windows.prev),
    shop: analyzeShop(shopRows, windows.cur, { includeTest }),
    prevShop: analyzeShop(shopRows, windows.prev, { includeTest }),
    pending: pendingNow(shopRows),
    trafficError,
  });
}

async function send(email) {
  const token = process.env.PINGPIGEON_TOKEN;
  if (!token) throw new Error("PINGPIGEON_TOKEN is not set");
  const base = (process.env.PINGPIGEON_URL || "http://127.0.0.1:3141").replace(/\/+$/, "");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(`${base}/email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "mopclothing-scorecard/1" },
        body: JSON.stringify({ subject: email.subject, body: email.body, html: email.html }),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) return true;
      console.error(`attempt ${attempt}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    } catch (err) {
      console.error(`attempt ${attempt}: ${err.message}`);
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function main() {
  const endYmd = opt("--end");
  if (endYmd && !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) throw new Error(`bad --end ${endYmd} (want YYYY-MM-DD)`);
  const fixture = opt("--fixture");
  const dir = path.resolve(opt("--data-dir") || process.env.MOP_DATA_DIR || path.join(process.cwd(), "data"));
  const umami = fixture
    ? async () => JSON.parse(fs.readFileSync(fixture, "utf8"))
    : async (from, to) => {
        const url = process.env.MOP_UMAMI_DB_URL;
        if (!url) throw new Error("MOP_UMAMI_DB_URL is not set");
        return readUmami(url, from, to);
      };
  const email = await buildScorecard({ endYmd, dir, umami, includeTest: flag("--include-test") });

  if (flag("--dry-run")) {
    console.log(`Subject: ${email.subject}\n\n${email.body}`);
    if (flag("--html")) console.log(`\n${email.html}`);
    return;
  }
  if (await send(email)) {
    console.log(`sent: ${email.subject}`);
    return;
  }
  // Leave it in the journal so nothing is lost.
  console.log(`Subject: ${email.subject}\n\n${email.body}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
