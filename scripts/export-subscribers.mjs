#!/usr/bin/env node
// Prints the "new drops" email list as CSV (email,subscribed_at,source), one
// row per address (case-insensitive, first signup wins). Run on the box:
//
//   sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/export-subscribers.mjs > subscribers.csv
//
// Plain Node, no dependencies. Never commit the output.
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.MOP_DATA_DIR || path.join(process.cwd(), "data"));
const file = path.join(dir, "subscribers.jsonl");
const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const seen = new Set();
const rows = ["email,subscribed_at,source"];
for (const line of lines) {
  let s;
  try {
    s = JSON.parse(line);
  } catch {
    continue;
  }
  const key = String(s.email || "").toLowerCase();
  if (!key || seen.has(key)) continue;
  seen.add(key);
  rows.push([String(s.email), String(s.ts || ""), String(s.source || "")].map(esc).join(","));
}
process.stdout.write(rows.join("\n") + "\n");
process.stderr.write(`${rows.length - 1} subscriber(s)\n`);
