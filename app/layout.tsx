import { QueryProvider } from "@/components/QueryProvider";
import { Analytics } from "@/components/Analytics";
import { Orbitron } from "next/font/google";
import type { Viewport } from "next";
import "./globals.css";

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
  title: "MOP Clothing",
  description: "Escape the Ordinary—Own a Collectible Piece of Paradise.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  manifest: "/manifest.json",
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

        <script
          defer
          src="https://stats.chiefsmurph.com/script.js"
          data-website-id="ba4cac44-a005-45f5-8d24-3b897178364c"
        />
      </head>
      <body>
        {/* Static sky/sea backdrop (13 KB WebP / 8.5 KB AVIF) — replaces the 8.8 MB autoplay video. */}
        <div className="site-bg" aria-hidden="true" />
        <QueryProvider>{children}</QueryProvider>
        <Analytics />
      </body>
    </html>
  );
}
