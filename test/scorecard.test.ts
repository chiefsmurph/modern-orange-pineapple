// "MOP weekly" scorecard (scripts/weekly-scorecard.mjs): date windows, source buckets, bots, the email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addDays,
  analyzeShop,
  analyzeTraffic,
  buildScorecard,
  change,
  groupEvents,
  isMetaCatalogCrawler,
  ptMidnight,
  readShop,
  sourceOf,
  weekWindows,
  WEBSITE_ID,
} from "../scripts/weekly-scorecard.mjs";
import { FEED_UTM } from "../lib/google-feed.ts";
import { UMAMI_WEBSITE_ID } from "../lib/umami.ts";

const FIX = path.join(import.meta.dirname, "fixtures", "scorecard");
const fixtureRows = () => JSON.parse(readFileSync(path.join(FIX, "umami.json"), "utf8"));
const iso = (d: Date) => d.toISOString();

test("Pacific midnights, summer and winter", () => {
  assert.equal(iso(ptMidnight("2026-10-12")), "2026-10-12T07:00:00.000Z");
  assert.equal(iso(ptMidnight("2026-12-07")), "2026-12-07T08:00:00.000Z");
  assert.equal(iso(ptMidnight("2026-03-08")), "2026-03-08T08:00:00.000Z"); // DST starts at 2am that day
  assert.equal(iso(ptMidnight("2026-03-09")), "2026-03-09T07:00:00.000Z");
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(addDays("2026-01-03", -7), "2025-12-27");
});

test("Monday 08:00 PT: last week Mon-Sun vs the week before, whole Pacific days", () => {
  const w = weekWindows(new Date("2026-10-12T15:00:00Z")); // Mon Oct 12, 08:00 PDT
  assert.equal(w.cur.startYmd, "2026-10-05");
  assert.equal(w.cur.lastYmd, "2026-10-11");
  assert.equal(iso(w.cur.start), "2026-10-05T07:00:00.000Z");
  assert.equal(iso(w.cur.end), "2026-10-12T07:00:00.000Z");
  assert.equal(iso(w.prev.start), "2026-09-28T07:00:00.000Z");
  assert.equal(iso(w.prev.end), iso(w.cur.start));
  // a run late Sunday night UTC is still Sunday in LA: the week ends at Sunday's midnight
  assert.equal(weekWindows(new Date("2026-10-12T05:00:00Z")).cur.lastYmd, "2026-10-10");
  // --end picks the day
  assert.equal(weekWindows(new Date(), "2026-10-12").cur.startYmd, "2026-10-05");
});

test("the week the clocks go back is 7 days and an hour long", () => {
  const w = weekWindows(new Date("2026-11-02T16:00:00Z")); // Mon Nov 2, 08:00 PST
  assert.equal(iso(w.cur.start), "2026-10-26T07:00:00.000Z"); // PDT
  assert.equal(iso(w.cur.end), "2026-11-02T08:00:00.000Z"); // PST
  assert.equal(w.cur.end.getTime() - w.cur.start.getTime(), (7 * 24 + 1) * 3600 * 1000);
  const spring = weekWindows(new Date("2026-03-09T15:00:00Z"));
  assert.equal(spring.cur.end.getTime() - spring.cur.start.getTime(), (7 * 24 - 1) * 3600 * 1000);
});

test("source buckets", () => {
  const s = (url_query: string, referrer_domain = "") => sourceOf({ url_query, referrer_domain });
  // our feed links
  assert.deepEqual(s(`version=large&size=M&${FEED_UTM.google}`, "google.com"), { bucket: "Google Shopping" });
  assert.deepEqual(s(FEED_UTM.meta, "l.instagram.com"), { bucket: "Instagram" }); // Meta's tag + an Instagram referrer
  assert.deepEqual(s(FEED_UTM.meta, "l.facebook.com"), { bucket: "Facebook" });
  assert.deepEqual(s(FEED_UTM.meta), { bucket: "Facebook" }); // Meta's tag alone
  assert.deepEqual(s("", "shopping.google.com"), { bucket: "Google Shopping" });
  // search
  for (const d of ["google.com", "www.google.com", "google.co.uk", "com.google.android.googlequicksearchbox"])
    assert.deepEqual(s("", d), { bucket: "Google search" }, d);
  // Instagram and Facebook
  for (const d of ["instagram.com", "l.instagram.com", "www.instagram.com"]) assert.deepEqual(s("", d), { bucket: "Instagram" }, d);
  assert.deepEqual(s("ref=ig"), { bucket: "Instagram" });
  assert.deepEqual(s("?ref=IG"), { bucket: "Instagram" });
  for (const d of ["facebook.com", "l.facebook.com", "m.facebook.com", "lm.facebook.com", "fb.me"]) assert.deepEqual(s("", d), { bucket: "Facebook" }, d);
  // old cards, direct, other
  assert.deepEqual(s("ref=card"), { bucket: "Old cards" });
  assert.deepEqual(s(""), { bucket: "Direct/none" });
  assert.deepEqual(s("", "mopclothing.com"), { bucket: "Direct/none" });
  assert.deepEqual(s("color=Ivory"), { bucket: "Direct/none" });
  assert.deepEqual(s("", "www.Reddit.com"), { bucket: "Other referrers", domain: "reddit.com" });
  assert.deepEqual(s("", "notgoogle.com"), { bucket: "Other referrers", domain: "notgoogle.com" });
  assert.deepEqual(sourceOf({ url_query: null, referrer_domain: null }), { bucket: "Direct/none" });
});

test("traffic: visitors by landing source, top pages, events; bots left out and counted", () => {
  const rows = fixtureRows();
  const w = weekWindows(new Date(), "2026-10-12");
  const t = analyzeTraffic(rows, w.cur);
  assert.equal(t.visitors, 11);
  assert.equal(t.pageviews, 15);
  assert.deepEqual(t.bots, { metaCrawler: 12, cnSingle: 1, instant: 1 });
  assert.deepEqual(t.sources, {
    "Google Shopping": 1,
    "Google search": 1,
    Instagram: 2,
    Facebook: 1,
    "Old cards": 1,
    "Direct/none": 2,
    "Other referrers": 3,
  });
  assert.deepEqual(t.otherTop, [["reddit.com", 2], ["news.ycombinator.com", 1]]);
  assert.deepEqual(t.topPages[0], { path: "/", views: 6, visitors: 6 });
  assert.equal(t.topPages.length, 5);
  assert.equal(t.events.buyClick, 3);
  assert.deepEqual(t.events.buyClickTop, [["pelican-tee", 2], ["sky-tee", 1]]);
  assert.equal(t.events.galleryOpen, 2); // the bot session's gallery-open is left out
  assert.deepEqual(t.events.metaCheckoutByOrigin, [["instagram", 1]]); // server-sent, no page view: kept
  // 23:30 PT on Sunday Oct 4 belongs to the week before; 00:30 PT Monday Oct 12 to neither
  const p = analyzeTraffic(rows, w.prev);
  assert.equal(p.visitors, 4);
  assert.equal(p.sources.Instagram, 2);
});

test("Meta's catalog crawler is left out and counted; real Facebook / Instagram visitors stay", () => {
  const rows = JSON.parse(readFileSync(path.join(FIX, "meta-crawler.json"), "utf8"));
  const t = analyzeTraffic(rows, weekWindows(new Date(), "2026-10-12").cur);
  // the 12-session burst, plus: 2 pages with a variant link, fbclid on one page with no variant, 4 pages all with fbclid
  assert.equal(t.bots.metaCrawler, 15);
  // kept: on a phone, a Mac, from Instagram, no fbclid (1 page and 2 pages), via l.facebook.com,
  // fbclid on the landing only then browsing, 7 pages
  assert.equal(t.visitors, 8);
  assert.equal(t.pageviews, 16);
  assert.equal(t.sources.Facebook, 7);
  assert.equal(t.sources.Instagram, 1);
  assert.equal(t.events.galleryOpen, 0); // the crawler's events go too
  assert.equal(t.events.buyClick, 1);

  const one = (view: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    isMetaCatalogCrawler({
      views: [{ url_query: "color=Khaki&size=3XL&fbclid=IwAR0x", referrer_domain: "facebook.com", ...view }],
      device: "desktop",
      os: "Windows 10",
      ...extra,
    });
  assert.equal(one({}), true);
  assert.equal(one({ referrer_domain: "m.facebook.com" }), true);
  assert.equal(one({ referrer_domain: "www.facebook.com" }), true);
  for (const k of ["size", "color", "sky", "style", "print"]) assert.equal(one({ url_query: `${k}=x&fbclid=y` }), true, k);
  assert.equal(one({ url_query: "?color=Khaki&fbclid=IwAR0x" }), true);
  assert.equal(one({ referrer_domain: "l.facebook.com" }), false);
  assert.equal(one({ referrer_domain: "" }), false);
  assert.equal(one({ url_query: "fbclid=IwAR0x" }), true); // one page, fbclid on it
  assert.equal(one({ url_query: "color=Khaki&size=3XL" }), false);
  assert.equal(one({}, { device: "mobile", os: "iOS" }), false);
  assert.equal(one({}, { device: "laptop" }), false);
  assert.equal(one({}, { os: "Mac OS" }), false);
  assert.equal(one({}, { os: "Windows 11" }), true);
  assert.equal(one({}, { device: null, os: null }), false); // unknown: kept
  const many = (queries: string[], ref = "facebook.com") =>
    isMetaCatalogCrawler({
      views: queries.map((url_query, i) => ({ url_query, referrer_domain: i ? "" : ref })),
      device: "desktop",
      os: "Windows 10",
    });
  assert.equal(many(["color=Khaki&size=3XL&fbclid=a", ""]), true); // a variant landing with fbclid: any later pages
  assert.equal(many(["fbclid=a"]), true); // fbclid on every page
  assert.equal(many(["fbclid=a", "fbclid=b", "size=M&fbclid=c"]), true);
  assert.equal(many(["fbclid=a", ""]), false); // landed from Facebook, then browsed
  assert.equal(many(Array(6).fill("size=M&fbclid=a")), true);
  assert.equal(many(Array(7).fill("size=M&fbclid=a")), false); // more than the crawler does
  assert.equal(many(["size=M&fbclid=a", ""], "l.facebook.com"), false);
  assert.equal(many(["size=M", "fbclid=a"]), false); // no fbclid on the landing
});

test("Umami event rows (one per data key) become events with their data", () => {
  const at = new Date("2026-10-06T03:16:30Z");
  const e = groupEvents([
    { event_id: "e1", session_id: "s", created_at: at, event_name: "buy-click", data_key: "slug", string_value: "pelican-tee", number_value: null },
    { event_id: "e1", session_id: "s", created_at: at, event_name: "buy-click", data_key: "price", string_value: null, number_value: "29.0000" },
    { event_id: "e2", session_id: "s", created_at: at, event_name: "signup", data_key: null, string_value: null, number_value: null },
  ]);
  assert.deepEqual(e, [
    { session_id: "s", created_at: "2026-10-06T03:16:30.000Z", event_name: "buy-click", data: { slug: "pelican-tee", price: 29 } },
    { session_id: "s", created_at: "2026-10-06T03:16:30.000Z", event_name: "signup", data: {} },
  ]);
  assert.equal(WEBSITE_ID, UMAMI_WEBSITE_ID);
});

test("shop numbers: live orders once each, signups, registrations, requests", () => {
  const shop = readShop(path.join(FIX, "data"));
  const w = weekWindows(new Date(), "2026-10-12");
  assert.deepEqual(analyzeShop(shop, w.cur), { orders: 2, revenueCents: 7310, signups: 2, registrations: 1, requests: 1 });
  assert.equal(analyzeShop(shop, w.cur, { includeTest: true }).orders, 3);
  assert.deepEqual(analyzeShop(shop, w.prev), { orders: 0, revenueCents: 0, signups: 1, registrations: 0, requests: 0 });
  assert.deepEqual(readShop(path.join(FIX, "missing")).orders, []);
});

test("change vs last week", () => {
  assert.equal(change(12, 8), "+50%");
  assert.equal(change(4, 8), "−50%");
  assert.equal(change(3, 3), "same");
  assert.equal(change(0, 0), "same");
  assert.equal(change(2, 0), "up from 0");
});

test("the email: headline first, every section, phone-friendly HTML", async () => {
  const email = await buildScorecard({
    now: new Date("2026-10-12T15:00:00Z"),
    dir: path.join(FIX, "data"),
    umami: async (from: Date, to: Date) => {
      assert.equal(iso(from), "2026-09-28T07:00:00.000Z");
      assert.equal(iso(to), "2026-10-12T07:00:00.000Z");
      return fixtureRows();
    },
  });
  assert.equal(email.headline, "11 visitors (+175%), 2 orders ($73.10), 2 signups");
  assert.equal(email.subject, "MOP weekly: 11 visitors (+175%), 2 orders ($73.10), 2 signups");
  const lines = email.body.split("\n");
  assert.equal(lines[0], "MOP weekly, Oct 5 – Oct 11 (vs Sep 28 – Oct 4), Pacific time");
  assert.equal(lines[1], email.headline);
  for (const want of [
    "Unique visitors: 11 (last week 4, +175%)",
    "Meta catalog crawler (left out): 12 (last week 0; desktop Windows, feed links with fbclid from facebook.com)",
    "Other likely bots (left out): 2 (1 single page from CN, 1 all pages in 0 s)",
    "Google Shopping: 1 (last week 0)",
    "Other referrers: 3 (last week 0; reddit.com 2, news.ycombinator.com 1)",
    "/: 6 (6 visitors)",
    "Buy clicks: 3 (last week 1; pelican-tee 2, sky-tee 1)",
    "Meta Shop checkouts: 1 (last week 0; instagram 1)",
    "Orders: 2 ($73.10; last week 0, $0.00)",
    "Waiting for approval: 2 (1 review, 1 photo; the approve links are in their emails)",
  ])
    assert.ok(lines.includes(want), want);
  assert.match(email.body, /\?nostats/);
  assert.match(email.html, /^<div style="font:15px/);
  assert.match(email.html, /11 visitors \(\+175%\), 2 orders \(\$73\.10\), 2 signups/);
  assert.doesNotMatch(email.html, /customer@example\.com|new1@example\.com/); // no customer details in the email
});

test("Umami unreachable: the email still goes, with the shop numbers", async () => {
  const email = await buildScorecard({
    now: new Date("2026-10-12T15:00:00Z"),
    dir: path.join(FIX, "data"),
    umami: async () => {
      throw new Error("MOP_UMAMI_DB_URL is not set");
    },
  });
  assert.equal(email.headline, "visitors unknown, 2 orders ($73.10), 2 signups");
  assert.match(email.body, /Umami not read \(MOP_UMAMI_DB_URL is not set\)/);
  assert.match(email.body, /Orders: 2/);
});
