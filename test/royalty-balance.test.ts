// Royalty balances (John, 2026-10-16): lifetime owed (royalties.jsonl) − refunds −
// payouts (the append-only royalty-payouts.jsonl) per artist, in the monthly email,
// and the CLI that records a payout or a refunded order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { balances, entriesInMonth, knownArtists, readJsonl as readLog, summarize, summaryEmail } from "../scripts/royalty-summary.mjs";
import { appendEntries, parseAmount, parseDate, payoutEntry, refundEntries } from "../scripts/royalty-payout.mjs";
import { readJsonl, tmpDir } from "./helpers.ts";

const row = (artist: string, at: string, amount = 1.5, extra: Record<string, unknown> = {}) => ({
  at,
  artist,
  amount,
  qty: 1,
  per_item: amount,
  product: "Day · Pelican All-Over",
  slug: "day-all-over",
  options: { style: "beanie", size: "M" },
  order_ref: "mop-a",
  livemode: true,
  ...extra,
});
const pay = (artist: string, amount: number, date: string, extra: Record<string, unknown> = {}) => ({
  type: "payout",
  artist,
  amount,
  date,
  recorded_at: `${date}T20:00:00.000Z`,
  ...extra,
});

// The live ledger on 10/16: Janette $3.00 (two items), Austin $1.50, Sunshine nothing yet.
const LIVE = [
  row("austin", "2026-10-13T17:48:28.039Z", 1.5, { slug: "dusk-all-over", product: "Dusk · Alpaca All-Over", order_ref: "mop-1" }),
  row("janette", "2026-10-13T17:48:28.039Z", 1.5, { order_ref: "mop-1" }),
  row("janette", "2026-10-15T13:59:02.488Z", 1.5, { slug: "pelican-tee", product: "Pelican Tee", order_ref: "mop-2" }),
];

test("balance = lifetime owed − paid per artist; artists with nothing show $0", () => {
  const b = balances(LIVE, [], { artists: ["austin", "janette", "sunshine"] });
  assert.deepEqual(b.map((x) => [x.artist, x.owed, x.paid, x.balance]), [
    ["janette", 3, 0, 3],
    ["austin", 1.5, 0, 1.5],
    ["sunshine", 0, 0, 0],
  ]);
  assert.equal(b[0].since, "2026-10-13");
  assert.equal(b[0].items, 2);
  assert.equal(b[2].since, undefined);
});

test("payouts come off the balance, in cents (no float drift), across months", () => {
  const rows = [
    ...LIVE,
    row("janette", "2026-11-02T18:00:00Z", 0.1, { order_ref: "mop-3" }),
    row("janette", "2026-11-03T18:00:00Z", 0.2, { order_ref: "mop-4" }),
  ];
  const payouts = [pay("janette", 3, "2026-11-01", { note: "Venmo" }), pay("austin", 1.5, "2026-11-01")];
  const b = balances(rows, payouts);
  const j = b.find((x) => x.artist === "janette")!;
  assert.equal(j.owed, 3.3);
  assert.equal(j.paid, 3);
  assert.equal(j.balance, 0.3);
  const a = b.find((x) => x.artist === "austin")!;
  assert.equal(a.balance, 0);
});

test("refund entries reduce what's owed; test-mode rows and refunds are left out unless asked", () => {
  const rows = [...LIVE, row("sunshine", "2026-10-14T18:00:00Z", 1.5, { livemode: false, order_ref: "mop-t" })];
  const payouts = [
    { type: "refund", artist: "janette", amount: 1.5, date: "2026-10-20", order_ref: "mop-2", livemode: true },
    { type: "refund", artist: "sunshine", amount: 1.5, date: "2026-10-20", order_ref: "mop-t", livemode: false },
    { type: "something-else", artist: "janette", amount: 99, date: "2026-10-20" },
  ];
  const j = balances(rows, payouts).find((x) => x.artist === "janette")!;
  assert.deepEqual([j.earned, j.refunded, j.owed, j.paid, j.balance], [3, 1.5, 1.5, 0, 1.5]);
  assert.equal(balances(rows, payouts).find((x) => x.artist === "sunshine"), undefined);
  const s = balances(rows, payouts, { includeTest: true }).find((x) => x.artist === "sunshine")!;
  assert.equal(s.balance, 0);
  const email = summaryEmail("2026-10", summarize(rows, "2026-10"), { balances: balances(rows, payouts), entries: entriesInMonth(payouts, "2026-10"), asOf: "2026-11-01" });
  assert.match(email.body, /of which refunded/);
  assert.match(email.body, /janette\s+\$1\.50\s+−\$1\.50\s+\$0\.00\s+\$1\.50/);
  assert.match(email.body, /2026-10-20  janette  refund −\$1\.50  mop-2/);
  assert.doesNotMatch(email.body, /mop-t/, "test-mode refund left out");
});

test("an overpaid artist shows a negative balance (an advance)", () => {
  const b = balances(LIVE, [pay("austin", 5, "2026-10-16")]).find((x) => x.artist === "austin")!;
  assert.equal(b.balance, -3.5);
  const email = summaryEmail("2026-10", summarize(LIVE, "2026-10"), { balances: balances(LIVE, [pay("austin", 5, "2026-10-16")]), asOf: "2026-11-01" });
  assert.match(email.body, /austin\s+\$1\.50\s+\$5\.00\s+−\$3\.50/);
  assert.match(email.body, /negative balance/);
});

test("the monthly email: the month's detail, its payouts/refunds, then the balance table", () => {
  const payouts = [pay("janette", 1.5, "2026-10-16", { note: "Venmo @janette" })];
  const month = summarize(LIVE, "2026-10");
  const email = summaryEmail("2026-10", month, {
    balances: balances(LIVE, payouts, { artists: knownArtists() }),
    entries: entriesInMonth(payouts, "2026-10"),
    asOf: "2026-11-01",
  });
  assert.equal(email.subject, "MOP royalties for October 2026: janette $3.00, austin $1.50 (due now: $3.00)");
  assert.match(email.body, /Total for October 2026: \$4\.50/);
  assert.match(email.body, /2026-10-16  janette  paid \$1\.50  \(Venmo @janette\)/);
  assert.match(email.body, /Balance per artist as of 2026-11-01 \(lifetime: every royalty since the first, 2026-10-13\)/);
  assert.match(email.body, /austin\s+\$1\.50\s+\$0\.00\s+\$1\.50/);
  assert.match(email.body, /janette\s+\$3\.00\s+\$1\.50\s+\$1\.50/);
  assert.match(email.body, /sunshine\s+\$0\.00\s+\$0\.00\s+\$0\.00/);
  assert.match(email.body, /Total due now: \$3\.00/);
  assert.doesNotMatch(email.body, /of which refunded/, "no refund column when there are none");
  // a payout dated in another month isn't in this month's list (it's still in the balance)
  assert.deepEqual(entriesInMonth([pay("janette", 1, "2026-11-01")], "2026-10"), []);
});

test("the catalog's royalty artists are found by name", () => {
  assert.deepEqual(knownArtists().filter((a) => ["austin", "janette", "sunshine"].includes(a)), ["austin", "janette", "sunshine"]);
});

test("payout input checks: amount, date, artist, balance", () => {
  const now = new Date("2026-10-16T19:00:00Z");
  const ctx = { rows: LIVE, payouts: [], known: ["austin", "janette", "sunshine"], now, by: "john" };
  assert.equal(parseAmount("3"), 3);
  assert.equal(parseAmount("$1.50"), 1.5);
  for (const bad of ["", "abc", "1.505", "0", "-1", "1e3"]) assert.throws(() => parseAmount(bad), /amount/, bad);
  assert.equal(parseAmount("-1.50", { allowNegative: true }), -1.5);
  assert.equal(parseDate(undefined, now), "2026-10-16");
  assert.throws(() => parseDate("2026-10-17", now), /future/);
  assert.throws(() => parseDate("2026-02-30", now), /bad --date/);
  assert.throws(() => parseDate("10/16/2026", now), /bad --date/);

  const e = payoutEntry({ artist: "Janette", amount: "3.00", note: "Venmo" }, ctx);
  assert.deepEqual(e, { type: "payout", artist: "janette", amount: 3, date: "2026-10-16", note: "Venmo", recorded_at: now.toISOString(), recorded_by: "john" });
  assert.throws(() => payoutEntry({ artist: "janet", amount: "1" }, ctx), /unknown artist "janet"/);
  assert.equal(payoutEntry({ artist: "janet", amount: "1", force: true }, { ...ctx, rows: [...LIVE, row("janet", "2026-10-13T18:00:00Z")] }).artist, "janet");
  assert.throws(() => payoutEntry({ artist: "austin", amount: "2.00" }, ctx), /more than austin's balance \(\$1\.50\)/);
  assert.equal(payoutEntry({ artist: "austin", amount: "2.00", force: true }, ctx).amount, 2);
  assert.throws(() => payoutEntry({ artist: "sunshine", amount: "1" }, ctx), /balance \(\$0\.00\)/);
  assert.throws(() => payoutEntry({ artist: "janette" }, ctx), /amount/);
  assert.throws(() => payoutEntry({ amount: "1" }, ctx), /--artist is required/);
  // undoing a wrong payout: negative, only with --correct and a note
  assert.throws(() => payoutEntry({ artist: "janette", amount: "-3" }, ctx), /amount/);
  assert.throws(() => payoutEntry({ artist: "janette", amount: "-3", correct: true }, ctx), /--note/);
  const fix = payoutEntry({ artist: "janette", amount: "-3", correct: true, note: "recorded twice" }, ctx);
  assert.equal(fix.amount, -3);
  assert.equal(fix.correction, true);
  assert.equal(balances(LIVE, [e, e, fix]).find((x) => x.artist === "janette")!.balance, 0);
});

test("a refunded order: one entry per artist; a second refund of the same order is refused", () => {
  const now = new Date("2026-10-20T19:00:00Z");
  const rows = [...LIVE, row("janette", "2026-10-15T13:59:02.488Z", 1.5, { slug: "day-all-over", order_ref: "mop-2" })];
  const all = refundEntries({ order: "mop-1", note: "Stripe refund" }, { rows, payouts: [], now });
  assert.deepEqual(all.map((e) => [e.type, e.artist, e.amount, e.order_ref, e.date, e.livemode]), [
    ["refund", "austin", 1.5, "mop-1", "2026-10-20", true],
    ["refund", "janette", 1.5, "mop-1", "2026-10-20", true],
  ]);
  assert.throws(() => refundEntries({ order: "mop-1" }, { rows, payouts: all, now }), /already refunded/);
  assert.throws(() => refundEntries({ order: "mop-nope" }, { rows, payouts: [], now }), /no royalty rows/);
  // part of a bag: only the pelican tee of mop-2 (janette has two items in it)
  const part = refundEntries({ order: "mop-2", slug: "pelican-tee" }, { rows, payouts: [], now });
  assert.deepEqual(part.map((e) => [e.artist, e.amount, e.slug]), [["janette", 1.5, "pelican-tee"]]);
  const rest = refundEntries({ order: "mop-2" }, { rows, payouts: part, now });
  assert.deepEqual(rest.map((e) => [e.artist, e.amount]), [["janette", 1.5]]);
  assert.throws(() => refundEntries({ order: "mop-2" }, { rows, payouts: [...part, ...rest], now }), /already refunded/);
  const j = balances(rows, [...part, ...rest]).find((x) => x.artist === "janette")!;
  assert.deepEqual([j.earned, j.refunded, j.owed], [4.5, 3, 1.5]);
});

test("the payouts log is append-only and created 0640", () => {
  const dir = tmpDir();
  const file = path.join(dir, "royalty-payouts.jsonl");
  appendEntries(file, [pay("janette", 1, "2026-10-16")]);
  assert.equal(statSync(file).mode & 0o777, 0o640);
  appendEntries(file, [pay("austin", 1.5, "2026-10-16"), pay("janette", 2, "2026-10-16")]);
  assert.deepEqual(readJsonl(file).map((e) => [e.artist, e.amount]), [["janette", 1], ["austin", 1.5], ["janette", 2]]);
  writeFileSync(file, readFileSync(file, "utf8") + "not json\n");
  const bad: string[] = [];
  assert.equal(readLog(file, (l: string) => bad.push(l)).length, 3);
  assert.deepEqual(bad, ["not json"]);
});

test("CLI: --dry-run writes nothing; a payout appends one line; the summary shows the new balance", () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, "royalties.jsonl"), LIVE.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const env = { ...process.env, MOP_DATA_DIR: dir, PINGPIGEON_TOKEN: "" };
  const run = (script: string, args: string[]) =>
    execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join("scripts", script), ...args], { env, encoding: "utf8" });
  const file = path.join(dir, "royalty-payouts.jsonl");
  const dry = run("royalty-payout.mjs", ["--artist", "janette", "--amount", "1.50", "--date", "2026-10-16", "--note", "Venmo", "--dry-run"]);
  assert.match(dry, /janette: owed \$3\.00 · paid \$1\.50 · balance \$1\.50/);
  assert.match(dry, /dry run: nothing written/);
  assert.equal(existsSync(file), false);
  run("royalty-payout.mjs", ["--artist", "janette", "--amount", "1.50", "--date", "2026-10-16", "--note", "Venmo"]);
  assert.equal(readJsonl(file).length, 1);
  assert.throws(() => run("royalty-payout.mjs", ["--artist", "austin", "--amount", "9", "--date", "2026-10-16"]), /more than austin's balance/);
  assert.equal(readJsonl(file).length, 1, "a refused payout writes nothing");
  const out = run("royalty-summary.mjs", ["--month", "2026-10", "--dry-run"]);
  assert.match(out, /^Subject: MOP royalties for October 2026: janette \$3\.00, austin \$1\.50 \(due now: \$3\.00\)/);
  assert.match(out, /janette\s+\$3\.00\s+\$1\.50\s+\$1\.50/);
});
