// Two Printful readers/writers, one per store:
//   - the Etsy store (PatrickMurphyStyle, Printful store in printful.env): its own token,
//     sent with X-PF-Store-Id. `link` reads and updates its sync products here.
//   - the website store (Modern Orange Pineapple, 18891329): its token stays on the
//     server. `fetchWebsiteProduct` runs curl ON the server over ssh and brings back
//     only the product JSON; the token never comes to this machine.
// Writes are never retried on 5xx; a 429 is retried after the wait Printful asks for
// (a 429 means the request wasn't run).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, loadPrintfulEnv, redact, writePrivate } from "./config.mjs";

export const PRINTFUL_API = "https://api.printful.com";
const MIN_GAP_MS = 300; // Printful allows 120 requests a minute

export const WEBSITE_STORE_ID = 18891329;
export const WEBSITE_SSH_HOST = process.env.MOP_WEBSITE_SSH_HOST || "pingpigeon-vps";
const WEBSITE_ENV = "/srv/mopclothing/.env";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PrintfulError extends Error {
  constructor(status, method, path, body) {
    const msg = body?.error?.message ?? (typeof body?.result === "string" ? body.result : null) ?? (typeof body === "string" ? body : JSON.stringify(body));
    super(redact(`Printful ${method} ${path} → ${status}: ${msg}`));
    this.status = status;
    this.body = body;
  }
}

/** A client for the Etsy store. `readOnly` refuses anything but GET before it leaves the machine. */
export function createPrintfulClient({ readOnly = false } = {}) {
  const env = loadPrintfulEnv();
  let last = 0;

  async function request(method, path, { query, json } = {}) {
    if (readOnly && method !== "GET") throw new Error(`read-only run: refusing ${method} ${path}`);
    const url = new URL(PRINTFUL_API + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${env.token}`, "X-PF-Store-Id": env.storeId };
    let body;
    if (json) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    }
    for (let attempt = 0; ; attempt++) {
      const wait = last + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let res;
      try {
        res = await fetch(url, { method, headers, body });
      } catch (e) {
        if (method === "GET" && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
        throw new Error(redact(`Printful ${method} ${path}: ${e.message}`));
      }
      const text = await res.text();
      if (res.status === 429 && attempt < 3) {
        const ra = Number(res.headers.get("retry-after")) || 60;
        await sleep(ra * 1000 + Math.random() * 500);
        continue;
      }
      if (res.status >= 500 && method === "GET" && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      let data = text;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) throw new PrintfulError(res.status, method, url.pathname, data);
      return data;
    }
  }

  /** Every page of a `{ result: [...], paging }` endpoint, up to `max` rows. */
  async function all(path, query = {}, max = 2000) {
    const out = [];
    for (let offset = 0; out.length < max; offset += 100) {
      const page = await request("GET", path, { query: { ...query, limit: 100, offset } });
      out.push(...(page.result ?? []));
      if (!page.result?.length || out.length >= (page.paging?.total ?? 0)) break;
    }
    return out;
  }

  return { request, all, storeId: env.storeId };
}

/** The shell command the server runs: token read there with grep/cut (the .env can't be sourced), curl prints JSON only. */
export function websiteProductCommand(id) {
  if (!/^\d+$/.test(String(id))) throw new Error(`website product id "${id}" is not a number`);
  return [
    `T=$(grep -m1 -E '^PRINTFUL_API_TOKEN=' ${WEBSITE_ENV} | cut -d= -f2- | tr -d "\\"'\\r")`,
    `[ -n "$T" ] || { echo 'no PRINTFUL_API_TOKEN in ${WEBSITE_ENV}' >&2; exit 3; }`,
    // printf is a shell builtin, so the token goes to curl on stdin and never shows in ps
    `printf 'Authorization: Bearer %s\\nX-PF-Store-Id: ${WEBSITE_STORE_ID}\\n' "$T" | curl -sS --max-time 30 -H @- ${PRINTFUL_API}/store/products/${id}`,
  ].join("; ");
}

export const websiteCacheFile = (id) => path.join(CACHE_DIR, `website-${id}.json`);

/**
 * The website store's sync product `id` ({ sync_product, sync_variants }), read fresh
 * on the server over ssh and cached to ~/.config/mop-etsy/cache/website-<id>.json.
 * `allowCache` falls back to that cache when the server can't be reached.
 */
export function fetchWebsiteProduct(id, { allowCache = false } = {}) {
  const file = websiteCacheFile(id);
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", WEBSITE_SSH_HOST, websiteProductCommand(id)], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60_000,
  });
  let problem = null;
  let data = null;
  if (r.error || r.status !== 0) {
    problem = `ssh ${WEBSITE_SSH_HOST} failed (${r.error?.message ?? `exit ${r.status}`}): ${(r.stderr ?? "").trim().slice(0, 300)}`;
  } else {
    try { data = JSON.parse(r.stdout); } catch { problem = `the server's answer for website product ${id} isn't JSON: ${r.stdout.slice(0, 200)}`; }
    if (data && data.code !== 200) problem = `Printful (website store) GET /store/products/${id} → ${data.code}: ${data.error?.message ?? data.result}`;
    else if (data && data.result?.sync_product?.id !== Number(id)) problem = `website product ${id}: unexpected answer shape`;
  }
  if (!problem) {
    writePrivate(file, JSON.stringify(data.result, null, 2) + "\n");
    return { product: data.result, from: "server", file };
  }
  if (allowCache && fs.existsSync(file)) {
    const stamp = fs.statSync(file).mtime.toISOString();
    return { product: JSON.parse(fs.readFileSync(file, "utf8")), from: `cache (${stamp})`, file, warning: problem };
  }
  throw new Error(redact(problem));
}
