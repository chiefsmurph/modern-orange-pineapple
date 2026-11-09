// Site-wide footer: Instagram + Etsy links, rendered on every page (app/layout.tsx).
// Plain <a> tags (no client JS needed) except for the Umami click tracking,
// which is fire-and-forget and never blocks navigation (lib/umami.ts).
"use client";
import { INSTAGRAM_URL, ETSY_URL } from "@/lib/structured-data";
import { track } from "@/lib/umami";
import styles from "./SiteFooter.module.css";

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
      <circle cx="12" cy="12" r="4.3" />
      <circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <a
        href={INSTAGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.instagram}
        data-umami-event="instagram-click"
        data-umami-event-source="footer"
        onClick={() => track("instagram-click", { source: "footer" })}
      >
        <InstagramIcon />
        <span>@mopclothingco</span>
      </a>
      <a href={ETSY_URL} target="_blank" rel="noopener noreferrer" className={styles.etsy}>
        Shop on Etsy
      </a>
    </footer>
  );
}
