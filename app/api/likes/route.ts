// GET /api/likes?slug=sky-tee -> { count } (null below 10), POST /api/likes = a "♡ I'd wear this" tap (lib/likes.ts).
import { NextRequest, NextResponse, after } from "next/server";
import {
  LIKE_EMAILS_PER_DAY,
  createDailyCap,
  geoFrom,
  handleLike,
  likeEmail,
  likeStore,
  shownCount,
  type LikeRow,
} from "@/lib/likes";
import { sendEmail } from "@/lib/orders/notify";
import { valueLabel } from "@/lib/catalog/copy";
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

// A like email to John for each new like from a real person (John 10/21), at most 25 a day.
const capEmails = createDailyCap(LIKE_EMAILS_PER_DAY);

/** "Sky Tee" and "Milky Way" for a like row (catalog labels; old products have no picks worth naming). */
const describe = (row: LikeRow) => {
  const p = getShopProduct(row.slug);
  const title = p?.title ?? legacy.products.find((x) => x.id === row.slug)?.title ?? row.slug;
  const picks = new URLSearchParams(row.design);
  const designLabel = Array.from(picks.entries()).map(([k, v]) => valueLabel(k, v, p?.optionLabels)).join(" · ") || undefined;
  const url = `https://mopclothing.com/${row.slug}${row.design ? `?${row.design}` : ""}`;
  return { title, designLabel, url };
};

const notify = async (row: LikeRow, count: number) => {
  if (!capEmails()) return console.log(`[likes] email cap (${LIKE_EMAILS_PER_DAY}/day) reached; not emailing ${row.slug}`);
  const r = await sendEmail(likeEmail(row, { ...describe(row), count }), {
    env: process.env,
    fetch: (u, i) => fetch(u, i),
    log: (m) => console.log(m),
  });
  if (!r.ok) throw new Error(r.error ?? "send failed");
};

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
    { ip: clientIp(req.headers), userAgent: req.headers.get("user-agent"), geo: geoFrom(req.headers) },
    { store: likeStore(dataDir()), allow, optionsFor, now: () => new Date(), log: (m) => console.log(m), notify }
  );
  // the email goes out after the response, so it never slows or fails the tap
  if (result.after) after(result.after);
  return NextResponse.json(result.body, { status: result.status, headers: noStore });
}
