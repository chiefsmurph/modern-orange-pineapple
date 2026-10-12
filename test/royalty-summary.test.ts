import { test } from "node:test";
import assert from "node:assert/strict";
import { previousMonth, summarize, summaryEmail } from "../scripts/royalty-summary.mjs";

const row = (artist: string, at: string, amount = 1.5, extra = {}) => ({
  at,
  artist,
  amount,
  qty: 1,
  per_item: amount,
  product: "Pelican Tee",
  options: { style: "beanie", size: "M" },
  order_ref: "mop-x",
  livemode: true,
  ...extra,
});

test("previous month is computed in Pacific time", () => {
  assert.equal(previousMonth(new Date("2026-11-01T15:00:00Z")), "2026-10");
  // 2026-11-01 05:00 UTC is still Oct 31 in LA, so "last month" is September
  assert.equal(previousMonth(new Date("2026-11-01T05:00:00Z")), "2026-09");
  assert.equal(previousMonth(new Date("2027-01-01T20:00:00Z")), "2026-12");
});

test("per-artist totals for the month, test-mode orders left out", () => {
  const rows = [
    row("janette", "2026-10-03T18:00:00Z"),
    row("janette", "2026-10-20T18:00:00Z", 3, { qty: 2 }),
    row("austin", "2026-10-31T23:30:00Z"), // still Oct 31 in LA
    row("austin", "2026-11-01T08:30:00Z"), // Nov 1 in LA
    row("sunshine", "2026-10-05T18:00:00Z", 1.5, { livemode: false }),
  ];
  const s = summarize(rows, "2026-10");
  assert.deepEqual(s.map((a) => [a.artist, a.items, a.amount]), [
    ["janette", 3, 4.5],
    ["austin", 1, 1.5],
  ]);
  assert.equal(summarize(rows, "2026-10", { includeTest: true }).length, 3);
  const email = summaryEmail("2026-10", s);
  assert.equal(email.subject, "MOP royalties for October 2026: janette $4.50, austin $1.50");
  assert.match(email.body, /Total: \$6\.00/);
  assert.match(summaryEmail("2026-09", []).subject, /none$/);
});
