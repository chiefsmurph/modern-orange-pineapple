import { QueryProvider } from "@/components/QueryProvider";
import { Analytics } from "@/components/Analytics";
import PaidEngagement from "@/components/PaidEngagement";
import BagButton from "@/components/BagButton";
import { Orbitron } from "next/font/google";
import type { Viewport } from "next";
import "./globals.css";
import { UMAMI_BEFORE_SEND, UMAMI_BEFORE_SEND_JS, UMAMI_HOST, UMAMI_WEBSITE_ID } from "@/lib/umami";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, shareMeta } from "@/lib/share-meta";

// Self-hosted at build time by next/font: no render-blocking Google Fonts @import.
// Same single 500 weight as before (bold text is synthesized, exactly as it was).
// No metric-adjusted fallback face: glyphs Orbitron lacks (e.g. "²") keep
// falling back to the plain sans-serif, exactly as before.
const orbitron = Orbitron({
  weight: "500",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-orbitron",
  adjustFontFallback: false,
});

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "MOP Clothing",
  description: SITE_DESCRIPTION,
  // Link previews (Instagram DMs, Messages, Facebook, X...): the designed home image.
  // Product pages and the other pages set their own (lib/share-meta.ts).
  ...shareMeta({ title: SITE_NAME, description: SITE_DESCRIPTION }),
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  manifest: "/manifest.json",
  // Google Merchant Center / Search Console: <meta name="google-site-verification"> when set.
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
    : {}),
  // Meta (Instagram Shop): <meta name="facebook-domain-verification"> when set.
  ...(process.env.META_DOMAIN_VERIFICATION
    ? { other: { "facebook-domain-verification": process.env.META_DOMAIN_VERIFICATION } }
    : {}),
};

// Browser chrome tint (status bar / Android address bar) = the sky's top edge.
// The page background (globals.css) covers the bottom edge and overscroll.
export const viewport: Viewport = {
  themeColor: "#dae1e2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={orbitron.variable}>
      <head>
        {/* self-visit opt-out: ?nostats to disable Umami on THIS browser; ?nostats=off to re-enable */}
        <script dangerouslySetInnerHTML={{ __html: "(function(){var m=/[?&]nostats(=([^&#]*))?/i.exec(location.search);if(!m)return;var off=(m[2]||\"\").toLowerCase()===\"off\";try{off?localStorage.removeItem(\"umami.disabled\"):localStorage.setItem(\"umami.disabled\",\"1\");}catch(e){}window.addEventListener(\"DOMContentLoaded\",function(){var b=document.createElement(\"div\");b.textContent=(off?\"✓ Umami tracking re-enabled\":\"✓ Umami tracking disabled\")+\" on this browser\";b.style.cssText=\"position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#15C7E6;color:#012;font:600 14px/1.4 system-ui,-apple-system,sans-serif;padding:12px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)\";document.body.appendChild(b);});})();" }} />

        {/* Product pages: mark the main photo's frame ready the moment its photo
            loads, even before React hydrates (components/CatalogGallery.tsx). */}
        <script dangerouslySetInnerHTML={{ __html: "(function(){function m(e){var t=e.target;if(t&&t.hasAttribute&&t.hasAttribute('data-main-photo')&&t.parentNode)t.parentNode.setAttribute('data-ready','')}document.addEventListener('load',m,true);document.addEventListener('error',m,true)})();" }} />
        <noscript>
          <style>{"[data-main-photo]{opacity:1!important}"}</style>
        </noscript>

        {/* Umami: picks on a product page rewrite the query but aren't new page views (lib/umami.ts). */}
        <script dangerouslySetInnerHTML={{ __html: UMAMI_BEFORE_SEND_JS }} />
        {/* the visit's utm_source, kept for the tab so a like on a later page still knows where the visit came from (lib/likes.ts) */}
        <script dangerouslySetInnerHTML={{ __html: "(function(){try{var s=new URLSearchParams(location.search).get('utm_source');if(s&&!sessionStorage.getItem('mop-src'))sessionStorage.setItem('mop-src',s.slice(0,40))}catch(e){}})();" }} />
        <script
          defer
          src={`${UMAMI_HOST}/script.js`}
          data-website-id={UMAMI_WEBSITE_ID}
          data-before-send={UMAMI_BEFORE_SEND}
        />
      </head>
      <body>
        {/* Static sky/sea backdrop (13 KB WebP / 8.5 KB AVIF) — replaces the 8.8 MB autoplay video. */}
        <div className="site-bg" aria-hidden="true" />
        <QueryProvider>{children}</QueryProvider>
        {/* the shopping bag, top right on every page */}
        <BagButton />
        <Analytics />
        {/* seen / looked-at time / scroll depth, PopAds visits only (lib/paid-engagement.ts) */}
        <PaidEngagement />
      </body>
    </html>
  );
}
