// GET /api/all — retired (10/13): the old redeem-code admin is gone. It listed codes.json
// to anyone who asked; old card codes are now claims John checks through signed links
// (lib/legacy-claims.ts), and new codes are per order (lib/item-codes.ts).
export function GET() {
  return Response.json({ error: "gone" }, { status: 410 });
}
