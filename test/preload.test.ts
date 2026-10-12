// Product-page photo preloading: queue behaviour and the priority plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPreloadQueue } from "../lib/preload-queue.ts";
import { preloadKey, preloadPlan } from "../lib/catalog/preload-plan.ts";
import { getShopProduct } from "../lib/catalog/index.ts";
import { imagesFor, normalizeSelection } from "../lib/catalog/select.ts";

/** A fake loader: each key resolves when the test says so. */
function fakeLoader() {
  const pending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void; urgent: boolean }>();
  const started: string[] = [];
  const run = (key: string, urgent: boolean, signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      started.push(key);
      pending.set(key, { resolve, reject, urgent });
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const finish = async (key: string) => {
    pending.get(key)!.resolve(`img:${key}`);
    pending.delete(key);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { run, started, pending, finish };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("background work waits for start(), then runs in plan order, 2 at a time", async () => {
  const f = fakeLoader();
  const q = createPreloadQueue({ concurrency: 2, run: f.run });
  q.setPlan(["a", "b", "c", "d"]);
  await tick();
  assert.deepEqual(f.started, []); // nothing before the first photo is showing
  q.start();
  assert.deepEqual(f.started, ["a", "b"]);
  await f.finish("a");
  assert.deepEqual(f.started, ["a", "b", "c"]);
  assert.equal(q.status("a"), "loaded");
  assert.equal(q.value("a"), "img:a");
  assert.equal(q.inFlight(), 2);
});

test("a pick jumps the queue: background downloads are pre-empted and resume after it lands", async () => {
  const f = fakeLoader();
  const q = createPreloadQueue({ concurrency: 2, run: f.run });
  q.setPlan(["a", "b", "c", "d", "e"]);
  q.start(); // a, b running
  const picked = q.request("e");
  await tick();
  assert.deepEqual(f.started, ["a", "b", "e"]);
  assert.equal(f.pending.get("e")!.urgent, true);
  assert.equal(q.status("a"), "idle"); // cancelled, back in the plan
  assert.equal(q.status("b"), "idle");
  assert.equal(q.inFlight(), 1); // only the pick is downloading
  await f.finish("e");
  assert.equal(await picked, "img:e");
  assert.deepEqual(f.started, ["a", "b", "e", "a", "b"]); // a and b restart first
});

test("rapid picks: a newer pick pre-empts the older one, which goes back in the plan", async () => {
  const f = fakeLoader();
  const q = createPreloadQueue({ concurrency: 2, run: f.run });
  q.start();
  const first = q.request("x");
  const second = q.request("y");
  await assert.rejects(first);
  assert.equal(q.status("x"), "idle");
  assert.equal(q.inFlight(), 1);
  await f.finish("y");
  assert.equal(await second, "img:y");
  assert.deepEqual(f.started, ["x", "y", "x"]); // x resumes as background work
});

test("requesting something already loaded or loading never loads it twice", async () => {
  const f = fakeLoader();
  const q = createPreloadQueue({ concurrency: 1, run: f.run });
  q.setPlan(["a"]);
  q.start();
  const p1 = q.request("a"); // in flight as background work
  await f.finish("a");
  assert.equal(await p1, "img:a");
  assert.equal(await q.request("a"), "img:a");
  assert.deepEqual(f.started, ["a"]);
  q.setPlan(["a", "a", "b"]); // duplicates and loaded keys are skipped
  await tick();
  assert.deepEqual(f.started, ["a", "b"]);
});

test("a new plan replaces what's still waiting", async () => {
  const f = fakeLoader();
  const q = createPreloadQueue({ concurrency: 1, run: f.run });
  q.setPlan(["a", "b", "c"]);
  q.start();
  q.setPlan(["z", "y"]);
  await f.finish("a");
  assert.deepEqual(f.started, ["a", "z"]);
});

test("abort() cancels in-flight loads and refuses new work", async () => {
  const f = fakeLoader();
  const q = createPreloadQueue({ concurrency: 2, run: f.run });
  q.setPlan(["a", "b", "c"]);
  q.start();
  q.abort();
  await tick();
  assert.equal(q.status("a"), "failed");
  await assert.rejects(q.request("c"));
  assert.deepEqual(f.started, ["a", "b"]);
});

test("pelican tee plan: this pick's photos, then the same print+style in other colours, then the rest", { skip: !getShopProduct("pelican-tee") }, () => {
  const p = getShopProduct("pelican-tee")!;
  const sel: Record<string, string | undefined> = { ...normalizeSelection(p), size: "M" };
  const plan = preloadPlan(p, sel, 0);
  const keys = plan.map(preloadKey);
  const mine = imagesFor(p, sel);
  assert.deepEqual(plan.slice(0, mine.length).map((i) => i.src), mine);
  // tier 2 starts with the hero of each other colour, same version and style
  const otherColours = p.options.color.filter((c) => c !== sel.color);
  const heroes = otherColours.map((c) => imagesFor(p, { ...sel, color: c })[0]);
  assert.deepEqual(plan.slice(mine.length, mine.length + heroes.length).map((i) => i.src), heroes);
  assert.ok(plan.slice(mine.length, mine.length + heroes.length).every((i) => i.kind === "main"));
  // everything the page can show is in the plan exactly once
  const all = new Set(p.images.flatMap((s) => s.images));
  for (const src of Array.from(all)) {
    assert.ok(keys.includes(`main|${src}`), `main ${src}`);
    assert.ok(keys.includes(`thumb|${src}`), `thumb ${src}`);
  }
  assert.equal(new Set(keys).size, keys.length);
  // the other print/style comes after the other colours
  const otherStyle = imagesFor(p, { ...sel, style: sel.style === "beanie" ? "classic" : "beanie" })[0];
  assert.ok(keys.indexOf(`main|${otherStyle}`) > mine.length + heroes.length);
});

test("sky tee plan follows the visitor's photo position across skies", { skip: !getShopProduct("sky-tee") }, () => {
  const p = getShopProduct("sky-tee")!;
  const sel = normalizeSelection(p);
  const plan = preloadPlan(p, sel, 2);
  const mine = imagesFor(p, sel);
  const firstOther = p.options.sky[1];
  assert.equal(plan[mine.length].src, imagesFor(p, { ...sel, sky: firstOther })[2]);
});

test("Save-Data: only the current pick's photos", { skip: !getShopProduct("pelican-tee") }, () => {
  const p = getShopProduct("pelican-tee")!;
  const sel = normalizeSelection(p);
  assert.deepEqual(preloadPlan(p, sel, 0, { saveData: true }).map((i) => i.src), imagesFor(p, sel));
});
