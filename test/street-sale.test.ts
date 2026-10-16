// Street sales (John, 2026-10-16): shirts sold in person (car, markets; cash or
// Venmo) are logged with scripts/street-sale.mjs. Their royalties go into
// royalties.jsonl in the webhook's row format (source "street"), so the monthly
// email and the balances include them; each sale also goes to street-sales.jsonl.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { balances, summarize, summaryEmail } from "../scripts/royalty-summary.mjs";
import { refundEntries } from "../scripts/royalty-payout.mjs";
import { findProduct, normalizeSize, parseArgs, streetRef, streetSale } from "../scripts/street-sale.mjs";
import { royaltyRows, rulesFor } from "../lib/orders/royalties.ts";
import { readJsonl, tmpDir } from "./helpers.ts";

const NOW = new Date("2026-10-17T22:00:00Z"); // Sat 10/17, 3 PM in LA
const sale = (input: Record<string, unknown>, ctx: Record<string, unknown> = {}) =>
  streetSale({ qty: "1", price: "25", ...input }, { now: NOW, ref: "street-20261017-abc123", env: {}, ...ctx });

test("the website's royalty rules: alpaca → austin, star → sunshine, beanie pelican → janette, $1.50 each", () => {
  const a = sale({ product: "alpaca", size: "M" }).rows;
  assert.deepEqual(a.map((r) => [r.artist, r.per_item, r.amount]), [["austin", 1.5, 1.5]]);
  assert.deepEqual(sale({ product: "star", size: "L", qty: "2" }).rows.map((r) => [r.artist, r.qty, r.amount]), [["sunshine", 2, 3]]);
  assert.deepEqual(sale({ product: "pelican", style: "beanie", size: "XL" }).rows.map((r) => [r.artist, r.amount]), [["janette", 1.5]]);
  // the classic pelican and the rabbit carry no royalty, but the sale is still logged
  const classic = sale({ product: "pelican", style: "classic", size: "M" });
  assert.deepEqual(classic.rows, []);
  assert.deepEqual(classic.sale.royalties, []);
  assert.deepEqual(sale({ product: "rabbit", size: "M" }).rows, []);
  // full slugs work as well as the short names; same rules as rulesFor
  assert.deepEqual(sale({ product: "alpaca-tee", size: "M" }).rows.map((r) => r.artist), rulesFor("alpaca-tee").map((r) => r.artist));
  assert.deepEqual(sale({ product: "star-polo", size: "M" }).rows.map((r) => r.artist), ["sunshine"]);
  // MOP_ROYALTY_RATES overrides apply, as on the website
  assert.equal(sale({ product: "alpaca", size: "M" }, { env: { MOP_ROYALTY_RATES: "austin=2" } }).rows[0].amount, 2);
});

test("a street row has the webhook's royalty-row format, plus source street and the place", () => {
  const { rows, sale: s } = sale({ product: "pelican", style: "beanie", size: "M", place: "Pacific Beach", paid: "Venmo", color: "Lagoon Blue" });
  const web = royaltyRows(
    { session_id: "cs_x", order_ref: "mop-x", livemode: true, items: [{ slug: "pelican-tee", title: "Pelican Tee", qty: 1, opts: { style: "beanie", size: "M" } }] } as any,
    NOW.toISOString(),
    {}
  )[0];
  assert.deepEqual(Object.keys(rows[0]).filter((k) => k !== "source" && k !== "place").sort(), Object.keys(web).sort());
  assert.deepEqual(rows[0], {
    at: NOW.toISOString(),
    session_id: "street-20261017-abc123",
    order_ref: "street-20261017-abc123",
    artist: "janette",
    per_item: 1.5,
    qty: 1,
    amount: 1.5,
    product: "Pelican Tee",
    slug: "pelican-tee",
    options: { style: "beanie", color: "Lagoon Blue", size: "M" },
    livemode: true,
    source: "street",
    place: "Pacific Beach",
  });
  assert.deepEqual(
    { ...s, recorded_at: undefined },
    {
      type: "street_sale",
      date: "2026-10-17",
      at: NOW.toISOString(),
      order_ref: "street-20261017-abc123",
      slug: "pelican-tee",
      product: "Pelican Tee",
      options: { style: "beanie", color: "Lagoon Blue", size: "M" },
      qty: 1,
      price_each: 25,
      total: 25,
      place: "Pacific Beach",
      paid: "venmo",
      royalties: [{ artist: "janette", amount: 1.5 }],
      recorded_at: undefined,
    }
  );
  // an earlier day is dated midday Pacific, so the email's (Pacific) month is right
  assert.equal(sale({ product: "alpaca", size: "M", date: "2026-10-31" }, { now: new Date("2026-11-02T18:00:00Z") }).rows[0].at, "2026-10-31T20:00:00.000Z");
  assert.match(streetRef("2026-10-17"), /^street-20261017-[0-9a-f]{6}$/);
});

test("bad input is refused with a clear message", () => {
  assert.throws(() => sale({ product: "pelican", size: "M" }), /--style is required for pelican-tee/);
  assert.throws(() => sale({ product: "pelican", style: "grind", size: "M" }), /bad --style/);
  assert.throws(() => sale({ product: "alpaca", style: "beanie", size: "M" }), /has no style/);
  assert.throws(() => sale({ product: "sloth", size: "M" }), /unknown --product sloth/);
  assert.throws(() => sale({ product: "alpaca", size: "XXS" }), /bad --size/);
  assert.throws(() => sale({ product: "alpaca", size: "M", qty: "0" }), /bad --qty/);
  assert.throws(() => sale({ product: "alpaca", size: "M", price: undefined }), /--price is required/);
  assert.throws(() => sale({ product: "alpaca", size: "M", price: "ten" }), /bad --price/);
  assert.throws(() => sale({ product: "alpaca", size: "M", date: "2026-10-18" }), /in the future/);
  assert.throws(() => parseArgs(["--product"]), /--product needs a value/);
  assert.throws(() => parseArgs(["--colour", "x"]), /unknown argument --colour/);
  assert.equal(normalizeSize("xxl"), "2XL");
  assert.equal(normalizeSize("m"), "M");
  assert.equal(findProduct("Star").slug, "original-star-tee");
  // the snapback's only size is filled in
  assert.equal(sale({ product: "star-snapback" }).sale.options.size, "One size");
});

test("the same sale twice on one day needs --again", () => {
  const first = sale({ product: "alpaca", size: "M", place: "PB" }).sale;
  assert.throws(() => sale({ product: "alpaca", size: "M", place: "PB" }, { sales: [first] }), /already logged: street-20261017-abc123/);
  assert.equal(sale({ product: "alpaca", size: "M", place: "PB", again: true }, { sales: [first] }).rows.length, 1);
  // a different size / place / day is a different sale
  assert.equal(sale({ product: "alpaca", size: "L", place: "PB" }, { sales: [first] }).rows.length, 1);
  assert.equal(sale({ product: "alpaca", size: "M", place: "OB" }, { sales: [first] }).rows.length, 1);
});

test("the monthly email counts street sales with the website's and shows them apart", () => {
  const web = { at: "2026-10-05T18:00:00Z", artist: "austin", amount: 1.5, qty: 1, per_item: 1.5, product: "Alpaca Tee", slug: "alpaca-tee", options: { size: "M" }, order_ref: "mop-a", livemode: true };
  const street = [
    ...sale({ product: "alpaca", size: "L", qty: "2", place: "Pacific Beach" }).rows,
    ...sale({ product: "pelican", style: "beanie", size: "M", place: "Morro Bay" }, { ref: "street-20261017-def456" }).rows,
  ];
  const s = summarize([web, ...street], "2026-10");
  assert.deepEqual(s.map((a) => [a.artist, a.items, a.street, a.amount]), [
    ["austin", 3, 2, 4.5],
    ["janette", 1, 1, 1.5],
  ]);
  const email = summaryEmail("2026-10", s);
  assert.equal(email.subject, "MOP royalties for October 2026: austin $4.50, janette $1.50");
  assert.match(email.body, /austin: \$4\.50 for 3 items \(street sales: 2 items\)/);
  assert.match(email.body, /janette: \$1\.50 for 1 item \(street sales: 1 item\)/);
  assert.match(email.body, /2026-10-17  2 x Alpaca Tee \(L\)  \$3\.00  street-20261017-abc123  street sale, Pacific Beach/);
  assert.match(email.body, /2026-10-05  1 x Alpaca Tee \(M\)  \$1\.50  mop-a\n/, "website lines unchanged");
  assert.match(email.body, /Of which street sales: 3 items, \$4\.50/);
  assert.match(email.body, /Total for October 2026: \$6\.00/);
  // a month with only website orders says nothing about street sales
  assert.doesNotMatch(summaryEmail("2026-10", summarize([web], "2026-10")).body, /street sales:/i);
  // balances include them; a street sale logged by mistake comes off with --refund-order
  assert.equal(balances([web, ...street], []).find((b) => b.artist === "austin")!.balance, 4.5);
  const undo = refundEntries({ order: "street-20261017-abc123", note: "logged by mistake" }, { rows: [web, ...street], payouts: [], now: NOW });
  assert.deepEqual(undo.map((e) => [e.artist, e.amount]), [["austin", 3]]);
  assert.equal(balances([web, ...street], undo).find((b) => b.artist === "austin")!.balance, 1.5);
});

test("CLI: --dry-run writes nothing; a sale appends to royalties.jsonl and street-sales.jsonl; the email includes it", () => {
  const dir = tmpDir();
  const web = { at: "2026-10-05T18:00:00Z", artist: "austin", amount: 1.5, qty: 1, per_item: 1.5, product: "Alpaca Tee", slug: "alpaca-tee", options: { size: "M" }, order_ref: "mop-a", livemode: true };
  writeFileSync(path.join(dir, "royalties.jsonl"), JSON.stringify(web) + "\n");
  const env = { ...process.env, MOP_DATA_DIR: dir, PINGPIGEON_TOKEN: "", MOP_ROYALTY_RATES: "" };
  // run as on the box: plain `node`, no flags (the script hides Node's module-type notice itself)
  const run = (script: string, args: string[]) =>
    execFileSync(process.execPath, [path.join("scripts", script), ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const args = ["--product", "alpaca", "--size", "M", "--qty", "2", "--price", "25", "--place", "Pacific Beach", "--paid", "cash", "--date", "2026-10-15"];
  const dry = run("street-sale.mjs", [...args, "--dry-run"]);
  assert.match(dry, /2 x Alpaca Tee \(M\) at \$25\.00 = \$50\.00, Pacific Beach on 2026-10-15/);
  assert.match(dry, /royalty: austin \$3\.00 \(2 x \$1\.50\)/);
  assert.match(dry, /dry run: nothing written/);
  assert.equal(readJsonl(path.join(dir, "royalties.jsonl")).length, 1);
  assert.equal(existsSync(path.join(dir, "street-sales.jsonl")), false);

  const out = run("street-sale.mjs", args);
  assert.match(out, /appended 1 royalty line/);
  const rows = readJsonl(path.join(dir, "royalties.jsonl"));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].source, "street");
  assert.equal(rows[1].at, "2026-10-15T20:00:00.000Z");
  assert.match(rows[1].order_ref, /^street-20261015-[0-9a-f]{6}$/);
  const sales = readJsonl(path.join(dir, "street-sales.jsonl"));
  assert.deepEqual([sales[0].slug, sales[0].qty, sales[0].total, sales[0].paid], ["alpaca-tee", 2, 50, "cash"]);
  // the same command again is refused (and writes nothing); --again logs it
  assert.throws(() => run("street-sale.mjs", args), /already logged/);
  assert.equal(readJsonl(path.join(dir, "street-sales.jsonl")).length, 1);
  // a no-royalty design: only the sales log grows
  run("street-sale.mjs", ["--product", "rabbit", "--size", "L", "--price", "25", "--date", "2026-10-15"]);
  assert.equal(readJsonl(path.join(dir, "royalties.jsonl")).length, 2);
  assert.equal(readJsonl(path.join(dir, "street-sales.jsonl")).length, 2);

  const email = run("royalty-summary.mjs", ["--month", "2026-10", "--dry-run"]);
  assert.match(email, /^Subject: MOP royalties for October 2026: austin \$4\.50/);
  assert.match(email, /austin: \$4\.50 for 3 items \(street sales: 2 items\)/);
  assert.match(email, /Of which street sales: 2 items, \$3\.00/);
});

test("street-sale.mjs run with plain node prints no Node warnings", () => {
  const r = spawnSync(process.execPath, ["scripts/street-sale.mjs", "--product", "star", "--size", "M", "--price", "25", "--dry-run"], {
    env: { ...process.env, MOP_DATA_DIR: tmpDir() },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /royalty: sunshine \$1\.50/);
});
