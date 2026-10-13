// New-drops signup, Umami events and ?ref=ig attribution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  createRateLimiter,
  createSubscriberStore,
  handleSubscribe,
  normalizeEmail,
  normalizeSource,
  subscribersCsv,
} from "../lib/subscribers.ts";
import { syncedQuery } from "../lib/catalog/select.ts";
import { FEED_UTM } from "../lib/google-feed.ts";
import { UMAMI_BEFORE_SEND_JS, track } from "../lib/umami.ts";
import { tmpDir } from "./helpers.ts";

const deps = (dir: string, over: Record<string, unknown> = {}) => {
  const logs: string[] = [];
  const notified: number[] = [];
  return {
    logs,
    notified,
    deps: {
      store: createSubscriberStore(dir),
      allow: () => true,
      productExists: (s: string) => s === "sky-tee",
      now: () => new Date("2026-10-12T20:00:00Z"),
      log: (m: string) => logs.push(m),
      notify: async (count: number) => void notified.push(count),
      ...over,
    },
  };
};
const req = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone)" };

test("email and source checks", () => {
  assert.equal(normalizeEmail("  Ana@Example.COM "), "ana@example.com");
  for (const bad of ["", "ana", "ana@", "@x.com", "ana@x", "a b@x.com", 42, null, "x".repeat(250) + "@x.com"])
    assert.equal(normalizeEmail(bad), null, String(bad));
  assert.equal(normalizeSource("home", () => false), "home");
  assert.equal(normalizeSource("product:sky-tee", (s) => s === "sky-tee"), "product:sky-tee");
  assert.equal(normalizeSource("product:nope", () => false), "other");
  assert.equal(normalizeSource("<script>", () => true), "other");
});

test("a new signup is saved (no IP), counted, and John is told after; a repeat (any case) is not", async () => {
  const dir = tmpDir();
  const { deps: d, logs, notified } = deps(dir);
  const r1 = await handleSubscribe({ email: "Ana@Example.com", source: "home" }, req, d);
  assert.deepEqual(r1.body, { ok: true });
  await r1.after!();
  const r2 = await handleSubscribe({ email: "ana@EXAMPLE.com", source: "product:sky-tee" }, req, d);
  assert.deepEqual(r2.body, { ok: true }); // same answer either way
  assert.equal(r2.after, undefined);
  const r3 = await handleSubscribe({ email: "bo@example.com", source: "product:sky-tee" }, req, d);
  await r3.after!();
  assert.deepEqual(notified, [1, 2]);
  const lines = readFileSync(path.join(dir, "subscribers.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.email, l.source]), [["ana@example.com", "home"], ["bo@example.com", "product:sky-tee"]]);
  assert.deepEqual(Object.keys(lines[0]).sort(), ["email", "source", "ts", "ua_hash"]);
  assert.equal(lines[0].ts, "2026-10-12T20:00:00.000Z");
  assert.match(lines[0].ua_hash, /^[0-9a-f]{16}$/);
  const raw = readFileSync(path.join(dir, "subscribers.jsonl"), "utf8");
  assert.doesNotMatch(raw, /203\.0\.113\.9|iPhone/); // no IP, no raw user agent
  assert.ok(logs.every((l) => !/@/.test(l)), "no address in the logs");
  assert.deepEqual(logs, ["[subscribe] new subscriber #1 (home)", "[subscribe] new subscriber #2 (product:sky-tee)"]);
});

test("honeypot, bad address and rate limit", async () => {
  const dir = tmpDir();
  const { deps: d, notified } = deps(dir);
  const bot = await handleSubscribe({ email: "bot@example.com", website: "http://spam" }, req, d);
  assert.deepEqual(bot, { status: 200, body: { ok: true } }); // looks fine to the bot
  assert.deepEqual(await d.store.readAll(), []);
  const bad = await handleSubscribe({ email: "nope" }, req, d);
  assert.equal(bad.status, 400);
  let t = 0;
  const allow = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  const { deps: d2 } = deps(tmpDir(), { allow });
  assert.equal((await handleSubscribe({ email: "a@example.com" }, req, d2)).status, 200);
  assert.equal((await handleSubscribe({ email: "b@example.com" }, req, d2)).status, 200);
  assert.equal((await handleSubscribe({ email: "c@example.com" }, req, d2)).status, 429);
  assert.equal((await handleSubscribe({ email: "c@example.com" }, { ...req, ip: "198.51.100.1" }, d2)).status, 200);
  t = 1001;
  assert.equal((await handleSubscribe({ email: "d@example.com" }, req, d2)).status, 200);
  assert.deepEqual(notified, []);
});

test("a failing notify never fails the signup", async () => {
  const { deps: d, logs } = deps(tmpDir(), { notify: async () => { throw new Error("pingpigeon down"); } });
  const r = await handleSubscribe({ email: "c@example.com", source: "home" }, req, d);
  assert.equal(r.status, 200);
  await r.after!(); // swallowed and logged
  assert.ok(logs.some((l) => /notify failed: pingpigeon down/.test(l)));
});

test("export: CSV of unique addresses (script and helper agree)", async () => {
  const dir = tmpDir();
  const { deps: d } = deps(dir);
  await handleSubscribe({ email: "ana@example.com", source: "home" }, req, d);
  await handleSubscribe({ email: "bo@example.com", source: "product:sky-tee" }, req, d);
  const csv = execFileSync("node", ["scripts/export-subscribers.mjs"], { env: { ...process.env, MOP_DATA_DIR: dir }, stdio: ["ignore", "pipe", "ignore"] }).toString();
  assert.equal(csv, "email,subscribed_at,source\nana@example.com,2026-10-12T20:00:00.000Z,home\nbo@example.com,2026-10-12T20:00:00.000Z,product:sky-tee\n");
  assert.equal(subscribersCsv(await d.store.readAll()), csv);
});

test("?ref=ig survives the product page rewriting its query", () => {
  const names = ["version", "style", "color", "size"];
  assert.equal(
    syncedQuery("?ref=ig&utm_source=instagram", names, { version: "large", style: "beanie", color: "Ivory", size: undefined }),
    "ref=ig&utm_source=instagram&version=large&style=beanie&color=Ivory"
  );
  assert.equal(syncedQuery("?ref=ig&size=M", names, { version: "small", size: undefined }), "ref=ig&version=small");
  assert.equal(syncedQuery("", names, {}), "");
});

test("feed links' utm tags survive the product page's rewrite and reach Umami on the landing view", () => {
  const names = ["version", "style", "color", "size"];
  for (const tags of Object.values(FEED_UTM)) {
    const landing = `?version=large&style=beanie&color=Ivory&size=M&${tags}`;
    // first render: same picks, nothing changes
    assert.equal(syncedQuery(landing, names, { version: "large", style: "beanie", color: "Ivory", size: "M" }), landing.slice(1));
    // a new pick: the picks change, the tags stay
    const after = new URLSearchParams(syncedQuery(landing, names, { version: "small", style: "classic", color: "White", size: undefined }));
    for (const [k, v] of new URLSearchParams(tags)) assert.equal(after.get(k), v, k);
    assert.equal(after.get("size"), null);
    // the landing view goes to Umami with the tags (Umami reads utm_* off the URL); picks after it don't
    const w: Record<string, any> = {};
    new Function("window", UMAMI_BEFORE_SEND_JS)(w);
    const hook = w.mopUmamiBeforeSend as (t: string, p: any) => any;
    assert.equal(hook("event", { url: `/pelican-tee${landing}`, website: "x" }).url, `/pelican-tee${landing}`);
    assert.equal(hook("event", { url: `/pelican-tee?${after}`, website: "x" }), null);
  }
});

test("Umami hook: picks (same path) don't count as page views; new pages and events do", () => {
  const w: Record<string, any> = {};
  new Function("window", UMAMI_BEFORE_SEND_JS)(w);
  const hook = w.mopUmamiBeforeSend as (t: string, p: any) => any;
  const view = (url: string) => ({ url, website: "x" });
  assert.ok(hook("event", view("/pelican-tee?ref=ig"))); // the landing view keeps ?ref=ig
  assert.equal(hook("event", view("/pelican-tee?ref=ig&version=large&color=Ivory")), null);
  assert.equal(hook("event", view("/pelican-tee?ref=ig&version=small")), null);
  assert.ok(hook("event", { url: "/pelican-tee?ref=ig", name: "buy-click", data: {} })); // events pass
  assert.ok(hook("event", view("/"))); // a new page
  assert.ok(hook("event", view("/pelican-tee"))); // and back
  assert.ok(hook("identify", { id: "x" }));
});

test("track() is a no-op without Umami and never throws", () => {
  const g = globalThis as any;
  const had = "window" in g;
  const before = g.window;
  try {
    g.window = {};
    assert.doesNotThrow(() => track("buy-click", { slug: "x" }));
    const calls: unknown[] = [];
    g.window = { umami: { track: (n: string, d: unknown) => { calls.push([n, d]); return Promise.reject(new Error("blocked")); } } };
    assert.doesNotThrow(() => track("buy-click", { slug: "sky-tee", size: undefined, price: 49 }));
    assert.deepEqual(calls, [["buy-click", { slug: "sky-tee", price: 49 }]]);
    g.window = { umami: { track: () => { throw new Error("boom"); } } };
    assert.doesNotThrow(() => track("signup"));
  } finally {
    if (had) g.window = before;
    else delete g.window;
  }
});
