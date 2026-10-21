// Deeper engagement tracking for PopAds visits only (lib/paid-engagement.ts, John 10/21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPaidSource, marksPassed, scrollMarksReached, scrollPct, seenEventName } from "../lib/paid-engagement.ts";

test("only paid sources get the deeper tracking", () => {
  assert.equal(isPaidSource("popads"), true);
  assert.equal(isPaidSource("PopAds"), true);
  assert.equal(isPaidSource("ig"), false);
  assert.equal(isPaidSource(null), false);
  assert.equal(isPaidSource(""), false);
});

test("looked-at time marks fire once as each is passed", () => {
  assert.deepEqual(marksPassed(0, 4), []);
  assert.deepEqual(marksPassed(4, 5), [5]);
  assert.deepEqual(marksPassed(5, 6), []);
  assert.deepEqual(marksPassed(14, 31), [15, 30]);
  assert.deepEqual(marksPassed(119, 500), [120]);
});

test("scroll depth: percent of the page reached, and the marks reached", () => {
  assert.equal(scrollPct(0, 800, 3200), 25);
  assert.equal(scrollPct(800, 800, 3200), 50);
  assert.equal(scrollPct(2400, 800, 3200), 100);
  assert.equal(scrollPct(0, 900, 600), 100); // a page shorter than the screen
  assert.deepEqual(scrollMarksReached(24), []);
  assert.deepEqual(scrollMarksReached(60), [25, 50]);
  assert.deepEqual(scrollMarksReached(100), [25, 50, 75, 100]);
});

test("seen right away vs seen later (it popped under first)", () => {
  assert.equal(seenEventName(0), "pop-seen");
  assert.equal(seenEventName(2), "pop-seen");
  assert.equal(seenEventName(40), "pop-seen-late");
});
