// "♡ I'd wear this" likes (lib/likes.ts, John 2026-10-20).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  LIKES_FILE,
  LIKES_SHOW_MIN,
  createLikeStore,
  designKey,
  handleLike,
  isBotUa,
  normalizeSrc,
  shownCount,
  type LikeDeps,
} from "../lib/likes.ts";
import { getShopProduct } from "../lib/catalog/index.ts";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const dev = (n: number) => n.toString(16).padStart(32, "0");
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mop-likes-"));

const deps = (dir: string, over: Partial<LikeDeps> = {}): LikeDeps => ({
  store: createLikeStore(dir),
  allow: () => true,
  optionsFor: (slug) => getShopProduct(slug)?.options,
  now: () => new Date("2026-10-20T20:00:00Z"),
  log: () => undefined,
  ...over,
});

const tap = (d: LikeDeps, device: number, body: Record<string, unknown> = {}, ua: string | null = UA) =>
  handleLike({ slug: "sky-tee", opts: { sky: "aurora" }, on: true, device: dev(device), ...body }, { ip: "1.2.3.4", userAgent: ua }, d);

test("designKey: the visual picks without size, in a fixed order", () => {
  assert.equal(designKey({ size: "XL", sky: "aurora" }), "sky=aurora");
  assert.equal(designKey({ style: "beanie", color: "Ivory", version: "large", size: "M" }), "color=Ivory&style=beanie&version=large");
  assert.equal(designKey({ size: "M" }), "");
});

test("crawlers, headless browsers and HTTP libraries are bots; phones are not", () => {
  for (const ua of [null, "", "Googlebot/2.1", "Mozilla/5.0 (compatible; bingbot/2.0)", "HeadlessChrome/120", "curl/8.4", "python-requests/2.31", "axios/1.6"])
    assert.ok(isBotUa(ua), String(ua));
  assert.ok(!isBotUa(UA));
  assert.ok(!isBotUa("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36"));
});

test("the source is the visit's utm_source, else direct", () => {
  assert.equal(normalizeSrc("PopAds"), "popads");
  assert.equal(normalizeSrc(undefined), "direct");
  assert.equal(normalizeSrc("<script>"), "direct");
});

test("the count stays hidden below 10", () => {
  assert.equal(LIKES_SHOW_MIN, 10);
  assert.equal(shownCount(9), null);
  assert.equal(shownCount(10), 10);
});

test("a like is saved per device and design; the count is people, shown from 10, John's own left out", async () => {
  const dir = tmp();
  const d = deps(dir);
  for (let i = 1; i <= 9; i++) assert.deepEqual((await tap(d, i)).body, { ok: true, count: null });
  // the same person liking a second sky is still one person
  assert.deepEqual((await tap(d, 9, { opts: { sky: "midnight" } })).body, { ok: true, count: null });
  // John's browser (?nostats) is saved but not counted
  assert.deepEqual((await tap(d, 99, { self: true })).body, { ok: true, count: null });
  assert.deepEqual((await tap(d, 10)).body, { ok: true, count: 10 });
  // un-liking takes it back under the bar
  assert.deepEqual((await tap(d, 10, { on: false })).body, { ok: true, count: null });
  // tapping the same state twice writes nothing new
  const before = readFileSync(path.join(dir, LIKES_FILE), "utf8").split("\n").filter(Boolean).length;
  await tap(d, 1);
  assert.equal(readFileSync(path.join(dir, LIKES_FILE), "utf8").split("\n").filter(Boolean).length, before);

  // what's stored: hashed device, the design, the source; no IP
  const rows = readFileSync(path.join(dir, LIKES_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(rows[0]).sort(), ["design", "device", "on", "self", "slug", "src", "ts", "ua_hash"]);
  assert.notEqual(rows[0].device, dev(1));
  assert.equal(rows[0].design, "sky=aurora");
  assert.ok(!JSON.stringify(rows).includes("1.2.3.4"));

  // a fresh store (a restart) reads the same state back
  assert.equal(await createLikeStore(dir).count("sky-tee"), 9);
});

test("bad taps are refused; bots get a normal answer and nothing is saved", async () => {
  const dir = tmp();
  const d = deps(dir);
  assert.equal((await tap(d, 1, { slug: "no-such-shirt" })).status, 404);
  assert.equal((await tap(d, 1, { device: "abc" })).status, 400);
  assert.equal((await tap(d, 1, { on: "yes" })).status, 400);
  // only skies on sale (a retired sky is refused)
  assert.deepEqual((await tap(d, 1, { opts: { sky: "sunset-glow" } })).body, { ok: false, error: "invalid sky" });
  // unknown picks and size are ignored, case is fixed
  await tap(d, 1, { opts: { sky: "AURORA", size: "XL", junk: "x" } });
  assert.equal(readFileSync(path.join(dir, LIKES_FILE), "utf8").includes('"design":"sky=aurora"'), true);
  // bots
  const botDir = tmp();
  const b = deps(botDir);
  assert.deepEqual((await tap(b, 2, {}, "Googlebot/2.1")).body, { ok: true, count: null });
  assert.equal(await b.store.count("sky-tee"), 0);
  // rate limit
  assert.equal((await tap(deps(tmp(), { allow: () => false }), 3)).status, 429);
});

test("scripts/likes-summary.mjs shows every count, by design and source, without John's own", async () => {
  const dir = tmp();
  const d = deps(dir);
  await tap(d, 1);
  await tap(d, 2, { src: "popads" });
  await tap(d, 2, { opts: { sky: "golden-hour" }, src: "popads" });
  await tap(d, 3, { self: true });
  appendFileSync(path.join(dir, LIKES_FILE), '{"torn');
  const out = execFileSync(process.execPath, ["scripts/likes-summary.mjs"], { env: { ...process.env, MOP_DATA_DIR: dir } }).toString();
  assert.match(out, /Likes now: 2 people, 3 hearts on 1 products/);
  assert.match(out, /1 of John's own not counted/);
  assert.match(out, /sky-tee: 2 people {2}\(by source: popads 2, direct 1\)/);
  assert.match(out, /2 {2}sky=aurora/);
  assert.match(out, /1 {2}sky=golden-hour/);
});
