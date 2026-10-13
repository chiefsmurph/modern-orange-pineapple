// POST /api/redeem — retired (10/13): old card codes are now claimed with a photo for John
// to check (/api/legacy-claim, lib/legacy-claims.ts). Marking a code redeemed here without
// that check would skip it, so this only says where to go.
export function POST() {
  return Response.json({ success: false, error: "Please use the form at /redeem." }, { status: 410 });
}
