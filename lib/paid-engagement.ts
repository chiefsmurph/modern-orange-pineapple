// Deeper engagement tracking for PAID visits only (John 10/21, the PopAds pop-under test): was the page
// ever actually seen, for how long, and how far did they scroll. Everyone else keeps the normal light
// tracking. A pop-under opens BEHIND the window someone is using, so "loaded" doesn't mean "seen": a tab
// only counts as looked at while it's visible AND focused.
//
// The value is in the event NAME (pop-time-30, pop-scroll-50) because the site-report login reads Umami's
// website_event table but not event_data, so the PopAds report can count them without more access.
// Pure helpers here; components/PaidEngagement.tsx wires them to the page.

/** utm_source values that get the deeper tracking (the visit's source, kept in sessionStorage "mop-src"). */
export const PAID_SOURCES = ["popads"] as const;

export const isPaidSource = (src: string | null | undefined) =>
  !!src && (PAID_SOURCES as readonly string[]).includes(src.toLowerCase());

/** Seconds of looked-at time that send an event, once each per tab. */
export const TIME_MARKS = [5, 15, 30, 60, 120] as const;

/** Scroll depths (% of the page) that send an event, once each per page per tab. */
export const SCROLL_MARKS = [25, 50, 75, 100] as const;

/** The time marks newly passed going from `before` to `after` seconds. */
export const marksPassed = (before: number, after: number) => TIME_MARKS.filter((m) => before < m && after >= m);

/** How far down the page, 0–100, from the scroll position and sizes. */
export function scrollPct(scrollY: number, viewport: number, pageHeight: number) {
  const scrollable = pageHeight - viewport;
  if (scrollable <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((scrollY + viewport) / pageHeight) * 100)));
}

/** The scroll marks reached at `pct`. */
export const scrollMarksReached = (pct: number) => SCROLL_MARKS.filter((m) => pct >= m);

/** "pop-seen" when the tab was in front within 2 s of loading (a normal tab), "pop-seen-late" when it was behind first. */
export const seenEventName = (secondsAfterLoad: number) => (secondsAfterLoad <= 2 ? "pop-seen" : "pop-seen-late");
