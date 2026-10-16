// Private preview pages (lib/previews.ts, app/preview/[slug]): unguessable slugs, images on disk,
// never indexed, and the town exclusives never name a trademark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getPreview, previews } from "../lib/previews.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("every preview slug ends in 8 random hex characters and is unique", () => {
  const slugs = previews.map((p) => p.slug);
  for (const s of slugs) assert.match(s, /^[a-z]+(-[a-z]+)*-[0-9a-f]{8}$/, s);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("every preview image is a WebP in public/preview/<slug>/, at most 300 KB", () => {
  for (const p of previews) {
    for (const g of [...p.gallery, ...(p.sketch ?? [])]) {
      assert.ok(g.src.startsWith(`/preview/${p.slug}/`) && g.src.endsWith(".webp"), g.src);
      const file = path.join(ROOT, "public", g.src);
      assert.ok(existsSync(file), g.src);
      assert.ok(statSync(file).size <= 300 * 1024, `${g.src} is over 300 KB`);
    }
  }
});

test("preview pages and their images are sent noindex", () => {
  const cfg = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  assert.match(cfg, /source: "\/preview\/:path\*"/);
  assert.match(cfg, /X-Robots-Tag", value: "noindex, nofollow"/);
});

test("town previews: Oceanside + Carlsbad, each shirt shown front and back, plus the bunny close-up", () => {
  const shirts: Record<string, string[]> = {
    "oceanside-9636b198": ["pier", "harbor"],
    "carlsbad-8d9b6e95": ["lagoon", "ranunculus", "arch"],
  };
  for (const [slug, names] of Object.entries(shirts)) {
    const p = getPreview(slug);
    assert.ok(p, slug);
    assert.equal(p.design, undefined); // store/town previews credit no artist design
    const files = p.gallery.map((g) => path.basename(g.src, ".webp"));
    assert.equal(files[0], "set");
    for (const n of names) {
      assert.ok(files.includes(`${n}-front`), `${slug} ${n}-front`);
      assert.ok(files.includes(`${n}-back`), `${slug} ${n}-back`);
    }
    assert.ok(files.includes("bunny-closeup"));
  }
  assert.match(getPreview("oceanside-9636b198")!.line, /“Oceanside, CA”/);
  assert.match(getPreview("carlsbad-8d9b6e95")!.line, /“Carlsbad, CA”/);
});

test("town previews say which shirts are still concepts (the egret isn't drawn yet)", () => {
  const c = getPreview("carlsbad-8d9b6e95")!;
  const lagoon = c.gallery.find((g) => g.src.endsWith("/lagoon-front.webp"))!;
  assert.match(lagoon.caption, /concept/i);
  assert.match(lagoon.caption, /egret artwork in progress/i);
  assert.match(c.line, /egret is still being drawn/);
  const arch = c.gallery.find((g) => g.src.endsWith("/arch-front.webp"))!;
  assert.match(arch.caption, /concept/i);
  const pier = getPreview("oceanside-9636b198")!.gallery.find((g) => g.src.endsWith("/pier-front.webp"))!;
  assert.match(pier.caption, /concept/i);
});

test("no preview names a trademark or business (outreach research 10/13)", () => {
  const banned = [/flower fields/i, /carlsbad ranch/i, /tecolote/i, /scripps/i, /o['’]side/i, /ruby['’]?s/i,
    /top gun/i, /legoland/i, /junior seau/i, /sealebrities/i, /longest pier/i, /taylormade/i];
  for (const p of previews) {
    const text = [p.headline, p.line, ...p.gallery.flatMap((g) => [g.alt, g.caption])].join("\n");
    for (const b of banned) assert.doesNotMatch(text, b, `${p.slug}: ${b}`);
  }
});
