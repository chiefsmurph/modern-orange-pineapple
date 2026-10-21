"use client";

// Deeper engagement events for paid visits only (lib/paid-engagement.ts, John 10/21): seen or not,
// looked-at time (visible AND focused) and scroll depth. Renders nothing; does nothing for normal visits.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackOnce } from "@/lib/umami";
import { isPaidSource, marksPassed, scrollMarksReached, scrollPct, seenEventName } from "@/lib/paid-engagement";

const paidVisit = () => {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("utm_source");
    return isPaidSource(window.sessionStorage.getItem("mop-src") || fromUrl);
  } catch {
    return false;
  }
};

// Umami's tracker loads async; an event sent before it's ready is lost, so retry for up to ~15 s.
const send = (key: string, name: string, data?: Record<string, string | number>) => {
  let tries = 0;
  const attempt = () => {
    const ready = typeof (window as unknown as { umami?: { track?: unknown } }).umami?.track === "function";
    if (ready) trackOnce(key, name, data);
    else if (tries++ < 30) setTimeout(attempt, 500);
  };
  attempt();
};

// Looked-at seconds for the whole tab (module state survives page changes inside the site).
let lookedMs = 0;
let seenSent = false;
const loadedAt = typeof performance !== "undefined" ? performance.now() : 0;

export default function PaidEngagement() {
  const path = usePathname();

  useEffect(() => {
    if (!paidVisit()) return;
    const looking = () => document.visibilityState === "visible" && document.hasFocus();
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (looking()) {
        if (!seenSent) {
          seenSent = true;
          const after = Math.round((now - loadedAt) / 1000);
          send("pop-seen", seenEventName(after), { after_s: after, page: path });
        }
        const before = lookedMs / 1000;
        lookedMs += now - last;
        for (const m of marksPassed(before, lookedMs / 1000)) send(`pop-time-${m}`, `pop-time-${m}`, { page: path });
      }
      last = now;
    };
    const timer = window.setInterval(tick, 1000);
    const onScroll = () => {
      const pct = scrollPct(window.scrollY, window.innerHeight, document.documentElement.scrollHeight);
      for (const m of scrollMarksReached(pct)) send(`pop-scroll-${m}|${path}`, `pop-scroll-${m}`, { page: path });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    tick();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [path]);

  return null;
}
