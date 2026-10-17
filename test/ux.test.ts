// Product-page photo position and "← Home" scroll return (John's UX bugs, 2026-10-12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { keepPhotoPosition } from "../lib/catalog/select.ts";
import { lastHomeCard, planReturnHome, rememberHomeCard, takeHomeRestore } from "../lib/home-scroll.ts";

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
};

test("the shown photo keeps its position when the photo set changes", () => {
  assert.equal(keepPhotoPosition(1, 3), 1); // model2 -> model2 in the new colour
  assert.equal(keepPhotoPosition(2, 4), 2); // flat -> flat (polo sets also have a detail)
  assert.equal(keepPhotoPosition(3, 3), 0); // the new set has no 4th photo: first
  assert.equal(keepPhotoPosition(1, 1), 0);
  assert.equal(keepPhotoPosition(-1, 3), 0);
});

test("← Home after a card click goes back and restores the grid position once", () => {
  const s = memoryStorage();
  rememberHomeCard("/rabbit-polo", 3012.4);
  assert.deepEqual(lastHomeCard(), { to: "/rabbit-polo", y: 3012 });
  assert.equal(planReturnHome(s, "/rabbit-polo", 3), "back");
  assert.equal(takeHomeRestore(s), 3012);
  assert.equal(takeHomeRestore(s), null);
});

test("a direct visit, reload or new tab goes to the top of the home page", () => {
  const s = memoryStorage();
  // fresh page load: no card click in memory
  assert.equal(planReturnHome(s, "/pelican-tee", 2, null), "push-top");
  // a card click for ANOTHER product doesn't count
  assert.equal(planReturnHome(s, "/pelican-tee", 4, { to: "/star-polo", y: 900 }), "push-top");
  // no history to go back to (new tab)
  assert.equal(planReturnHome(s, "/star-polo", 1, { to: "/star-polo", y: 900 }), "push-top");
  assert.equal(takeHomeRestore(s), null);
  // a stale restore value from an earlier trip is cleared, not reused
  s.setItem("mop:home-restore", "700");
  assert.equal(planReturnHome(s, "/pelican-tee", 2, null), "push-top");
  assert.equal(takeHomeRestore(s), null);
});

test("storage that throws (private mode) still goes back, and restoring is skipped", () => {
  const broken = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => { throw new Error("denied"); },
  };
  assert.equal(planReturnHome(broken, "/x", 3, { to: "/x", y: 10 }), "back");
  assert.equal(takeHomeRestore(broken), null);
});

test("product pages: '← Home' is black, orange + underline on hover/focus, the arrow nudges left", () => {
  const ROOT = path.resolve(import.meta.dirname, "..");
  const link = readFileSync(path.join(ROOT, "components/HomeLink.tsx"), "utf8");
  // the same text ("← Home") with the arrow in its own span, and the same back-navigation
  assert.match(link, /<span>←&nbsp;<\/span>Home\s*<\/Link>/);
  assert.match(link, /if \(plan === "back"\) \{\s*e\.preventDefault\(\);\s*router\.back\(\);/);
  const css = readFileSync(path.join(ROOT, "app/[productId]/ProductClientView.module.css"), "utf8");
  assert.match(css, /a\.home \{\s*color: #000;\s*text-decoration: none;\s*\}/);
  assert.match(css, /a\.home:hover,\s*a\.home:focus-visible \{\s*color: #d96f00;\s*text-decoration: underline;/);
  assert.match(css, /a\.home:hover span,\s*a\.home:focus-visible span \{\s*transform: translateX\(-3px\);/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*a\.home span \{\s*transition: transform 150ms ease;/);
  assert.doesNotMatch(css, /a\.home[^{]*\{[^}]*font-size/); // same size as before
});


test("gallery thumbnails and Sky tiles: no browser focus ring from a click, an orange one from the keyboard", () => {
  const ROOT = path.resolve(import.meta.dirname, "..");
  const gallery = readFileSync(path.join(ROOT, "components/CatalogGallery.module.css"), "utf8");
  assert.match(gallery, /\.active \{\s*border-color: #ff8800;/); // the selected one: orange
  assert.match(gallery, /\.thumb:focus:not\(:focus-visible\) \{\s*outline: none;/);
  assert.match(gallery, /\.thumb:focus-visible \{\s*outline: 2px solid #d96f00;/);
  const page = readFileSync(path.join(ROOT, "app/[productId]/CatalogProductView.module.css"), "utf8");
  assert.match(page, /\.thumbChoice:focus:not\(:focus-visible\) \{\s*outline: none;/);
  assert.match(page, /\.thumbChoice:focus-visible \{\s*outline: 2px solid #d96f00;/);
});
