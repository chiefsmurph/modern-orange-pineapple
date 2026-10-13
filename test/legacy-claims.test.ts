// Old card codes (COW-76) at /redeem: claims John checks (lib/legacy-claims.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CLAIM_UPLOADS_DIR,
  LEGACY_CLAIMS_FILE,
  claimEmail,
  claimSignature,
  cleanContact,
  createClaimStore,
  decideClaim,
  handleClaim,
  legacyFormat,
  lookupClaim,
  verifyClaim,
  verifyClaimPhoto,
  type ClaimDeps,
} from "../lib/legacy-claims.ts";
import { tmpDir, readJsonl } from "./helpers.ts";

const SECRET = "test-link-secret";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const photo = (bytes: Uint8Array = JPEG) => ({ name: "card.jpg", type: "image/jpeg", size: bytes.length, bytes: async () => bytes });

function setup({ codesJson }: { codesJson?: unknown } = {}) {
  const dir = tmpDir();
  if (codesJson) writeFileSync(path.join(dir, "codes.json"), JSON.stringify(codesJson));
  const emails: { subject: string; body: string }[] = [];
  const logs: string[] = [];
  const claims = createClaimStore(dir);
  const deps: ClaimDeps = {
    dir,
    claims,
    allow: () => true,
    now: () => new Date("2026-10-13T20:00:00Z"),
    notify: async (subject, body) => {
      emails.push({ subject, body });
      return { ok: true };
    },
    log: (m) => logs.push(m),
    siteUrl: "https://mopclothing.com",
    linkSecret: SECRET,
  };
  return { dir, deps, claims, emails, logs };
}

const claim = (deps: ClaimDeps, over: Record<string, string> = {}, p: ReturnType<typeof photo> | null = photo()) =>
  handleClaim({ code: "COW-76", name: "Ana", fact: "I surf at Morro Rock", contact: "@ana_surfs", ...over }, p, "1.2.3.4", deps);

test("the old card format: 9 animals, two digits from 2 3 6 7 8 (225 codes)", () => {
  assert.equal(legacyFormat("COW-76"), "COW-76");
  assert.equal(legacyFormat("cow 76"), "COW-76");
  assert.equal(legacyFormat("cow76"), "COW-76");
  assert.equal(legacyFormat("COW-74"), null); // 4 isn't used
  assert.equal(legacyFormat("PIG-76"), null); // not one of the animals
  assert.equal(legacyFormat("COW-76-K3P9"), null); // a new registration code
  assert.equal(legacyFormat(42), null);
  let n = 0;
  for (const a of ["FOX", "OWL", "DOG", "BAT", "ANT", "CAT", "RAM", "COW", "HEN"])
    for (const x of "0123456789") for (const y of "0123456789") if (legacyFormat(`${a}-${x}${y}`)) n++;
  assert.equal(n, 225);
});

test("first claim succeeds: saved (append-only), photo kept, John emailed with private links", async () => {
  const { dir, deps, emails } = setup();
  assert.deepEqual(await lookupClaim("cow-76", { dir, claims: deps.claims, allow: () => true }, "ip"), { status: "ok", code: "COW-76" });
  const r = await claim(deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  const rows = readJsonl(path.join(dir, LEGACY_CLAIMS_FILE));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "claim");
  assert.equal(rows[0].code, "COW-76");
  assert.equal(rows[0].listed, false);
  assert.equal(rows[0].contact, "@ana_surfs");
  assert.ok(existsSync(path.join(dir, CLAIM_UPLOADS_DIR, rows[0].photo)));
  assert.equal((await deps.claims.get(rows[0].id))!.status, "pending");

  // the notification goes after the response (mocked PingPigeon)
  assert.equal(emails.length, 0);
  await r.after!();
  assert.equal(emails.length, 1);
  const e = emails[0];
  assert.equal(e.subject, "MOP old card claim: COW-76 from Ana");
  for (const want of ["COW-76", "Ana", "I surf at Morro Rock", "@ana_surfs", "not on the saved list"]) assert.ok(e.body.includes(want), want);
  const photoLink = /PHOTO: (https:\/\/mopclothing\.com\/api\/claim-photo\/([0-9a-f]{16})\?sig=([0-9a-f]{32}))/.exec(e.body)!;
  assert.ok(photoLink, "a signed photo link");
  assert.ok(verifyClaimPhoto(photoLink[2], photoLink[3], SECRET));
  const view = /approve or reject: (https:\/\/mopclothing\.com\/moderate\/([0-9a-f]{16})\?action=view-claim&sig=([0-9a-f]{32}))/.exec(e.body)!;
  assert.ok(view, "a signed moderation link");
  assert.ok(verifyClaim(view[2], "view-claim", view[3], SECRET));
  assert.match(e.body, /Nothing is paid or sent automatically/);
});

test("a second claim of the same code is refused, at lookup and at submit", async () => {
  const { dir, deps } = setup();
  assert.equal((await claim(deps)).status, 200);
  assert.deepEqual(await lookupClaim("COW76", { dir, claims: deps.claims, allow: () => true }, "ip"), { status: "claimed" });
  const again = await claim(deps, { name: "Bo" });
  assert.equal(again.status, 409);
  assert.equal(again.body.claimed, true);
  assert.match(again.body.error!, /already been claimed/);
  assert.equal(readJsonl(path.join(dir, LEGACY_CLAIMS_FILE)).length, 1);
  // two at once: only one wins
  const { deps: d2, dir: dir2 } = setup();
  const both = await Promise.all([claim(d2, { name: "A" }), claim(d2, { name: "B" })]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  assert.equal(readJsonl(path.join(dir2, LEGACY_CLAIMS_FILE)).length, 1);
});

test("invalid formats are refused, as before", async () => {
  const { dir, deps } = setup();
  for (const code of ["PIG-76", "COW-74", "hello", "", "COW-76-K3P9"]) {
    assert.deepEqual(await lookupClaim(code, { dir, claims: deps.claims, allow: () => true }, "ip"), { status: "invalid" }, code);
    const r = await claim(deps, { code });
    assert.equal(r.status, 400, code);
    assert.equal(r.body.errors?.code, "Invalid code.");
  }
  assert.equal(existsSync(path.join(dir, LEGACY_CLAIMS_FILE)), false);
});

test("codes: not on codes.json is still claimable; on codes.json (any format) goes the same way; already redeemed there = claimed", async () => {
  const { dir, deps } = setup({
    codesJson: {
      codes: [
        { value: "TIGER-825Z", redeemed: false, redeemedAt: null, user: null },
        { value: "OWL-22", redeemed: true, redeemedAt: "2025-04-01T00:00:00Z", user: { name: "X", fact: "y" } },
        { value: "FOX-38", redeemed: false, redeemedAt: null, user: null },
      ],
    },
  });
  const look = (code: string) => lookupClaim(code, { dir, claims: deps.claims, allow: () => true }, "ip");
  assert.deepEqual(await look("HEN-66"), { status: "ok", code: "HEN-66" }); // not listed
  assert.deepEqual(await look("tiger 825z"), { status: "ok", code: "TIGER-825Z" }); // listed, the first format
  assert.deepEqual(await look("OWL-22"), { status: "claimed" }); // redeemed on the old page
  assert.equal((await claim(deps, { code: "HEN-66" })).status, 200);
  assert.equal((await claim(deps, { code: "OWL-22" })).status, 409);
  const r = await claim(deps, { code: "fox38" });
  assert.equal(r.status, 200);
  const rows = readJsonl(path.join(dir, LEGACY_CLAIMS_FILE));
  assert.deepEqual(rows.map((x) => [x.code, x.listed]), [["HEN-66", false], ["FOX-38", true]]);
});

test("the photo is required (and must really be a photo); name required; contact checked", async () => {
  const { dir, deps } = setup();
  const none = await claim(deps, {}, null);
  assert.equal(none.status, 400);
  assert.equal(none.body.errors?.photo, "Add a photo of your shirt or card");
  const fake = await claim(deps, {}, photo(new TextEncoder().encode("<svg>not a photo</svg>")));
  assert.match(fake.body.errors?.photo ?? "", /Photos only/);
  const big = await claim(deps, {}, { name: "x.jpg", type: "image/jpeg", size: 11 * 1024 * 1024, bytes: async () => JPEG });
  assert.match(big.body.errors?.photo ?? "", /over 10 MB/);
  const noName = await claim(deps, { name: "  " });
  assert.equal(noName.body.errors?.name, "Add your name");
  assert.equal(existsSync(path.join(dir, LEGACY_CLAIMS_FILE)), false);
  assert.deepEqual(cleanContact("Ana@Example.com"), { value: "ana@example.com" });
  assert.deepEqual(cleanContact("@ana.surfs"), { value: "@ana.surfs" });
  assert.deepEqual(cleanContact("https://instagram.com/ana_surfs/"), { value: "@ana_surfs" });
  assert.deepEqual(cleanContact(""), { value: null });
  assert.ok(cleanContact("call me maybe").error);
  // honeypot: looks fine, saves nothing
  assert.deepEqual((await claim(deps, { website: "spam" })).body, { ok: true });
  assert.equal(existsSync(path.join(dir, LEGACY_CLAIMS_FILE)), false);
});

test("rate limits: lookups and claims both refuse when the visitor is over the limit", async () => {
  const { dir, deps } = setup();
  assert.deepEqual(await lookupClaim("COW-76", { dir, claims: deps.claims, allow: () => false }, "ip"), { status: "limited" });
  assert.equal((await handleClaim({ code: "COW-76", name: "A" }, photo(), "ip", { ...deps, allow: () => false })).status, 429);
});

test("moderation: approve marks it approved (and redeemed on codes.json); reject frees the code; links are signed", async () => {
  const { dir, deps } = setup({ codesJson: { codes: [{ value: "FOX-38", redeemed: false, redeemedAt: null, user: null }] } });
  await claim(deps, { code: "FOX-38" });
  await claim(deps, { code: "COW-76" });
  const [fox, cow] = await deps.claims.readAll();
  const approved = await decideClaim(fox.id, "approve-claim", deps);
  assert.equal(approved!.status, "approved");
  assert.equal((await deps.claims.get(fox.id))!.status, "approved");
  const codes = JSON.parse(readFileSync(path.join(dir, "codes.json"), "utf8")).codes;
  assert.equal(codes[0].redeemed, true);
  assert.deepEqual(codes[0].user, { name: "Ana", fact: "I surf at Morro Rock" });
  // approved still blocks a second claim
  assert.equal((await claim(deps, { code: "FOX-38" })).status, 409);

  const rejected = await decideClaim(cow.id, "reject-claim", deps);
  assert.equal(rejected!.status, "rejected");
  // a rejected claim frees the code for a real owner
  assert.equal((await claim(deps, { code: "COW-76", name: "Real Owner" })).status, 200);
  // append-only: claims and status changes are added, never rewritten
  const rows = readJsonl(path.join(dir, LEGACY_CLAIMS_FILE));
  assert.deepEqual(rows.map((r) => r.type), ["claim", "claim", "status", "status", "claim"]);
  assert.equal(await decideClaim("0000000000000000", "approve-claim", deps), undefined);

  // links only work with the right signature and action
  const sig = claimSignature(fox.id, "approve-claim", SECRET);
  assert.ok(verifyClaim(fox.id, "approve-claim", sig, SECRET));
  assert.ok(!verifyClaim(fox.id, "reject-claim", sig, SECRET));
  assert.ok(!verifyClaim(fox.id, "approve-claim", sig, "other-secret"));
  assert.ok(!verifyClaim(fox.id, "approve-claim", sig, undefined));
  assert.ok(!verifyClaim(fox.id, "approve-review", sig, SECRET));
});

test("the email without a link secret still says where the photo is, and never promises a reward", () => {
  const e = claimEmail(
    { id: "0123456789abcdef", code: "COW-76", listed: true, name: "Ana", fact: null, contact: null, photo: "0123456789abcdef.jpg", status: "pending", created_at: "2026-10-13T20:00:00Z" },
    { siteUrl: "https://mopclothing.com", linkSecret: undefined }
  );
  assert.match(e.body, /claim-uploads\/0123456789abcdef\.jpg/);
  assert.match(e.body, /Set MOP_LINK_SECRET/);
  assert.match(e.body, /on the saved list/);
  assert.doesNotMatch(e.body, /\$\d|% off|free shirt/i);
});

test("the old endpoints are retired (no way around the photo check)", () => {
  const root = path.resolve(import.meta.dirname, "..");
  for (const f of ["app/api/redeem/route.ts", "app/api/validate-code/route.ts"]) {
    const src = readFileSync(path.join(root, f), "utf8");
    assert.match(src, /status: 410/, f);
    assert.doesNotMatch(src, /writeCodes/, f);
  }
  const page = readFileSync(path.join(root, "app/redeem/page.tsx"), "utf8");
  assert.match(page, /\/api\/legacy-claim\/lookup/);
  assert.match(page, /Thanks! John will check it and reach out\./);
});
