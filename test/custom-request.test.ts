// Custom orders: shared validation, upload checks and the request handler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  checkUpload,
  customRequestSubject,
  validateCustomRequest,
  type CustomRequestInput,
} from "../lib/custom-request.ts";
import {
  findUpload,
  handleCustomRequest,
  inputFromForm,
  sniffImage,
  uploadSignature,
  verifyUploadSignature,
  type UploadIn,
} from "../lib/custom-request-server.ts";
import { createRateLimiter } from "../lib/subscribers.ts";
import { tmpDir } from "./helpers.ts";

const TODAY = "2026-10-12";
const good: CustomRequestInput = {
  who: "business",
  description: "Our logo on the front, sky print on the back",
  items: ["tee", "polo"],
  quantity: "10",
  sizes: { S: "2", M: "4", L: "3", XL: "1" },
  name: "Ana Diaz",
  email: "Ana@Example.com",
  phone: "+1 (310) 555-0100",
};
const v = (over: Partial<CustomRequestInput>) => validateCustomRequest({ ...good, ...over }, { today: TODAY });

test("a complete request passes and comes out clean", () => {
  const { errors, value } = v({});
  assert.deepEqual(errors, {});
  assert.equal(value!.email, "ana@example.com");
  assert.equal(value!.quantity, 10);
  assert.deepEqual(value!.sizes, { S: 2, M: 4, L: 3, XL: 1 });
  assert.deepEqual(value!.items, ["tee", "polo"]);
  assert.equal(customRequestSubject(value!), "Custom request: business, 10 × Tee + Polo from Ana Diaz");
});

test("the messages the visitor sees", () => {
  assert.equal(v({ quantity: "" }).errors.quantity, "Add a quantity");
  assert.equal(v({ quantity: "0" }).errors.quantity, "Add a quantity");
  assert.equal(v({ quantity: "2.5" }).errors.quantity, "Add a quantity");
  assert.equal(v({ sizes: { M: "8" } }).errors.sizes, "Your sizes add up to 8, but you asked for 10 (or tick 'Not sure yet')");
  assert.equal(v({ sizes: {} }).errors.sizes, "Add how many of each size (they should add up to 10), or tick 'Not sure yet'");
  assert.equal(v({ sizes: { M: "x" } }).errors.sizes, "Use whole numbers for sizes (check M)");
  assert.equal(v({ description: "logo" }).errors.description, "Tell us a bit more about what you want");
  assert.equal(v({ email: "" }).errors.email, "Add your email so we can reply");
  assert.equal(v({ email: "ana@" }).errors.email, "That email doesn't look right");
  assert.equal(v({ name: " " }).errors.name, "Add your name");
  assert.equal(v({ who: "" }).errors.who, "Choose who it's for");
  assert.equal(v({ deadline: "2026-10-01" }).errors.deadline, "Pick a date from today on");
  assert.equal(v({ link: "pinterest" }).errors.link, "That link doesn't look right (it should start with https://)");
  assert.equal(v({ phone: "call me" }).errors.phone, "That phone number doesn't look right");
});

test("'Not sure yet' (or hats only) skips the sizes; optional fields can be empty", () => {
  assert.deepEqual(v({ sizes: { M: "3" }, notSure: true }).errors, {});
  assert.equal(v({ sizes: {}, notSure: true }).value!.sizes, null);
  assert.deepEqual(v({ items: ["hat"], sizes: {} }).errors, {});
  const { errors, value } = v({ items: [], link: "", deadline: "", budget: "", phone: "" });
  assert.deepEqual(errors, {});
  assert.equal(customRequestSubject(value!), "Custom request: business, 10 × item not chosen from Ana Diaz");
  assert.deepEqual(v({ deadline: TODAY, link: "https://www.instagram.com/p/abc" }).errors, {});
});

test("upload checks: type and the 10 MB limit; the server trusts only the bytes", () => {
  assert.equal(checkUpload({ name: "a.pdf", type: "application/pdf", size: 10 }), "Images only, please (JPG, PNG, WebP or HEIC)");
  assert.equal(checkUpload({ name: "a.jpg", type: "image/jpeg", size: 10 * 1024 * 1024 + 1 }), "That image is over 10 MB; try a smaller one");
  assert.equal(checkUpload({ name: "IMG_1.HEIC", type: "", size: 2000 }), null);
  assert.equal(checkUpload(null), null);
  const b = (...xs: (number | string)[]) => new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? x.split("").map((c) => c.charCodeAt(0)) : [x])));
  assert.equal(sniffImage(b(0xff, 0xd8, 0xff, 0xe0)), "jpg");
  assert.equal(sniffImage(b(0x89, "PNG", 13, 10, 26, 10)), "png");
  assert.equal(sniffImage(b("RIFF", 0, 0, 0, 0, "WEBP")), "webp");
  assert.equal(sniffImage(b(0, 0, 0, 24, "ftypheic")), "heic");
  assert.equal(sniffImage(b("%PDF-1.7")), null);
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const upload = (bytes: Uint8Array, name = "logo.png", size = bytes.length): UploadIn => ({ name, type: "image/png", size, bytes: async () => bytes });
const deps = (dir: string, over: Record<string, unknown> = {}) => {
  const logs: string[] = [];
  const mails: { subject: string; body: string }[] = [];
  return {
    logs,
    mails,
    deps: {
      dir,
      allow: () => true,
      now: () => new Date("2026-10-12T20:00:00Z"),
      siteUrl: "https://mopclothing.com",
      linkSecret: "test-link-secret",
      notify: async (subject: string, body: string) => {
        mails.push({ subject, body });
        return { ok: true };
      },
      log: (m: string) => logs.push(m),
      ...over,
    },
  };
};
const req = { ip: "203.0.113.9" };

test("a request is saved with its image, then John gets every field and a signed link", async () => {
  const dir = tmpDir();
  const { deps: d, logs, mails } = deps(dir);
  const r = await handleCustomRequest({ ...good, deadline: "2026-11-01", budget: "around $300", link: "https://example.com/ref" }, upload(png), req, d);
  assert.equal(r.status, 200);
  const id = r.body.id!;
  assert.match(id, /^[0-9a-f]{16}$/);
  const rec = JSON.parse(readFileSync(path.join(dir, "custom-requests.jsonl"), "utf8").trim());
  assert.equal(rec.id, id);
  assert.equal(rec.upload, `${id}.png`);
  assert.equal(rec.email, "ana@example.com");
  assert.deepEqual(readdirSync(path.join(dir, "custom-uploads")), [`${id}.png`]);
  assert.equal(mails.length, 0); // not before the response
  await r.after!();
  assert.equal(mails[0].subject, "Custom request: business, 10 × Tee + Polo from Ana Diaz");
  for (const s of ["ana@example.com", "+1 (310) 555-0100", "Our logo on the front", "S 2, M 4, L 3, XL 1", "2026-11-01", "around $300", "https://example.com/ref"])
    assert.ok(mails[0].body.includes(s), s);
  const link = `https://mopclothing.com/api/custom-upload/${id}?sig=${uploadSignature(id, "test-link-secret")}`;
  assert.ok(mails[0].body.includes(link));
  assert.ok(verifyUploadSignature(id, uploadSignature(id, "test-link-secret"), "test-link-secret"));
  assert.ok(!verifyUploadSignature(id, uploadSignature(id, "other"), "test-link-secret"));
  assert.ok(!verifyUploadSignature(id, null, "test-link-secret"));
  assert.ok(!verifyUploadSignature(id, uploadSignature(id, "x"), undefined));
  assert.deepEqual(await findUpload(dir, id), { file: path.join(dir, "custom-uploads", `${id}.png`), ext: "png" });
  assert.equal(await findUpload(dir, "../../etc/passwd"), null);
  // logs carry the id only: no names, addresses or what they asked for
  assert.ok(logs.every((l) => !/ana|example|logo|310/i.test(l)), logs.join("\n"));
});

test("no link secret: the email says where the image is saved", async () => {
  const { deps: d, mails } = deps(tmpDir(), { linkSecret: undefined });
  const r = await handleCustomRequest(good, upload(png), req, d);
  await r.after!();
  assert.match(mails[0].body, new RegExp(`Reference image: saved on the server as custom-uploads/${r.body.id}\\.png`));
});

test("bad uploads are refused before anything is saved", async () => {
  const dir = tmpDir();
  const { deps: d } = deps(dir);
  const big = await handleCustomRequest(good, upload(png, "big.png", 10 * 1024 * 1024 + 1), req, d);
  assert.equal(big.status, 400);
  assert.equal(big.body.errors!.file, "That image is over 10 MB; try a smaller one");
  const fake = await handleCustomRequest(good, upload(new TextEncoder().encode("not an image"), "x.jpg"), req, d);
  assert.equal(fake.body.errors!.file, "Images only, please (JPG, PNG, WebP or HEIC)");
  assert.deepEqual(readdirSync(dir), []);
});

test("server re-checks the fields (same messages as the form)", async () => {
  const { deps: d } = deps(tmpDir());
  const r = await handleCustomRequest({ ...good, sizes: { M: "8" }, email: "" }, null, req, d);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.errors, {
    sizes: "Your sizes add up to 8, but you asked for 10 (or tick 'Not sure yet')",
    email: "Add your email so we can reply",
  });
});

test("honeypot and rate limit", async () => {
  const dir = tmpDir();
  const { deps: d, mails } = deps(dir);
  const bot = await handleCustomRequest({ ...good, website: "spam" }, null, req, d);
  assert.deepEqual(bot, { status: 200, body: { ok: true } });
  assert.deepEqual(readdirSync(dir), []);
  const { deps: d2 } = deps(tmpDir(), { allow: createRateLimiter({ limit: 1, windowMs: 60_000 }) });
  assert.equal((await handleCustomRequest(good, null, req, d2)).status, 200);
  assert.equal((await handleCustomRequest(good, null, req, d2)).status, 429);
  assert.equal(mails.length, 0);
});

test("a failed email is logged (id only) and the request stays saved", async () => {
  const dir = tmpDir();
  const { deps: d, logs } = deps(dir, { notify: async () => ({ ok: false, error: "HTTP 502" }) });
  const r = await handleCustomRequest(good, null, req, d);
  await r.after!();
  assert.ok(logs.some((l) => l === `[custom] request ${r.body.id}: email to John failed (HTTP 502); it's saved in custom-requests.jsonl`));
  assert.equal(readFileSync(path.join(dir, "custom-requests.jsonl"), "utf8").trim().split("\n").length, 1);
});

test("form fields arrive as multipart strings", () => {
  const f: Record<string, string> = { who: "personal", items: '["tee","hat"]', sizes: '{"M":"1"}', notSure: "true", quantity: "1", website: "" };
  const input = inputFromForm((k) => f[k] ?? null);
  assert.deepEqual(input.items, ["tee", "hat"]);
  assert.deepEqual(input.sizes, { M: "1" });
  assert.equal(input.notSure, true);
  assert.deepEqual(inputFromForm((k) => (k === "items" ? "{bad" : null)).items, []);
});
