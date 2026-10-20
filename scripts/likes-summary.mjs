#!/usr/bin/env node
// Every "♡ I'd wear this" like right now (lib/likes.ts), including counts under the
// 10 the site needs before it shows one: per product, per design (sky, colour, style)
// and per visit source (utm_source, e.g. popads). John's own browsers are left out.
// Run on the box:
//
//   sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/likes-summary.mjs
//
// Plain Node, no dependencies.
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.MOP_DATA_DIR || path.join(process.cwd(), "data"));
const file = path.join(dir, "likes.jsonl");
const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];

// the latest line per (device, product, design) decides
const latest = new Map();
let self = 0;
for (const line of lines) {
  try {
    const r = JSON.parse(line);
    latest.set(`${r.device}|${r.slug}|${r.design}`, r);
  } catch {
    // torn line
  }
}
const products = new Map();
for (const r of latest.values()) {
  if (!r.on) continue;
  if (r.self) {
    self++;
    continue;
  }
  const p = products.get(r.slug) ?? { people: new Set(), designs: new Map(), sources: new Map() };
  p.people.add(r.device);
  p.designs.set(r.design || "(one design)", (p.designs.get(r.design || "(one design)") ?? 0) + 1);
  p.sources.set(r.src, (p.sources.get(r.src) ?? 0) + 1);
  products.set(r.slug, p);
}

const sorted = [...products.entries()].sort((a, b) => b[1].people.size - a[1].people.size);
const people = new Set([...products.values()].flatMap((p) => [...p.people]));
console.log(`Likes now: ${people.size} people, ${sorted.reduce((n, [, p]) => n + [...p.designs.values()].reduce((a, b) => a + b, 0), 0)} hearts on ${sorted.length} products (${lines.length} taps logged; ${self} of John's own not counted)\n`);
for (const [slug, p] of sorted) {
  const src = [...p.sources.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(", ");
  console.log(`${slug}: ${p.people.size} people  (by source: ${src})`);
  for (const [design, n] of [...p.designs.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${n}  ${design}`);
}
if (!sorted.length) console.log("No likes yet.");
