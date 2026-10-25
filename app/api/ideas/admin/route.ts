// POST /api/ideas/admin (form: id, action, sig, + notes / payout / productUrl / sendEmail) —
// John's buttons on /moderate/ideas: Approve, Deny, Mark launched, Save notes. Each
// form carries its own signed `sig` (MOP_LINK_SECRET), like the other /moderate
// pages; a wrong one is a 404. Back to the review page afterwards (303).
import { NextRequest, NextResponse } from "next/server";
import { handleIdeaAdmin, ideaStore, ideasAdminUrl } from "@/lib/ideas-server";
import { dataDir } from "@/lib/orders/store";
import { linkSecret, siteUrl } from "@/lib/register-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const get = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const secret = linkSecret();
  const dir = dataDir();
  const r = await handleIdeaAdmin(
    { id: get("id"), action: get("action"), sig: get("sig"), notes: get("notes"), payout: get("payout"), productUrl: get("productUrl"), sendEmail: get("sendEmail") },
    {
      store: ideaStore(dir),
      dir,
      linkSecret: secret,
      env: process.env,
      fetch: (u, i) => fetch(u, i),
      now: () => new Date(),
      log: (m) => console.log(m),
    }
  );
  if (r.status === 404) return new NextResponse("Not found", { status: 404 });
  // the filter John was looking at, kept from the page's form
  const filter = get("filter");
  const back = ideasAdminUrl(siteUrl(), secret, {
    status: filter && /^[a-z]+$/.test(filter) ? filter : undefined,
    id: r.status === 400 ? r.id : r.idea.id,
    ...(r.status === 200 ? { saved: r.idea.id, email: r.email } : {}),
  })!;
  const u = new URL(back);
  // which idea's launch link was missing (the page shows its own message for it)
  if (r.status === 400) u.searchParams.set("failed", r.id);
  return NextResponse.redirect(u, 303);
}
