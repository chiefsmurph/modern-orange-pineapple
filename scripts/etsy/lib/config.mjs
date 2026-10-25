// Credentials live outside the repo, in ~/.config/mop-etsy/ (dir 0700, files 0600):
//   etsy.env     ETSY_KEYSTRING=…  ETSY_SHARED_SECRET=…  (optional ETSY_REDIRECT_URI=…)
//   tokens.json  OAuth access + refresh tokens, written by `etsy.mjs auth`
// Nothing in this tool prints these values; `redact()` scrubs them from any error text.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = process.env.MOP_ETSY_CONFIG_DIR || path.join(os.homedir(), ".config", "mop-etsy");
export const ENV_FILE = path.join(CONFIG_DIR, "etsy.env");
export const TOKENS_FILE = path.join(CONFIG_DIR, "tokens.json");
// Must match, character for character, a Callback URL registered on the Etsy app.
export const DEFAULT_REDIRECT_URI = "http://localhost:3003/oauth/redirect";

const secrets = new Set();
function remember(...values) {
  for (const v of values) if (typeof v === "string" && v.length >= 6) secrets.add(v);
}

/** Replaces every known credential in `text` with [redacted]. */
export function redact(text) {
  let s = String(text);
  for (const v of secrets) s = s.split(v).join("[redacted]");
  return s;
}

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).replace(/^export\s+/, "").trim();
    out[key] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) throw new Error(`missing ${ENV_FILE} (ETSY_KEYSTRING=…, ETSY_SHARED_SECRET=…)`);
  const env = parseEnv(fs.readFileSync(ENV_FILE, "utf8"));
  if (!env.ETSY_KEYSTRING || !env.ETSY_SHARED_SECRET) throw new Error(`${ENV_FILE} needs ETSY_KEYSTRING and ETSY_SHARED_SECRET`);
  remember(env.ETSY_KEYSTRING, env.ETSY_SHARED_SECRET);
  return {
    keystring: env.ETSY_KEYSTRING,
    sharedSecret: env.ETSY_SHARED_SECRET,
    redirectUri: env.ETSY_REDIRECT_URI || DEFAULT_REDIRECT_URI,
  };
}

export function hasTokens() {
  return fs.existsSync(TOKENS_FILE);
}

export function loadTokens() {
  if (!hasTokens()) return null;
  const t = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  remember(t.access_token, t.refresh_token);
  return t;
}

/** Atomic write, 0600 file in a 0700 dir. */
export function saveTokens(tokenResponse, now = Date.now()) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(CONFIG_DIR, 0o700);
  const t = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    token_type: tokenResponse.token_type,
    scope: tokenResponse.scope,
    expires_at: now + (Number(tokenResponse.expires_in) || 3600) * 1000,
    refresh_expires_at: now + 90 * 24 * 3600 * 1000, // Etsy: refresh tokens last 90 days
    saved_at: new Date(now).toISOString(),
  };
  remember(t.access_token, t.refresh_token);
  const tmp = `${TOKENS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(t, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, TOKENS_FILE);
  return t;
}
