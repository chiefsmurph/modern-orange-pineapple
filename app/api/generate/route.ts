// POST /api/generate — retired (10/13): the old redeem-code admin is gone. It made codes
// for anyone who asked; new codes are made per order by the webhook (lib/item-codes.ts).
export function POST() {
  return Response.json({ error: "gone" }, { status: 410 });
}
