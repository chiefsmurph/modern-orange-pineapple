// Product pages: the big photo opens full screen (John, 2026-10-16: clicking it did nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

test("every product page's gallery opens the photo viewer from an 'Enlarge photo' button", () => {
  for (const view of ["app/[productId]/CatalogProductView.tsx", "app/[productId]/ProductClientView.tsx"]) {
    const gallery = /import (\w+Gallery) from "@\/components\/(\w+Gallery)"/.exec(read(view));
    assert.ok(gallery, `${view} renders a gallery`);
    const src = read(`components/${gallery[2]}.tsx`);
    assert.match(src, /import WildLightbox from "\.\/WildLightbox"/, gallery[2]);
    assert.match(src, /<button[^>]*?type="button"[\s\S]*?aria-label=\{?[`"]Enlarge photo/, `${gallery[2]}: a real button`);
    assert.match(src, /<WildLightbox[\s\S]*?pinchZoom/, `${gallery[2]}: phones can pinch-zoom`);
    // transparent cut-outs sit on the light photo tile, not the dark backdrop
    assert.match(src, /<WildLightbox[\s\S]*?\btile\b/, `${gallery[2]}: photo tile`);
    // on <body>, so nothing on the page (bag button, buy bar) sits on top of it
    assert.match(src, /createPortal\(\s*<WildLightbox[\s\S]*?document\.body/, `${gallery[2]}: portal`);
    const css = read(`components/${gallery[2]}.module.css`);
    assert.match(css, /\.enlarge \{[^}]*cursor: zoom-in;/, `${gallery[2]}: zoom-in cursor`);
  }
});

test("the viewer shows the set that's on screen, from the photo that's on screen, at the original files", () => {
  const src = read("components/CatalogGallery.tsx");
  assert.match(src, /setViewer\(Math\.max\(0, shownSet\.indexOf\(shown\)\)\)/);
  // the public file itself (1600 px for the line-up), not a resized next/image copy
  assert.match(src, /photos=\{shownSet\.map\(\(src\) => \(\{ src, alt \}\)\)\}/);
  // the <img> stays the frame's own child: app/layout.tsx marks its parent ready before hydration
  assert.match(read("app/layout.tsx"), /t\.parentNode\.setAttribute\('data-ready',''\)/);
  assert.match(src, /data-main-photo-frame=""[\s\S]*?<img[\s\S]*?data-main-photo=""[\s\S]*?\/>\s*<span className=\{styles\.spinner\}/);
  // thumbnails still switch the big photo
  assert.match(src, /onClick=\{\(\) => onIndexChange\(i\)\}/);
});

test("pinch-zoom: allowed on product photos, Out in the wild and The MOP Crew unchanged", () => {
  const css = read("components/WildLightbox.module.css");
  assert.match(css, /\.stage \{[^}]*touch-action: pan-y;/); // the swipe-only default
  assert.match(css, /\.pinch \{\s*touch-action: pan-y pinch-zoom;/);
  assert.match(css, /\.zoomed \{\s*touch-action: auto;/); // zoomed in, one finger pans the photo
  const box = read("components/WildLightbox.tsx");
  assert.match(box, /label = "Out in the wild"/);
  assert.match(box, /pinchZoom = false/);
  assert.match(box, /tile = false/);
  assert.match(css, /\.tile \{\s*background: var\(--photo-tile\);/);
  assert.match(box, /if \(!e\.isPrimary \|\| zoomed\) swipe\.current = null;/);
  for (const f of ["app/page.tsx", "components/MopCrew.tsx"]) {
    const el = /<WildLightbox photos=.*?\/>/.exec(read(f)); // one line
    assert.ok(el, f);
    assert.doesNotMatch(el[0], /pinchZoom|\slabel=|\stile/, f);
  }
});
