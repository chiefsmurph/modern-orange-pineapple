// POST /api/validate-code — retired (10/13): /redeem now uses /api/legacy-claim/lookup,
// which also accepts old card codes that were lost from codes.json, with a rate limit.
export function POST() {
  return Response.json({ valid: false, error: "Please use the form at /redeem." }, { status: 410 });
}
