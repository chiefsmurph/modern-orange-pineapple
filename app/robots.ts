// /robots.txt. /meta-checkout only ever redirects a Meta Shops cart to Stripe: nothing to crawl.
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/meta-checkout"] } };
}
