// Etsy OAuth 2.0 authorization-code flow with PKCE (S256), on localhost.
// The printed link is a local one (http://localhost:3003/start) that redirects to
// Etsy's consent page, so the keystring never appears in the terminal.
import crypto from "node:crypto";
import http from "node:http";
import { loadEnv, redact, saveTokens } from "./config.mjs";
import { TOKEN_URL } from "./etsy-client.mjs";

export const SCOPES = ["listings_r", "listings_w", "shops_r"];
const CONNECT_URL = "https://www.etsy.com/oauth/connect";
const TIMEOUT_MS = 10 * 60 * 1000;

const b64url = (buf) => buf.toString("base64url");

export function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32)); // 43 chars of [A-Za-z0-9_-]
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function connectUrl({ clientId, redirectUri, state, challenge, scopes = SCOPES }) {
  const u = new URL(CONNECT_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function exchangeCode(env, code, verifier) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.keystring,
      redirect_uri: env.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(redact(`token exchange failed (${res.status}): ${text.slice(0, 300)}`));
  return JSON.parse(text);
}

const page = (msg) =>
  `<!doctype html><meta charset="utf-8"><title>MOP Listing Tool</title><body style="font:16px system-ui;margin:3em">${msg}</body>`;

/** Runs the flow; resolves with the saved token record (never printed). */
export function runAuth({ log = console.log } = {}) {
  const env = loadEnv();
  const redirect = new URL(env.redirectUri);
  if (redirect.hostname !== "localhost") throw new Error(`redirect URI host must be "localhost" (Etsy refuses IPs): ${env.redirectUri}`);
  const port = Number(redirect.port) || 80;
  const { verifier, challenge } = pkcePair();
  const state = b64url(crypto.randomBytes(24));
  const target = connectUrl({ clientId: env.keystring, redirectUri: env.redirectUri, state, challenge });

  return new Promise((resolve, reject) => {
    const servers = [];
    let finished = false;
    const done = (err, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const s of servers) s.close();
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => done(new Error("timed out after 10 minutes waiting for Etsy")), TIMEOUT_MS);

    const handler = async (req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`);
      if (u.pathname === "/start") {
        res.writeHead(302, { Location: target, "Cache-Control": "no-store" });
        return res.end();
      }
      if (u.pathname !== redirect.pathname) {
        res.writeHead(404);
        return res.end();
      }
      const send = (code, msg) => {
        res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(page(msg));
      };
      if (u.searchParams.get("state") !== state) {
        send(400, "State mismatch: this response isn't from the request this tool made. Run auth again.");
        return done(new Error("OAuth state mismatch"));
      }
      const error = u.searchParams.get("error");
      if (error) {
        send(400, `Etsy said: ${error}. Run auth again.`);
        return done(new Error(`Etsy authorization refused: ${error} ${u.searchParams.get("error_description") ?? ""}`));
      }
      try {
        const tok = await exchangeCode(env, u.searchParams.get("code"), verifier);
        const saved = saveTokens(tok);
        send(200, "Connected. You can close this tab and go back to the terminal.");
        done(null, saved);
      } catch (e) {
        send(500, "Token exchange failed; see the terminal.");
        done(e);
      }
    };

    // "localhost" can resolve to either loopback, so listen on both (never on the LAN).
    let pending = 2;
    let listening = 0;
    for (const host of ["127.0.0.1", "::1"]) {
      const s = http.createServer(handler);
      servers.push(s);
      const settle = () => {
        if (--pending > 0) return;
        if (!listening) return done(new Error(`could not listen on localhost:${port} (in use?)`));
        log(`Open this link in your browser and approve "MOP Listing Tool":\n\n  http://localhost:${port}/start\n`);
      };
      s.once("error", (e) => {
        if (e.code === "EADDRINUSE" && host === "127.0.0.1") return done(new Error(`port ${port} is in use`));
        settle(); // no IPv6 loopback on this machine is fine
      });
      s.listen(port, host, () => { listening++; settle(); });
    }
  });
}
