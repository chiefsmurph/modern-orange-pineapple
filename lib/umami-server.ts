// A custom Umami event sent from the server, for requests that never render a
// page (the /meta-checkout redirect). Same endpoint and payload as the browser
// tracker (stats.chiefsmurph.com/script.js); the visitor's user agent and IP
// go along so Umami counts the event as theirs (device, country), not the box's.
// Never throws: analytics must never slow or break a checkout.
import { UMAMI_HOST, UMAMI_WEBSITE_ID } from "./umami.ts";

export type UmamiVisitor = { userAgent: string | null; ip: string | null; language?: string | null; referrer?: string | null };

export function umamiEventBody(
  name: string,
  data: Record<string, string | number>,
  url: string,
  visitor: Pick<UmamiVisitor, "language" | "referrer">,
  hostname = "mopclothing.com"
) {
  return {
    type: "event",
    payload: {
      website: UMAMI_WEBSITE_ID,
      hostname,
      url,
      referrer: visitor.referrer ?? "",
      language: (visitor.language ?? "").split(",")[0].split(";")[0].trim() || undefined,
      title: "Meta checkout",
      name,
      data,
    },
  };
}

export async function sendUmamiEvent(
  name: string,
  data: Record<string, string | number>,
  url: string,
  visitor: UmamiVisitor,
  { fetch: doFetch = fetch, timeoutMs = 3000 }: { fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<boolean> {
  // Umami drops events without a browser user agent anyway (bots).
  if (!visitor.userAgent) return false;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": visitor.userAgent };
    if (visitor.ip && visitor.ip !== "unknown") headers["X-Forwarded-For"] = visitor.ip;
    const res = await doFetch(`${UMAMI_HOST}/api/send`, {
      method: "POST",
      headers,
      body: JSON.stringify(umamiEventBody(name, data, url, visitor)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
