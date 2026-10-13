// /feeds/meta.xml — the product feed for Meta Commerce Manager (Instagram Shop),
// built at build time; see lib/google-feed.ts for how it differs from Google's.
import { shopProducts } from "@/lib/catalog";
import { googleFeedXml } from "@/lib/google-feed";

export const dynamic = "force-static";

export function GET() {
  return new Response(googleFeedXml(shopProducts, new Date(), "meta"), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
