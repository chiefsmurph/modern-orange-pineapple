// POST /api/moderate/<id> (form: action, sig) — John's approve/hide, from the confirmation
// page at /moderate/<id>. The GET link in his email only shows that page, so a link
// preview can't approve anything. Photo approval makes the web copies (EXIF stripped).
import { NextRequest, NextResponse } from "next/server";
import { makeCrewCopies, verifyModeration, type ModerationAction } from "@/lib/reviews";
import { linkSecret, stores } from "@/lib/register-deps";
import { claimSignature, decideClaim, verifyClaim } from "@/lib/legacy-claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const action = String(form?.get("action") ?? "");
  const sig = String(form?.get("sig") ?? "");
  // Old card claims (lib/legacy-claims.ts): approve / reject, back to the claim's page.
  if (action === "approve-claim" || action === "reject-claim") {
    const secret = linkSecret();
    if (!verifyClaim(id, action, sig, secret)) return new NextResponse("Not found", { status: 404 });
    const s = stores();
    const c = await decideClaim(id, action, { dir: s.dir, claims: s.claims, now: () => new Date() });
    if (!c) return new NextResponse("Not found", { status: 404 });
    console.log(`[moderate] claim ${id}: ${action}`);
    const back = new URL(`/moderate/${id}`, req.nextUrl.origin);
    back.searchParams.set("action", "view-claim");
    back.searchParams.set("sig", claimSignature(id, "view-claim", secret!));
    back.searchParams.set("done", "1");
    return NextResponse.redirect(back, 303);
  }
  if (!verifyModeration(id, action, sig, linkSecret())) return new NextResponse("Not found", { status: 404 });
  const s = stores();
  const r = await s.reviews.moderate(id, action as ModerationAction, new Date().toISOString());
  if (!r) return new NextResponse("Not found", { status: 404 });
  if (action === "approve-photo" && r.photo_status === "approved") {
    try {
      await makeCrewCopies(s.dir, r);
    } catch (err) {
      console.log(`[moderate] ${id}: web copies failed: ${(err as Error).message}`);
    }
  }
  console.log(`[moderate] ${id}: ${action}`);
  const back = new URL(`/moderate/${id}`, req.nextUrl.origin);
  back.searchParams.set("action", action);
  back.searchParams.set("sig", sig);
  back.searchParams.set("done", "1");
  return NextResponse.redirect(back, 303);
}
