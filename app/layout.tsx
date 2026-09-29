import { QueryProvider } from "@/components/QueryProvider";
import { Analytics } from "@/components/Analytics";
import "./globals.css";
import SmartBackground from "@/components/SmartBackground";

export const metadata = {
  title: "MOP Clothing",
  description: "Escape the Ordinary—Own a Collectible Piece of Paradise.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
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
        <QueryProvider>{children}</QueryProvider>
        <Analytics />
        <SmartBackground/>
        <div className="overlay" />
      </body>
    </html>
  );
}
