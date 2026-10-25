// Shirt ideas (/ideas): the form's checks, the honeypot, the rate limit, ideas.jsonl,
// John's review page actions and the (switched-off) emails to senders
// (lib/ideas.ts, lib/ideas-server.ts, lib/ideas-email.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IDEA_MAX, PITCH, ROYALTY, TERMS, TERMS_VERSION, cleanPayout, cleanProductUrl, validateIdea } from "../lib/ideas.ts";
import {
  IDEAS_FILE,
  IDEA_EMAILS_FILE,
  createIdeaEmailLedger,
  createIdeaStore,
  handleIdea,
  handleIdeaAdmin,
  hashIp,
  hideAddresses,
  ideaSignature,
  ideasAdminUrl,
  ideasListSignature,
  newIdeaEmail,
  verifyIdea,
  verifyIdeasList,
  type AdminDeps,
  type Idea,
  type IdeaAction,
  type SubmitDeps,
} from "../lib/ideas-server.ts";
import { DECLINE_SUBJECT, LIVE_SUBJECT, PAYOUT_ASK, PAYOUT_KNOWN, ROYALTY_LINE, ideaDeclineEmail, ideaLiveEmail } from "../lib/ideas-email.ts";
import { createRateLimiter } from "../lib/subscribers.ts";
import { UMAMI_BEFORE_SEND_JS } from "../lib/umami.ts";
import { fakeFetch, readJsonl, tmpDir } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const SECRET = "test-link-secret";
const IP = "203.0.113.77";
const good = { idea: "A pelican surfing a wave of coffee, with Morning Shift underneath", name: "Ana Diaz", email: "Ana@Example.com", agree: true };

function setup(over: Partial<SubmitDeps> = {}) {
  const dir = tmpDir();
  const store = createIdeaStore(dir);
  const emails: { subject: string; body: string }[] = [];
  const logs: string[] = [];
  const deps: SubmitDeps = {
    store,
    allow: () => true,
    now: () => new Date("2026-10-25T19:00:00Z"),
    siteUrl: "https://mopclothing.com",
    linkSecret: SECRET,
    notify: async (subject, body) => {
      emails.push({ subject, body });
      return { ok: true };
    },
    log: (m) => logs.push(m),
    ...over,
  };
  return { dir, store, deps, emails, logs };
}

async function submitted(over: Partial<SubmitDeps> = {}) {
  const s = setup(over);
  const r = await handleIdea(good, { ip: IP }, s.deps);
  assert.equal(r.status, 200);
  await r.after?.();
  const [idea] = await s.store.readAll();
  return { ...s, idea };
}

function admin(
  dir: string,
  store: ReturnType<typeof createIdeaStore>,
  env: Record<string, string> = {},
  respond: (c: any) => { status: number; json?: unknown } = () => ({ status: 200, json: { id: "re_1" } })
) {
  const { fetch, calls } = fakeFetch(respond);
  const logs: string[] = [];
  const deps: AdminDeps = { store, dir, linkSecret: SECRET, env, fetch, now: () => new Date("2026-10-26T17:00:00Z"), log: (m) => logs.push(m), retryDelayMs: 0 };
  const act = (id: string, action: IdeaAction, extra: Record<string, string> = {}) =>
    handleIdeaAdmin({ id, action, sig: ideaSignature(id, action, SECRET), ...extra }, deps);
  return { deps, calls, logs, act };
}

// --- the form's checks ------------------------------------------------------------------

test("validation: idea (≤1,000 characters), name and a real email are required, and the terms box must be ticked", () => {
  assert.deepEqual(validateIdea(good).value, { idea: good.idea, name: "Ana Diaz", email: "ana@example.com" });
  const empty = validateIdea({});
  assert.deepEqual(Object.keys(empty.errors).sort(), ["agree", "email", "idea", "name"]);
  assert.equal(empty.value, null);
  assert.equal(validateIdea({ ...good, idea: "   " }).errors.idea, "Tell us your idea");
  assert.equal(validateIdea({ ...good, idea: "cat" }).errors.idea, "Tell us a bit more");
  assert.equal(validateIdea({ ...good, idea: "x".repeat(IDEA_MAX) }).errors.idea, undefined);
  assert.equal(validateIdea({ ...good, idea: "x".repeat(IDEA_MAX + 1) }).errors.idea, "Please keep it under 1,000 characters");
  assert.equal(validateIdea({ ...good, email: "ana@example" }).errors.email, "That email doesn't look right");
  assert.equal(validateIdea({ ...good, email: "not an email" }).errors.email, "That email doesn't look right");
  assert.equal(validateIdea({ ...good, agree: false }).errors.agree, "Please agree to the terms");
  assert.equal(validateIdea({ ...good, agree: "true" }).errors.agree, undefined);
  assert.equal(IDEA_MAX, 1000);
});

test("the pitch and the terms say $1.50 a shirt, own idea, our right to make it, no promises, $20 payout minimum, stop any time", () => {
  assert.equal(PITCH, "Got a shirt idea? Send it. If we make it, you get $1.50 for every one sold.");
  assert.equal(ROYALTY, "$1.50");
  const t = TERMS.join(" ");
  for (const bit of [
    /own idea, with no logos, brands or characters from other companies/,
    /You let MOP Clothing make and sell shirts based on it/,
    /may turn any idea down/,
    /already be working on similar ideas/,
    /only to ideas we approve and actually make/,
    /\$1\.50 per shirt sold \(on our website or our Etsy shop\), paid monthly by Venmo or Zelle once you've earned \$20 or more/,
    /stop the program at any time; royalties already earned are still paid/,
  ])
    assert.match(t, bit);
});

test("admin-side cleaners: payout one line ≤100, product link https only", () => {
  assert.equal(cleanPayout("  Venmo   @ana-d \n"), "Venmo @ana-d");
  assert.equal(cleanPayout(""), null);
  assert.equal(cleanPayout("x".repeat(300))!.length, 100);
  assert.equal(cleanProductUrl("https://mopclothing.com/pelican-tee"), "https://mopclothing.com/pelican-tee");
  assert.equal(cleanProductUrl("http://mopclothing.com/pelican-tee"), null);
  assert.equal(cleanProductUrl("javascript:alert(1)"), null);
  assert.equal(cleanProductUrl("mopclothing.com"), null);
  assert.equal(cleanProductUrl(""), null);
});

// --- submitting -------------------------------------------------------------------------

test("a good idea is saved to ideas.jsonl with every field (IP hashed, never raw) and John is emailed with the review link", async () => {
  const { dir, idea, emails, logs } = await submitted();
  const rows = readJsonl(path.join(dir, IDEAS_FILE));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["createdAt", "decidedAt", "email", "id", "idea", "ipHash", "name", "notes", "payout", "productUrl", "status", "terms"]);
  assert.match(idea.id, /^[0-9a-f]{16}$/);
  assert.equal(idea.createdAt, "2026-10-25T19:00:00.000Z");
  assert.equal(idea.idea, good.idea);
  assert.equal(idea.email, "ana@example.com");
  assert.equal(idea.status, "new");
  assert.equal(idea.payout, null);
  assert.equal(idea.notes, null);
  assert.equal(idea.productUrl, null);
  assert.equal(idea.decidedAt, null);
  assert.equal(idea.terms, TERMS_VERSION);
  assert.equal(idea.ipHash, hashIp(IP, SECRET));
  assert.match(idea.ipHash, /^[0-9a-f]{16}$/);
  assert.ok(!readFileSync(path.join(dir, IDEAS_FILE), "utf8").includes(IP), "the raw IP is never stored");
  assert.equal((statSync(path.join(dir, IDEAS_FILE)).mode & 0o777).toString(8), "640");

  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /^New shirt idea #1 from Ana Diaz: A pelican surfing a wave of coffee/);
  assert.match(emails[0].body, /THE IDEA\nA pelican surfing/);
  assert.match(emails[0].body, /Email: ana@example\.com/);
  assert.ok(emails[0].body.includes(ideasAdminUrl("https://mopclothing.com", SECRET, { status: "new", id: idea.id })!));
  assert.doesNotMatch(emails[0].body, new RegExp(IP.replace(/\./g, "\\.")));
  // logs: the id only, never the address, the name or the idea
  assert.deepEqual(logs, [`[ideas] idea ${idea.id} saved (#1)`]);
});

test("the answer to the visitor is just ok: nothing it saved (email, payout) comes back", async () => {
  const { deps } = setup();
  const r = await handleIdea({ ...good, payout: "Venmo @ana" } as never, { ip: IP }, deps);
  assert.deepEqual(r.body, { ok: true });
  const [x] = await deps.store.readAll();
  assert.equal(x.payout, null, "the public form has no payout field; anything sent as one is ignored");
});

test("a bad idea gets field errors and nothing is saved or sent", async () => {
  const { dir, deps, emails } = setup();
  const r = await handleIdea({ ...good, email: "nope", agree: false }, { ip: IP }, deps);
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys(r.body.errors!).sort(), ["agree", "email"]);
  assert.equal(existsSync(path.join(dir, IDEAS_FILE)), false);
  assert.equal(r.after, undefined);
  assert.equal(emails.length, 0);
});

test("honeypot: a filled-in hidden field gets a normal 'ok', nothing saved, John not emailed", async () => {
  const { dir, deps, emails } = setup();
  const r = await handleIdea({ ...good, website: "http://spam.example" }, { ip: IP }, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.after, undefined);
  assert.equal(existsSync(path.join(dir, IDEAS_FILE)), false);
  assert.equal(emails.length, 0);
});

test("rate limit: 3 ideas per 10 minutes per visitor (the /custom limiter), then 429 and nothing saved; other visitors unaffected", async () => {
  let t = 1_000_000;
  const allow = createRateLimiter({ limit: 3, windowMs: 10 * 60 * 1000, now: () => t });
  const { deps } = setup({ allow });
  for (let i = 0; i < 3; i++) assert.equal((await handleIdea(good, { ip: IP }, deps)).status, 200);
  const limited = await handleIdea(good, { ip: IP }, deps);
  assert.equal(limited.status, 429);
  assert.match(limited.body.error!, /Too many tries/);
  assert.equal((await handleIdea(good, { ip: "198.51.100.1" }, deps)).status, 200);
  assert.equal((await deps.store.readAll()).length, 4);
  t += 10 * 60 * 1000 + 1;
  assert.equal((await handleIdea(good, { ip: IP }, deps)).status, 200, "the window resets");
  // the route keeps the limiter as /custom does
  const route = readFileSync(path.join(ROOT, "app/api/ideas/route.ts"), "utf8");
  assert.match(route, /createRateLimiter\(\{ limit: 3, windowMs: 10 \* 60 \* 1000 \}\)/);
  assert.match(route, /clientIp\(req\.headers\)/);
});

test("a failed email to John is logged by id and the idea stays saved", async () => {
  const { store, logs, idea } = await submitted({ notify: async () => ({ ok: false, error: "HTTP 500" }) });
  assert.equal((await store.readAll()).length, 1);
  assert.equal(logs.at(-1), `[ideas] idea ${idea.id}: email to John failed (HTTP 500); it's saved in ${IDEAS_FILE}`);
});

test("a save that fails answers 500 and doesn't email John", async () => {
  const { deps, emails, logs } = setup();
  deps.store = { ...deps.store, add: async () => Promise.reject(new Error("EACCES")) } as never;
  const r = await handleIdea(good, { ip: IP }, deps);
  assert.equal(r.status, 500);
  assert.equal(emails.length, 0);
  assert.match(logs[0], /^\[ideas\] could not save idea [0-9a-f]{16}: EACCES$/);
});

// --- storage ------------------------------------------------------------------------------

test("storage: atomic rewrites (no temp files left), parallel submissions all kept, a torn line skipped, delete for test entries", async () => {
  const { dir, deps } = setup();
  await Promise.all(Array.from({ length: 20 }, (_, i) => handleIdea({ ...good, name: `Visitor ${i}` }, { ip: `10.0.0.${i}` }, deps)));
  const all = await deps.store.readAll();
  assert.equal(all.length, 20);
  assert.equal(new Set(all.map((x) => x.id)).size, 20);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  // a torn line (a crash in some older writer) doesn't hide the others
  writeFileSync(path.join(dir, IDEAS_FILE), readFileSync(path.join(dir, IDEAS_FILE), "utf8") + '{"id":"torn');
  assert.equal((await deps.store.readAll()).length, 20);
  assert.equal(await deps.store.remove(all[0].id), true);
  assert.equal(await deps.store.remove(all[0].id), false);
  assert.equal((await deps.store.readAll()).length, 19);
  assert.equal(readJsonl(path.join(dir, IDEAS_FILE)).length, 19, "rewriting also drops the torn line");
});

test("one sender's ideas share an ipHash; another IP or another secret gives a different one", () => {
  assert.equal(hashIp(IP, SECRET), hashIp(IP, SECRET));
  assert.notEqual(hashIp(IP, SECRET), hashIp("203.0.113.78", SECRET));
  assert.notEqual(hashIp(IP, SECRET), hashIp(IP, "another-secret"));
  assert.match(hashIp(IP, undefined), /^[0-9a-f]{16}$/);
});

// --- John's review page: the same signed-link protection as /moderate ------------------------

test("review page links: signed with MOP_LINK_SECRET; wrong, missing or other-purpose signatures fail", () => {
  const sig = ideasListSignature(SECRET);
  assert.equal(verifyIdeasList(sig, SECRET), true);
  assert.equal(verifyIdeasList(sig, "other-secret"), false);
  assert.equal(verifyIdeasList(sig, undefined), false, "no secret: no page at all");
  assert.equal(verifyIdeasList(undefined, SECRET), false);
  assert.equal(verifyIdeasList("0".repeat(32), SECRET), false);
  assert.equal(verifyIdeasList(sig.toUpperCase(), SECRET), false);
  const id = "0123456789abcdef";
  assert.equal(verifyIdea(id, "approve", ideaSignature(id, "approve", SECRET), SECRET), true);
  assert.equal(verifyIdea(id, "launch", ideaSignature(id, "approve", SECRET), SECRET), false, "one action's signature can't do another");
  assert.equal(verifyIdea("fedcba9876543210", "approve", ideaSignature(id, "approve", SECRET), SECRET), false);
  assert.equal(verifyIdea(id, "approve", sig, SECRET), false, "the list link can't press buttons");
  assert.equal(verifyIdea(id, "delete", ideaSignature(id, "approve", SECRET), SECRET), false);
  assert.equal(verifyIdea("../x", "approve", ideaSignature("../x" as never, "approve", SECRET), SECRET), false);
  assert.equal(
    ideasAdminUrl("https://mopclothing.com/", SECRET, { status: "new", id }),
    `https://mopclothing.com/moderate/ideas?sig=${sig}&status=new#idea-${id}`
  );
  assert.equal(ideasAdminUrl("https://mopclothing.com", undefined), null);
  assert.match(newIdeaEmail({ id, name: "A", idea: "B", email: "a@b.co", createdAt: "2026-10-25T19:00:00Z", terms: TERMS_VERSION } as Idea, 1, { siteUrl: "https://mopclothing.com" }).body, /Set MOP_LINK_SECRET/);
});

test("the review page and its route check the signature first (404 otherwise), like /moderate", () => {
  const page = readFileSync(path.join(ROOT, "app/moderate/ideas/page.tsx"), "utf8");
  assert.match(page, /if \(!secret \|\| !verifyIdeasList\(q\.sig, secret\)\) notFound\(\);/);
  assert.ok(page.indexOf("notFound();") < page.indexOf(".readAll()"), "nothing is read before the check");
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /referrer: "no-referrer"/);
  const route = readFileSync(path.join(ROOT, "app/api/ideas/admin/route.ts"), "utf8");
  assert.match(route, /if \(r\.status === 404\) return new NextResponse\("Not found", \{ status: 404 \}\);/);
});

test("admin actions: a wrong signature changes nothing (404)", async () => {
  const { dir, store, idea } = await submitted();
  const { deps } = admin(dir, store);
  assert.deepEqual(await handleIdeaAdmin({ id: idea.id, action: "approve", sig: "0".repeat(32) }, deps), { status: 404 });
  assert.deepEqual(await handleIdeaAdmin({ id: idea.id, action: "approve", sig: ideaSignature(idea.id, "deny", SECRET) }, deps), { status: 404 });
  assert.deepEqual(await handleIdeaAdmin({ id: idea.id, action: "approve", sig: ideaSignature(idea.id, "approve", SECRET) }, { ...deps, linkSecret: undefined }), { status: 404 });
  assert.equal((await store.get(idea.id))!.status, "new");
  // a well-signed id that isn't there
  assert.deepEqual(await admin(dir, store).act("0123456789abcdef", "approve"), { status: 404 });
});

test("admin actions: approve, notes + payout, deny, mark launched (needs an https link)", async () => {
  const { dir, store, idea } = await submitted();
  const { act, calls } = admin(dir, store);

  const a = await act(idea.id, "approve");
  assert.equal(a.status, 200);
  if (a.status !== 200) return;
  assert.equal(a.idea.status, "approved");
  assert.equal(a.idea.decidedAt, "2026-10-26T17:00:00.000Z");
  assert.equal(a.email, undefined);

  const s = await act(idea.id, "save", { notes: "  Love it. Draft by Friday.  ", payout: " Venmo @ana-d " });
  assert.equal(s.status === 200 && s.idea.notes, "Love it. Draft by Friday.");
  assert.equal(s.status === 200 && s.idea.payout, "Venmo @ana-d");
  assert.equal(s.status === 200 && s.idea.status, "approved", "saving notes doesn't change the status");

  const missing = await act(idea.id, "launch", { productUrl: "" });
  assert.deepEqual(missing, { status: 400, id: idea.id, error: "Add the shirt's page (a link starting https://) to mark it launched." });
  assert.equal((await act(idea.id, "launch", { productUrl: "http://mopclothing.com/x" })).status, 400);
  assert.equal((await store.get(idea.id))!.status, "approved");

  const l = await act(idea.id, "launch", { productUrl: "https://mopclothing.com/coffee-pelican-tee" });
  assert.equal(l.status, 200);
  if (l.status !== 200) return;
  assert.equal(l.idea.status, "launched");
  assert.equal(l.idea.productUrl, "https://mopclothing.com/coffee-pelican-tee");
  assert.equal(l.email, "off");

  const d = await act(idea.id, "deny", { sendEmail: "1" });
  assert.equal(d.status === 200 && d.idea.status, "denied");
  assert.equal(d.status === 200 && d.email, "off");

  const saved = readJsonl(path.join(dir, IDEAS_FILE));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, "denied");
  assert.equal(saved[0].notes, "Love it. Draft by Friday.");
  assert.equal(calls.length, 0, "no email went anywhere");
});

// --- the emails to senders: OFF until John approves the wording ---------------------------------

test("email gating: with the switches unset, launch and deny send nothing and write no ledger (a log line without the address)", async () => {
  const { dir, store, idea } = await submitted();
  // even with a Resend key set
  const { act, calls, logs } = admin(dir, store, { MOP_RESEND_API_KEY: "re_test", MOP_IDEA_LIVE_EMAIL_ENABLED: "yes", MOP_IDEA_DECLINE_EMAIL_ENABLED: "true" });
  const l = await act(idea.id, "launch", { productUrl: "https://mopclothing.com/coffee-pelican-tee" });
  assert.equal(l.status === 200 && l.email, "off");
  const d = await act(idea.id, "deny", { sendEmail: "1" });
  assert.equal(d.status === 200 && d.email, "off");
  assert.equal(calls.length, 0);
  assert.equal(existsSync(path.join(dir, IDEA_EMAILS_FILE)), false);
  assert.ok(logs.some((m) => m.includes('the "your idea is live" email is off (MOP_IDEA_LIVE_EMAIL_ENABLED is not 1); not sent')));
  assert.ok(logs.some((m) => m.includes('the "not this time" email is off (MOP_IDEA_DECLINE_EMAIL_ENABLED is not 1); not sent')));
  assert.ok(logs.every((m) => !m.includes("@")), "no address in any log line");
});

test("email gating: MOP_IDEA_LIVE_EMAIL_ENABLED=1 sends 'Your idea is live' once, from MOP_EMAIL_FROM, to the sender only", async () => {
  const { dir, store, idea } = await submitted();
  const env = { MOP_IDEA_LIVE_EMAIL_ENABLED: "1", MOP_RESEND_API_KEY: "re_test", MOP_EMAIL_FROM: "MOP Clothing <hello@mopclothing.com>", PINGPIGEON_TOKEN: "pp" };
  const { act, calls, logs } = admin(dir, store, env);
  const l = await act(idea.id, "launch", { productUrl: "https://mopclothing.com/coffee-pelican-tee" });
  assert.equal(l.status === 200 && l.email, "emailed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].body.from, "MOP Clothing <hello@mopclothing.com>");
  assert.deepEqual(calls[0].body.to, ["ana@example.com"]);
  assert.equal(calls[0].body.subject, LIVE_SUBJECT);
  assert.match(calls[0].body.text, /Your idea is live: https:\/\/mopclothing\.com\/coffee-pelican-tee/);
  assert.ok(calls[0].body.text.includes(ROYALTY_LINE));
  assert.equal(calls[0].headers["Idempotency-Key"], `mop-idea-live/${idea.id}`);
  // pressing it again (or "Update link") never sends a second one
  const again = await act(idea.id, "launch", { productUrl: "https://mopclothing.com/coffee-pelican-tee-2" });
  assert.equal(again.status === 200 && again.email, "duplicate");
  assert.equal(calls.length, 1);
  const ledger = await createIdeaEmailLedger(dir).rows();
  assert.deepEqual(ledger.map((r) => r.status), ["sending", "emailed"]);
  assert.ok(logs.every((m) => !m.includes("ana@example.com") && !/\w\*\*\*@/.test(m)), "not even a masked address in the logs");
  // deny without the decline switch: still nothing
  const d = await act(idea.id, "deny", { sendEmail: "1" });
  assert.equal(d.status === 200 && d.email, "off");
  assert.equal(calls.length, 1);
});

test("email gating: the 'not this time' email needs its own switch AND the tick on Deny", async () => {
  const { dir, store, idea } = await submitted();
  const env = { MOP_IDEA_DECLINE_EMAIL_ENABLED: "1", MOP_RESEND_API_KEY: "re_test" };
  const { act, calls } = admin(dir, store, env);
  const quiet = await act(idea.id, "deny");
  assert.equal(quiet.status === 200 && quiet.email, undefined, "no tick: no email");
  assert.equal(calls.length, 0);
  await act(idea.id, "approve");
  const d = await act(idea.id, "deny", { sendEmail: "1" });
  assert.equal(d.status === 200 && d.email, "emailed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.subject, DECLINE_SUBJECT);
  // the live email is still off
  const l = await act(idea.id, "launch", { productUrl: "https://mopclothing.com/x-tee" });
  assert.equal(l.status === 200 && l.email, "off");
  assert.equal(calls.length, 1);
});

test("email gating: a failed send is logged, retried on the next press, and John is alerted through PingPigeon", async () => {
  const { dir, store, idea } = await submitted();
  let fail = true;
  const env = { MOP_IDEA_LIVE_EMAIL_ENABLED: "1", MOP_RESEND_API_KEY: "re_test", PINGPIGEON_TOKEN: "pp" };
  const { act, calls } = admin(dir, store, env, (c: any) =>
    c.url.endsWith("/email") ? { status: 200, json: { ok: true } } : fail ? { status: 422, json: { message: "bad" } } : { status: 200, json: { id: "re_2" } }
  );
  const l = await act(idea.id, "launch", { productUrl: "https://mopclothing.com/x-tee" });
  assert.equal(l.status === 200 && l.email, "failed");
  const alert = calls.find((c) => c.url.endsWith("/email"))!;
  assert.match(alert.body.subject, /^ACTION NEEDED: idea email failed for Ana Diaz$/);
  fail = false;
  const again = await act(idea.id, "launch", { productUrl: "https://mopclothing.com/x-tee" });
  assert.equal(again.status === 200 && again.email, "emailed");
});

test("the emails' wording: live link + share + royalty line; ask for Venmo/Zelle only when John hasn't recorded one; never the address or handle", () => {
  const live = ideaLiveEmail({ name: "ana diaz", idea: "A pelican surfing a wave of coffee", productUrl: "https://mopclothing.com/coffee-pelican-tee", payoutOnFile: false, ref: "idea-0123456789abcdef" });
  assert.equal(live.subject, "Your idea is live! 🎉");
  assert.match(live.text, /^Hi Ana,\n\nYour idea is live: https:\/\/mopclothing\.com\/coffee-pelican-tee\nWe made your idea into a shirt, and it's on sale now\. Share it with anyone you like!/);
  assert.ok(live.text.includes("Your royalty: $1.50 for every one sold, on our website or our Etsy shop. We pay monthly by Venmo or Zelle once you've earned $20 or more."));
  assert.ok(live.text.includes(PAYOUT_ASK));
  assert.ok(!live.text.includes(PAYOUT_KNOWN));
  assert.match(live.html, /href="https:\/\/mopclothing\.com\/coffee-pelican-tee"/);
  assert.match(live.html, /because you sent us a shirt idea/);
  assert.doesNotMatch(live.html, /because you ordered/);
  const known = ideaLiveEmail({ name: "Ana", idea: "x", productUrl: "https://mopclothing.com/x", payoutOnFile: true, ref: "idea-1" });
  assert.ok(known.text.includes(PAYOUT_KNOWN) && !known.text.includes(PAYOUT_ASK));
  const no = ideaDeclineEmail({ name: "Ana", idea: "<b>A pelican</b>", ref: "idea-1" });
  assert.equal(no.subject, "About your MOP shirt idea");
  assert.match(no.text, /We've decided not to make this one, so it won't become a shirt this time\./);
  assert.match(no.text, /https:\/\/mopclothing\.com\/ideas/);
  assert.match(no.html, /&lt;b&gt;A pelican&lt;\/b&gt;/, "the idea is escaped");
  const long = ideaDeclineEmail({ name: "Ana", idea: "word ".repeat(200), ref: "idea-1" });
  assert.ok(long.text.split("\n").every((l) => l.length < 400), "a long idea is cut when quoted");
});

test("hideAddresses: any address in a log line is hidden", () => {
  assert.equal(hideAddresses("sent to a***@example.com, Resend re_1"), "sent to [address hidden], Resend re_1");
  assert.equal(hideAddresses("From: MOP <orders@mopclothing.com>\nTo: ana@example.com"), "From: MOP <[address hidden]>\nTo: [address hidden]");
});

// --- the public page ---------------------------------------------------------------------------

test("/ideas: linked from the home page as 'Submit an idea'; the form has idea, name, email, terms and a honeypot, no payout field", () => {
  const home = readFileSync(path.join(ROOT, "app/HomePage.tsx"), "utf8");
  assert.match(home, /<Link href="\/ideas" className=\{styles\.customCard\}>/);
  assert.match(home, /Submit an idea →/);
  const page = readFileSync(path.join(ROOT, "app/ideas/page.tsx"), "utf8");
  assert.match(page, /Got a shirt idea\? Send it\./);
  assert.match(page, /path: "\/ideas"/);
  const form = readFileSync(path.join(ROOT, "components/IdeaForm.tsx"), "utf8");
  for (const id of ["idea-idea", "idea-name", "idea-email", "idea-agree"]) assert.ok(form.includes(`id="${id}"`), id);
  assert.match(form, /maxLength=\{IDEA_MAX\}/);
  assert.match(form, /TERMS\.map/);
  assert.match(form, /name="website"/);
  assert.doesNotMatch(form, /payout|venmo|zelle/i);
  assert.match(form, /Thanks for your idea!/);
  assert.match(form, /fetch\("\/api\/ideas"/);
});

test("Umami never records John's /moderate pages (their links carry the signature); other pages unchanged", () => {
  const w: Record<string, any> = {};
  new Function("window", UMAMI_BEFORE_SEND_JS)(w);
  const hook = w.mopUmamiBeforeSend as (t: string, p: any) => any;
  assert.equal(hook("event", { url: "/moderate/ideas?sig=abc", website: "x" }), null);
  assert.equal(hook("event", { url: "https://mopclothing.com/moderate/0123456789abcdef?action=view-claim&sig=abc", website: "x" }), null);
  assert.equal(hook("event", { url: "/moderate/ideas?sig=abc", name: "x", website: "x" }), null);
  assert.ok(hook("event", { url: "/ideas", website: "x" }));
  assert.ok(hook("event", { url: "/moderated-tee", website: "x" }), "only the /moderate pages");
});
