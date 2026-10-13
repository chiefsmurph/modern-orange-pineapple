// /feeds/google.xml — the Google Merchant Center feed (lib/google-feed.ts),
// built once at build time from the catalog (re-deploy to refresh it).
import { shopProducts } from "@/lib/catalog";
import { googleFeedXml } from "@/lib/google-feed";

export const dynamic = "force-static";

export function GET() {
  return new Response(googleFeedXml(shopProducts), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
