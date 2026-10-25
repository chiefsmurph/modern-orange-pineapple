// Umami (self-hosted at stats.chiefsmurph.com), loaded in app/layout.tsx.
//
// Page views keep their query string, so ?ref=ig and utm_* links from
// Instagram show up on the landing page view. Umami also counts a page view
// whenever the URL changes through history.replaceState; product pages rewrite
// the query on every pick (?color=Ivory&size=M), so this hook drops a page view
// whose path is the same as the last one: picks aren't new pages. Custom events
// always pass.
//
// It's an inline script (it must exist before the tracker loads), so it's kept
// as plain ES5 here and tested by evaluating the string.
export const UMAMI_BEFORE_SEND = "mopUmamiBeforeSend";
export const UMAMI_HOST = "https://stats.chiefsmurph.com";
export const UMAMI_WEBSITE_ID = "ba4cac44-a005-45f5-8d24-3b897178364c";

// John's /moderate pages aren't counted at all: their links carry a signature.
export const UMAMI_BEFORE_SEND_JS =
  "(function(w){var last=null;w." +
  UMAMI_BEFORE_SEND +
  "=function(type,payload){" +
  "if(type!=='event'||!payload)return payload;" +
  "var path=String(payload.url||'').split('?')[0].split('#')[0];" +
  "if(/^([a-z]+:\\/\\/[^\\/]+)?\\/moderate(\\/|$)/i.test(path))return null;" +
  "if(payload.name)return payload;" +
  "if(path===last)return null;" +
  "last=path;return payload;};})(window);";

type Umami = { track: (name: string, data?: Record<string, string | number>) => unknown };

/**
 * Send a custom event. Never throws and never waits: with Umami blocked (ad
 * blocker, ?nostats) it does nothing, so nothing depends on it, least of all checkout.
 */
export function track(name: string, data?: Record<string, string | number | undefined>) {
  try {
    const umami = (window as unknown as { umami?: Umami }).umami;
    if (!umami || typeof umami.track !== "function") return;
    const clean: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(data ?? {})) if (v !== undefined && v !== "") clean[k] = v;
    void Promise.resolve(umami.track(name, Object.keys(clean).length ? clean : undefined)).catch(() => undefined);
  } catch {
    // analytics must never break the page
  }
}

// Choices recorded once per value per tab (John 10/20: "record every choice, not every click"),
// so flicking back and forth between two skies counts each sky once. A reload starts over.
const sentOnce = new Set<string>();

/** track(), but only the first time this key is seen in this tab. */
export function trackOnce(key: string, name: string, data?: Record<string, string | number | undefined>) {
  if (sentOnce.has(key)) return;
  sentOnce.add(key);
  track(name, data);
}
