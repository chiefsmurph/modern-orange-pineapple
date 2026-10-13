// The old redeem-code admin is gone (10/13): its endpoints answer 410, its page is
// deleted, and its client-side "password" is nowhere in the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as list from "../app/api/list/route.ts";
import * as all from "../app/api/all/route.ts";
import * as generate from "../app/api/generate/route.ts";
import * as redeem from "../app/api/redeem/route.ts";
import * as validate from "../app/api/validate-code/route.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

test("the old admin and redeem endpoints answer 410 Gone, and read or write nothing", async () => {
  for (const [name, res] of [
    ["GET /api/list", await list.GET()],
    ["GET /api/all", await all.GET()],
    ["POST /api/generate", await generate.POST()],
    ["POST /api/redeem", await redeem.POST()],
    ["POST /api/validate-code", await validate.POST()],
  ] as const) {
    assert.equal(res.status, 410, name);
  }
  for (const f of ["list", "all", "generate"]) {
    const code = readFileSync(path.join(ROOT, "app/api", f, "route.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /import|readCodes|writeCodes|codes\.json|fs\./, f);
  }
});

test("the /banana-suit-42 admin page and its pieces are deleted (the path is a 404 now)", () => {
  for (const f of ["app/banana-suit-42", "components/AdminPanel.tsx", "styles/Admin.module.css", "lib/db.ts"])
    assert.equal(existsSync(path.join(ROOT, f)), false, f);
});

test("the old admin password is in no tracked file", (t) => {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    t.skip("not a git checkout");
    return;
  }
  const needle = ["alphabet", "soup"].join(""); // built, so this file doesn't contain it
  const hits = files.filter((f) => {
    const p = path.join(ROOT, f);
    if (!existsSync(p) || /\.(png|jpe?g|webp|avif|mp4|ico|ttf|woff2?)$/i.test(f)) return false;
    return readFileSync(p, "utf8").toLowerCase().includes(needle);
  });
  assert.deepEqual(hits, []);
});

test("the home button says what it's for now", () => {
  const src = readFileSync(path.join(ROOT, "app/page.tsx"), "utf8");
  assert.match(src, /href="\/redeem"/);
  assert.match(src, /Got an old MOP card\? Claim it/);
  assert.doesNotMatch(src, /Redeem a Coupon Code/);
});
