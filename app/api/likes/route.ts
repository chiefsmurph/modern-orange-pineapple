// GET /api/likes?slug=sky-tee -> { count } (null below 10), POST /api/likes = a "♡ I'd wear this" tap (lib/likes.ts).
import { NextRequest, NextResponse } from "next/server";
import { handleLike, likeStore, shownCount } from "@/lib/likes";
import { clientIp, createRateLimiter } from "@/lib/subscribers";
import { dataDir } from "@/lib/orders/store";
import { getShopProduct } from "@/lib/catalog";
import legacy from "@/public/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 30 taps per 10 minutes per visitor (salted, in-memory IP hash): plenty for a person picking skies.
const allow = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

/** The picker options of a product on sale (generated line-up or public/products.ts). */
const optionsFor = (slug: string) => {
  const p = getShopProduct(slug);
  if (p) return p.options;
  const old = legacy.products.find((x) => x.id === slug && !x.retired);
  return old ? old.options : undefined;
};

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  if (!optionsFor(slug)) return NextResponse.json({ ok: false, error: "no such product" }, { status: 404, headers: noStore });
  const n = await likeStore(dataDir()).count(slug);
  return NextResponse.json({ ok: true, count: shownCount(n) }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const result = await handleLike(
    body,
    { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") },
    { store: likeStore(dataDir()), allow, optionsFor, now: () => new Date(), log: (m) => console.log(m) }
  );
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}
