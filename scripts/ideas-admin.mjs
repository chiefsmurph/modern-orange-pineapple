#!/usr/bin/env node
// Shirt ideas (lib/ideas-server.ts) from the box:
//
//   (no args)       print John's review page link (/moderate/ideas?sig=…, signed with MOP_LINK_SECRET)
//                   and how many ideas there are by status. Never prints an email or a payout handle.
//   --delete <id>   delete one idea from ideas.jsonl (test entries); --dry-run shows it first
//
//   sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     --env-file=/srv/mopclothing/.env /srv/mopclothing/scripts/ideas-admin.mjs
//
// Needs Node >= 22.18 (it imports the site's TypeScript). The link is a password:
// don't paste it anywhere public.
import path from "node:path";
import { createIdeaStore, ideasAdminUrl } from "../lib/ideas-server.ts";

const args = process.argv.slice(2);
const dir = path.resolve(process.env.MOP_DATA_DIR || path.join(process.cwd(), "data"));
const store = createIdeaStore(dir);
const all = await store.readAll();

const del = args.indexOf("--delete");
if (del >= 0) {
  const id = args[del + 1] ?? "";
  const x = all.find((i) => i.id === id);
  if (!x) {
    console.error(`No idea ${JSON.stringify(id)} in ${store.file}.`);
    process.exit(1);
  }
  const what = `idea ${x.id} (${x.status}, ${x.createdAt}, from ${x.name}): ${x.idea.replace(/\s+/g, " ").slice(0, 80)}`;
  if (args.includes("--dry-run")) {
    console.log(`Would delete ${what}`);
    process.exit(0);
  }
  await store.remove(id);
  console.log(`Deleted ${what}`);
  process.exit(0);
}

const link = ideasAdminUrl(process.env.MOP_SITE_URL || "https://mopclothing.com", process.env.MOP_LINK_SECRET || undefined);
const by = (s) => all.filter((i) => i.status === s).length;
console.log(`${all.length} ideas: ${by("new")} new, ${by("approved")} approved, ${by("denied")} denied, ${by("launched")} launched (${store.file})`);
console.log(link ? `Review page: ${link}` : "MOP_LINK_SECRET is not set (run with --env-file=/srv/mopclothing/.env), so there's no review link.");
