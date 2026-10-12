// Small fetch helpers for the supplier and email calls: a timeout, JSON parsing
// that never throws, and "retry once" for failures worth retrying.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type HttpResult = {
  ok: boolean;
  status: number;
  json: any;
  text: string;
  /** Set when the request never got a response (network error, timeout). */
  networkError?: string;
};

export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs = 10_000
): Promise<HttpResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ac.signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    const e = err as Error;
    return {
      ok: false,
      status: 0,
      json: null,
      text: "",
      networkError: e.name === "AbortError" ? `timeout after ${timeoutMs} ms` : e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** No response, rate limited, or a server error: worth one more try. */
export const isRetryable = (r: HttpResult) =>
  r.status === 0 || r.status === 429 || r.status >= 500;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Short description of a failed call for logs and John's email (no headers, so no secrets). */
export const describeFailure = (r: HttpResult) =>
  r.networkError
    ? r.networkError
    : `HTTP ${r.status}: ${
        r.json?.error?.message ?? r.json?.msg ?? r.json?.error ?? r.json?.result ?? r.text.slice(0, 300)
      }`;
