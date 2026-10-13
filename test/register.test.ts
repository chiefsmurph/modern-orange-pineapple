// Registration codes, the packing slip, /register, reviews, moderation and The MOP Crew.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  ALPHABET,
  ANIMALS,
  createItemCodeStore,
  generateCode,
  packingSlipMessage,
  parseCode,
} from "../lib/item-codes.ts";
import {
  approvedReviews,
  createReviewStore,
  crewPhotos,
  makeCrewCopies,
  moderationSignature,
  validateWrittenReview,
  verifyModeration,
  verifyPhotoSignature,
  photoSignature,
} from "../lib/reviews.ts";
import { handleRegister, lookupCode } from "../lib/register-server.ts";
import { handleStripeEvent } from "../lib/orders/process.ts";
import { printfulOrderRequest } from "../lib/orders/printful.ts";
import { buildOrderRecord } from "../lib/orders/session.ts";
import { ProductReviews, RatingSummary } from "../components/ProductReviews.ts";
import { fakeFetch, happyResponder, makeDeps, makeEvent, makeSession, printfulItem, tmpDir, yoycolItem } from "./helpers.ts";

const CODE_RE = /^(FOX|OWL|DOG|BAT|ANT|CAT|RAM|COW|HEN)-[23678]{2}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

test("codes: John's animals and digits, an unambiguous tail, never repeated", () => {
  assert.equal(ANIMALS.length, 9);
  for (const c of "0O1IL") assert.ok(!ALPHABET.includes(c), c);
  const taken = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const c = generateCode(taken);
    assert.match(c, CODE_RE);
    assert.ok(!taken.has(c));
    taken.add(c);
  }
  // a random source that keeps repeating itself still can't produce a duplicate
  let calls = 0;
  const stuck = (n: number) => (calls++ < 9 ? 0 : (calls * 7) % n);
  const first = generateCode(new Set(), () => 0);
  assert.notEqual(generateCode(new Set([first]), stuck), first);
});

test("typed codes: case, spaces and dashes don't matter; two-part codes are legacy", () => {
  assert.deepEqual(parseCode(" cow 76 k3p9 "), { kind: "new", code: "COW-76-K3P9" });
  assert.deepEqual(parseCode("COW76K3P9"), { kind: "new", code: "COW-76-K3P9" });
  assert.deepEqual(parseCode("cow-76"), { kind: "legacy", code: "COW-76" });
  assert.deepEqual(parseCode("hello"), { kind: "invalid" });
  assert.deepEqual(parseCode(42), { kind: "invalid" });
});

test("one code per unit (qty 3 -> 3), idempotent per order, unique across orders", async () => {
  const store = createItemCodeStore(tmpDir());
  const items = [{ slug: "pelican-tee", title: "Pelican Tee", qty: 3, opts: { version: "large", size: "M" } }];
  const a = await store.issue({ session_id: "cs_1", order_ref: "mop-1", items }, "t");
  assert.equal(a.length, 3);
  assert.deepEqual(await store.issue({ session_id: "cs_1", order_ref: "mop-1", items }, "t"), a); // a repeat issues nothing new
  for (let i = 2; i < 60; i++) await store.issue({ session_id: `cs_${i}`, order_ref: `mop-${i}`, items }, "t");
  const all = await store.readAll();
  assert.equal(all.length, 3 + 58 * 3);
  assert.equal(new Set(all.map((c) => c.code)).size, all.length);
  assert.ok(all.every((c) => c.registered_at === null && c.review_id === null && CODE_RE.test(c.code)));
});

test("packing slip text: one code, several, and the order-code fallback; always ≤200 characters", () => {
  const one = packingSlipMessage([{ name: "Pelican Tee", code: "COW-76-K3P9" }], null)!;
  assert.equal(one, "Thanks for supporting Modern Orange Pineapple! Register your shirt + leave a review: mopclothing.com/register — Code: COW-76-K3P9");
  const two = packingSlipMessage([{ name: "Pelican Tee", code: "COW-76-K3P9" }, { name: "Star Polo", code: "HEN-23-X7QZ" }], null)!;
  assert.match(two, /Pelican Tee: COW-76-K3P9 · Star Polo: HEN-23-X7QZ/);
  const many = Array.from({ length: 12 }, (_, i) => ({ name: "Alpaca Tee", code: `FOX-2${i % 8}-ABC${i % 9}` }));
  assert.equal(packingSlipMessage(many, null), null); // too long: ask for an order code
  const withOrder = packingSlipMessage(many, "OWL-88-ZZZZ")!;
  assert.match(withOrder, /Register your 12 items .* Code: OWL-88-ZZZZ/);
  for (const m of [one, two, withOrder]) assert.ok(m.length <= 200, `${m.length}`);
});

test("webhook: codes are issued, printed on the Printful packing slip (DRY-RUN payload) and listed for John", async () => {
  const dir = tmpDir();
  const codes = createItemCodeStore(dir);
  const { fetch } = fakeFetch(happyResponder);
  const deps = makeDeps(dir, fetch, { ORDER_DRY_RUN: "1" }, { codes });
  const session = makeSession([printfulItem({ slug: "pelican-tee", qty: 2 }), yoycolItem()]);
  const res = await handleStripeEvent(makeEvent(session), deps);
  assert.equal(res.status, 200);
  const issued = await codes.readAll();
  assert.equal(issued.length, 3); // 2 Printful + 1 Yoycol
  const pf = issued.filter((c) => c.slug === "pelican-tee").map((c) => c.code);
  const log = deps.logs.join("\n");
  const payload = JSON.parse(log.slice(log.indexOf("{", log.indexOf("DRY-RUN Printful")), log.indexOf("\n}", log.indexOf("DRY-RUN Printful")) + 2));
  assert.equal(payload.packing_slip.store_name, "Modern Orange Pineapple");
  for (const c of pf) assert.ok(payload.packing_slip.message.includes(c), c);
  assert.ok(payload.packing_slip.message.length <= 200);
  const yc = issued.find((c) => c.slug === "clouds-in-sky-shirt")!.code;
  assert.ok(!log.slice(log.indexOf("DRY-RUN Yoycol")).split("DRY-RUN email")[0].includes(yc), "Yoycol has no packing note: not sent");
  const email = log.slice(log.indexOf("DRY-RUN email"));
  for (const c of [...pf, yc]) assert.ok(email.includes(c), `email lists ${c}`);
  assert.match(email, new RegExp(`${yc}: .*NOT printed`));
  // never in the Stripe session (metadata shown in receipts / on the site)
  assert.ok(!JSON.stringify(session).match(CODE_RE));
});

test("printful request carries packing_slip only when given", async () => {
  const rec = await buildOrderRecord(makeSession([printfulItem()]));
  assert.equal(printfulOrderRequest(rec, rec.items, {}).body.packing_slip, undefined);
  const slip = { message: "Code: COW-76-K3P9", store_name: "Modern Orange Pineapple" };
  assert.deepEqual(printfulOrderRequest(rec, rec.items, {}, slip).body.packing_slip, slip);
});

// --- /register ------------------------------------------------------------------

async function setup(over: Record<string, unknown> = {}) {
  const dir = tmpDir();
  const codes = createItemCodeStore(dir);
  const reviews = createReviewStore(dir);
  const [item] = await codes.issue(
    { session_id: "cs_9", order_ref: "mop-9", items: [{ slug: "pelican-tee", title: "Pelican Tee", qty: 1, opts: { version: "large", style: "beanie", color: "Lagoon Blue", size: "M" } }] },
    "2026-10-12T00:00:00Z"
  );
  const mails: { subject: string; body: string }[] = [];
  const subscribed: string[] = [];
  const logs: string[] = [];
  const deps = {
    dir,
    codes,
    reviews,
    allow: () => true,
    now: () => new Date("2026-10-12T21:00:00Z"),
    subscribe: async (e: string) => void subscribed.push(e),
    notify: async (subject: string, body: string) => (mails.push({ subject, body }), { ok: true }),
    log: (m: string) => logs.push(m),
    siteUrl: "https://mopclothing.com",
    linkSecret: "secret-for-tests",
    reward: null as null | { code: string; off: string },
    ...over,
  };
  return { dir, codes, reviews, item, deps, mails, subscribed, logs };
}
const png = async () => new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#3388cc" } }).withMetadata({ exif: { IFD0: { Copyright: "secret-gps-test" } } }).jpeg().toBuffer());
const upload = (bytes: Uint8Array) => ({ name: "me.jpg", type: "image/jpeg", size: bytes.length, bytes: async () => bytes });

test("lookup: valid (with the piece), legacy, invalid, used", async () => {
  const { codes, item } = await setup();
  const d = { codes, allow: () => true };
  const ok = await lookupCode(item.code.toLowerCase().replace(/-/g, " "), d, "ip");
  assert.equal(ok.status, "ok");
  assert.equal((ok as any).items[0].summary, "Big · Grind Beanie · Lagoon Blue · M");
  assert.equal((ok as any).items[0].title, "Pelican Tee");
  assert.deepEqual(await lookupCode("cow 76", d, "ip"), { status: "legacy", code: "COW-76" });
  assert.deepEqual(await lookupCode("COW-76-ZZZZ", d, "ip"), { status: "invalid" });
  await codes.register(item.code, "t", null);
  assert.deepEqual(await lookupCode(item.code, d, "ip"), { status: "used" });
  assert.deepEqual(await lookupCode(item.code, { codes, allow: () => false }, "ip"), { status: "limited" });
});

test("register with a review and a photo: saved pending, opt-in, John's email with signed links; a second try is 'already registered'", async () => {
  const { item, deps, mails, subscribed, reviews, codes, logs, dir } = await setup({ reward: { code: "THANKS10", off: "10%" } });
  const r = await handleRegister(
    { code: item.code, firstName: "Ana", email: "Ana@Example.com", optIn: true, stars: "5", title: "Love it", text: "Soft, heavy, and people stop me to ask about it.", connection: true, featureOk: true },
    upload(await png()),
    "ip",
    deps
  );
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.reward, { code: "THANKS10", off: "10%" });
  await r.after!();
  assert.deepEqual(subscribed, ["ana@example.com"]);
  const [rev] = await reviews.readAll();
  assert.equal(rev.review_status, "pending");
  assert.equal(rev.photo_status, "pending");
  assert.equal(rev.connection, true);
  assert.equal(rev.feature_ok, true);
  assert.ok(existsSync(path.join(dir, "review-uploads", rev.photo!)));
  const row = (await codes.readAll())[0];
  assert.equal(row.registered_at, "2026-10-12T21:00:00.000Z");
  assert.equal(row.review_id, rev.id);
  assert.equal(mails[0].subject, "MOP registration: Ana, Pelican Tee (★5 review + photo)");
  const body = mails[0].body;
  for (const a of ["approve-review", "hide-review", "approve-photo", "hide-photo"] as const)
    assert.ok(body.includes(`/moderate/${rev.id}?action=${a}&sig=${moderationSignature(rev.id, a, "secret-for-tests")}`), a);
  assert.ok(body.includes(`/api/review-photo/${rev.id}?sig=${photoSignature(rev.id, "secret-for-tests")}`));
  assert.match(body, /Add to Out in the wild\? \(not automatic\)/);
  assert.match(body, /Friend of MOP/);
  assert.ok(logs.every((l) => !/Ana|Love it|example/.test(l)), logs.join("\n"));
  const again = await handleRegister({ code: item.code, firstName: "Ana" }, null, "ip", deps);
  assert.equal(again.status, 409);
  assert.equal(again.body.used, true);
});

test("register: photo only is fine; review checks; plain registration; honeypot; rate limit", async () => {
  const s1 = await setup();
  const photoOnly = await handleRegister({ code: s1.item.code, firstName: "Bo", featureOk: false }, upload(await png()), "ip", s1.deps);
  assert.equal(photoOnly.status, 200);
  const [rev] = await s1.reviews.readAll();
  assert.equal(rev.review_status, null);
  assert.equal(rev.photo_status, "pending");
  assert.equal(rev.feature_ok, false);

  const s2 = await setup();
  const bad = await handleRegister({ code: s2.item.code, firstName: "", stars: "6", title: "x", text: "short", email: "nope", optIn: true }, null, "ip", s2.deps);
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.errors, {
    firstName: "Add your first name",
    email: "That email doesn't look right",
    stars: "Pick 1 to 5 stars",
    title: "Add a short title",
    text: "Tell us a bit more (at least 10 characters)",
  });
  assert.equal((await s2.codes.readAll())[0].registered_at, null); // nothing registered on errors
  const plain = await handleRegister({ code: s2.item.code, firstName: "Cy" }, null, "ip", s2.deps);
  assert.equal(plain.status, 200);
  assert.deepEqual(await s2.reviews.readAll(), []);
  assert.equal(plain.body.reward, undefined); // no reward unless configured

  const s3 = await setup();
  assert.deepEqual(await handleRegister({ code: s3.item.code, firstName: "Bot", website: "x" }, null, "ip", s3.deps), { status: 200, body: { ok: true } });
  assert.equal((await s3.codes.readAll())[0].registered_at, null);
  const limited = await handleRegister({ code: s3.item.code, firstName: "Dee" }, null, "ip", { ...s3.deps, allow: () => false });
  assert.equal(limited.status, 429);
  const legacy = await handleRegister({ code: "COW-76", firstName: "Dee" }, null, "ip", s3.deps);
  assert.equal(legacy.status, 400);
});

test("review validation on its own", () => {
  assert.deepEqual(validateWrittenReview({}), { errors: {}, value: null });
  assert.deepEqual(validateWrittenReview({ stars: 4, title: "Great", text: "Fits well and the print is crisp." }).value, { stars: 4, title: "Great", text: "Fits well and the print is crisp." });
  assert.equal(validateWrittenReview({ stars: 4, title: "Great", text: "x".repeat(1001) }).errors.text, "Please keep it under 1,000 characters");
});

test("moderation: signed per review and action; reviews and photos approved separately; photos need the owner's OK", async () => {
  const s = await setup();
  const r = await handleRegister(
    { code: s.item.code, firstName: "Ana", stars: "4", title: "Nice", text: "Comfortable and the colours pop.", connection: true, featureOk: true },
    upload(await png()),
    "ip",
    s.deps
  );
  assert.equal(r.status, 200);
  const [rev] = await s.reviews.readAll();
  const sig = moderationSignature(rev.id, "approve-review", "secret-for-tests");
  assert.ok(verifyModeration(rev.id, "approve-review", sig, "secret-for-tests"));
  assert.ok(!verifyModeration(rev.id, "approve-photo", sig, "secret-for-tests")); // a signature is for one action
  assert.ok(!verifyModeration(rev.id, "approve-review", sig, "other-secret"));
  assert.ok(!verifyModeration(rev.id, "approve-review", sig, undefined));
  assert.ok(!verifyModeration(rev.id, "delete", sig, "secret-for-tests"));
  assert.ok(verifyPhotoSignature(rev.id, photoSignature(rev.id, "secret-for-tests"), "secret-for-tests"));

  assert.equal(approvedReviews(await s.reviews.readAll(), "pelican-tee").count, 0); // pending isn't shown
  await s.reviews.moderate(rev.id, "approve-review", "t1");
  let shown = approvedReviews(await s.reviews.readAll(), "pelican-tee");
  assert.equal(shown.count, 1);
  assert.equal(shown.average, 4);
  assert.equal((await s.reviews.get(rev.id))!.photo_status, "pending"); // the photo is its own decision
  assert.deepEqual(await crewPhotos(await s.reviews.readAll(), s.dir), []);

  await s.reviews.moderate(rev.id, "approve-photo", "t2");
  const approved = (await s.reviews.get(rev.id))!;
  await makeCrewCopies(s.dir, approved);
  const crew = await crewPhotos(await s.reviews.readAll(), s.dir);
  assert.equal(crew.length, 1);
  assert.equal(crew[0].first_name, "Ana");
  const sq = await sharp(path.join(s.dir, "crew", `${rev.id}-sq.webp`)).metadata();
  assert.deepEqual([sq.width, sq.height], [500, 500]);
  const full = await sharp(path.join(s.dir, "crew", `${rev.id}.webp`)).metadata();
  assert.ok(Math.max(full.width!, full.height!) <= 1000);
  assert.equal(full.exif, undefined); // metadata stripped
  assert.ok(!readFileSync(path.join(s.dir, "crew", `${rev.id}.webp`)).includes("secret-gps-test"));

  await s.reviews.moderate(rev.id, "hide-review", "t3");
  shown = approvedReviews(await s.reviews.readAll(), "pelican-tee");
  assert.equal(shown.count, 0);

  // without the owner's OK, a photo can't be approved for display
  const s2 = await setup();
  await handleRegister({ code: s2.item.code, firstName: "Bo", featureOk: false }, upload(await png()), "ip", s2.deps);
  const [r2] = await s2.reviews.readAll();
  await s2.reviews.moderate(r2.id, "approve-photo", "t");
  assert.equal((await s2.reviews.get(r2.id))!.photo_status, "pending");
});

test("product page: stars, title, text, first name, 'Verified buyer', and the FTC 'Friend of MOP' tag", () => {
  const data = {
    average: 4.5,
    count: 2,
    reviews: [
      { id: "a", stars: 5, title: "Love it", text: "So soft.", first_name: "Ana", connection: true, variant: {}, date: "2026-10-12" },
      { id: "b", stars: 4, title: "Great fit", text: "True to size.", first_name: "Bo", connection: false, variant: {}, date: "2026-10-11" },
    ],
  };
  const html = renderToStaticMarkup(createElement(ProductReviews, { data }));
  assert.match(html, /★★★★★[\s\S]*Love it[\s\S]*So soft\.[\s\S]*Ana[\s\S]*Verified buyer[\s\S]*Friend of MOP/);
  assert.equal(html.match(/Friend of MOP/g)!.length, 1); // only Ana said she knows John
  assert.equal(html.match(/Verified buyer/g)!.length, 2);
  assert.match(html, /4\.5 · 2 reviews/);
  assert.equal(renderToStaticMarkup(createElement(RatingSummary, { data: { average: 0, count: 0, reviews: [] } })), "");
  assert.equal(renderToStaticMarkup(createElement(ProductReviews, { data: null })), "");
});
