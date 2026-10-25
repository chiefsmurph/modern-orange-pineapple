// Minimal Etsy Open API v3 client: x-api-key (keystring:shared_secret), OAuth bearer
// with automatic refresh, a 5 req/s self-throttle (the app's limit is 10/s), and
// 429 handling by retry-after. Writes are never retried on 5xx (a createDraftListing
// that timed out may still have made the draft).
import { loadEnv, loadTokens, redact, saveTokens } from "./config.mjs";

export const API = "https://api.etsy.com/v3";
export const TOKEN_URL = `${API}/public/oauth/token`;
const MIN_GAP_MS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class EtsyError extends Error {
  constructor(status, method, path, body) {
    super(redact(`Etsy ${method} ${path} → ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`));
    this.status = status;
    this.body = body;
  }
}

export async function refreshTokens(env, tokens) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.keystring,
      refresh_token: tokens.refresh_token,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(redact(`token refresh failed (${res.status}): ${text.slice(0, 300)} — run: node scripts/etsy/etsy.mjs auth`));
  return saveTokens(JSON.parse(text));
}

export function createClient() {
  const env = loadEnv();
  let tokens = loadTokens();
  if (!tokens) throw new Error("no Etsy tokens yet — run: node scripts/etsy/etsy.mjs auth");
  let last = 0;

  async function bearer() {
    if (Date.now() > tokens.expires_at - 60_000) tokens = await refreshTokens(env, tokens);
    return tokens.access_token;
  }

  async function request(method, path, { query, form, json, multipart } = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, String(v));
    let body;
    const headers = { "x-api-key": `${env.keystring}:${env.sharedSecret}` };
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
      body = new URLSearchParams(form).toString();
    } else if (json) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      body = JSON.stringify(json);
    } else if (multipart) {
      body = multipart; // FormData sets its own boundary
    }
    for (let attempt = 0; ; attempt++) {
      const wait = last + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      headers.Authorization = `Bearer ${await bearer()}`;
      let res;
      try {
        res = await fetch(url, { method, headers, body });
      } catch (e) {
        if (method === "GET" && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
        throw new Error(redact(`Etsy ${method} ${path}: ${e.message}`));
      }
      const text = await res.text();
      if (res.status === 401 && attempt === 0) {
        tokens = await refreshTokens(env, tokens); // revoked or clock-skewed token: refresh once
        continue;
      }
      if (res.status === 429 && attempt < 4) {
        const ra = Number(res.headers.get("retry-after")) || 2 ** attempt;
        await sleep(ra * 1000 + Math.random() * 500);
        continue;
      }
      if (res.status >= 500 && method === "GET" && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      let data = text;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) throw new EtsyError(res.status, method, url.pathname, data);
      return data;
    }
  }

  /** Every page of a `{ count, results }` endpoint. */
  async function all(path, query = {}) {
    const out = [];
    for (let offset = 0; ; offset += 100) {
      const page = await request("GET", path, { query: { ...query, limit: 100, offset } });
      out.push(...(page.results ?? []));
      if (!page.results?.length || out.length >= (page.count ?? 0)) return out;
    }
  }

  return { request, all, env };
}
