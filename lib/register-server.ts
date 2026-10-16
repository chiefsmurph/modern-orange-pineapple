// /register: look up a code, then register the item (first name, optional
// email + new-drops opt-in) with an optional review and/or owner photo.
// Each code registers once. Honeypot + rate limits as on the other forms;
// nothing the visitor wrote is logged (ids only).
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCode, type ItemCode, type ItemCodeStore } from "./item-codes.ts";
import {
  REVIEW_UPLOADS_DIR,
  moderationSignature,
  photoSignature,
  validateWrittenReview,
  type ModerationAction,
  type Review,
  type ReviewErrors,
  type ReviewStore,
} from "./reviews.ts";
import { UPLOAD_MAX_BYTES, isEmail } from "./custom-request.ts";
import { sniffImage, type UploadIn } from "./custom-request-server.ts";
import { getShopProductIncludingRetired } from "./catalog/index.ts";
import { imagesFor } from "./catalog/select.ts";
import { valueLabel } from "./catalog/copy.ts";

export const REGISTRATIONS_FILE = "registrations.jsonl";

export type RegisterItem = { code: string; slug: string; title: string; summary: string; image: string | null };

export type LookupResult =
  | { status: "ok"; code: string; items: RegisterItem[] }
  | { status: "legacy"; code: string }
  | { status: "used" }
  | { status: "invalid" }
  | { status: "limited" };

const summaryOf = (slug: string, variant: Record<string, string>) => {
  const labels = getShopProductIncludingRetired(slug)?.optionLabels;
  return Object.entries(variant)
    .map(([k, v]) => valueLabel(k, v, labels))
    .join(" · ");
};

const itemView = (c: ItemCode): RegisterItem => {
  const p = c.slug ? getShopProductIncludingRetired(c.slug) : undefined;
  return {
    code: c.code,
    slug: c.slug ?? "",
    title: c.title ?? p?.title ?? "Your MOP piece",
    summary: summaryOf(c.slug ?? "", c.variant ?? {}),
    image: p ? (imagesFor(p, c.variant ?? {})[0] ?? null) : null,
  };
};

export async function lookupCode(
  input: unknown,
  deps: { codes: ItemCodeStore; allow: (ip: string) => boolean },
  ip: string
): Promise<LookupResult> {
  if (!deps.allow(ip)) return { status: "limited" };
  const parsed = parseCode(input);
  if (parsed.kind === "legacy") return { status: "legacy", code: parsed.code };
  if (parsed.kind === "invalid") return { status: "invalid" };
  const row = await deps.codes.get(parsed.code);
  if (!row) return { status: "invalid" };
  if (row.registered_at) return { status: "used" };
  const items = await deps.codes.itemsFor(row);
  if (items.some((i) => i.registered_at)) return { status: "used" };
  return { status: "ok", code: row.code, items: items.map(itemView) };
}

export type RegisterInput = {
  code?: string;
  firstName?: string;
  email?: string;
  optIn?: boolean;
  reviewOn?: string;
  stars?: string | number;
  title?: string;
  text?: string;
  connection?: boolean;
  featureOk?: boolean;
  website?: string;
};

export type RegisterErrors = ReviewErrors & Partial<Record<"code" | "firstName" | "email" | "photo", string>>;

export type RegisterDeps = {
  dir: string;
  codes: ItemCodeStore;
  reviews: ReviewStore;
  allow: (ip: string) => boolean;
  now: () => Date;
  /** Add to the new-drops list (source "register"). */
  subscribe: (email: string) => Promise<unknown>;
  notify: (subject: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  log: (msg: string) => void;
  siteUrl: string;
  linkSecret?: string;
  reward?: { code: string; off: string } | null;
};

export type RegisterResult = {
  status: number;
  body: { ok: boolean; error?: string; errors?: RegisterErrors; used?: boolean; reward?: { code: string; off: string } };
  after?: () => Promise<void>;
};

export async function handleRegister(
  input: RegisterInput,
  photo: UploadIn | null,
  ip: string,
  deps: RegisterDeps
): Promise<RegisterResult> {
  if (!deps.allow(ip)) return { status: 429, body: { ok: false, error: "Too many tries; please wait a few minutes." } };
  if (input.website && input.website.trim()) return { status: 200, body: { ok: true } }; // honeypot

  const errors: RegisterErrors = {};
  const parsed = parseCode(input.code);
  if (parsed.kind !== "new") return { status: 400, body: { ok: false, errors: { code: "That code doesn't look right" } } };
  const row = await deps.codes.get(parsed.code);
  if (!row) return { status: 400, body: { ok: false, errors: { code: "We couldn't find that code" } } };
  if (row.registered_at) return { status: 409, body: { ok: false, used: true, error: "This code is already registered." } };
  const items = await deps.codes.itemsFor(row);

  const firstName = (input.firstName ?? "").trim().slice(0, 50);
  if (!firstName) errors.firstName = "Add your first name";
  const email = (input.email ?? "").trim().toLowerCase().slice(0, 254);
  if (email && !isEmail(email)) errors.email = "That email doesn't look right";
  if (input.optIn && !email) errors.email = "Add your email to get new-drop emails";

  const written = validateWrittenReview(input);
  Object.assign(errors, written.errors);

  let upload: { bytes: Uint8Array; ext: string } | null = null;
  if (photo && photo.size > 0) {
    if (photo.size > UPLOAD_MAX_BYTES) errors.photo = "That photo is over 10 MB; try a smaller one";
    else {
      const bytes = await photo.bytes();
      const ext = sniffImage(bytes);
      if (!ext) errors.photo = "Photos only, please (JPG, PNG, WebP or HEIC)";
      else upload = { bytes, ext };
    }
  }
  if (Object.keys(errors).length) return { status: 400, body: { ok: false, errors } };

  const target = items.find((i) => i.code === input.reviewOn) ?? items[0];
  const at = deps.now().toISOString();
  const hasReview = !!written.value || !!upload;
  const reviewId = hasReview ? crypto.randomBytes(8).toString("hex") : null;

  // Register first: it's the once-only step (a second, racing attempt loses here).
  const registered = await deps.codes.register(row.code, at, reviewId ? { id: reviewId, on: target.code } : null);
  if (!registered) return { status: 409, body: { ok: false, used: true, error: "This code is already registered." } };

  let review: Review | null = null;
  try {
    if (reviewId) {
      let photoFile: string | null = null;
      if (upload) {
        await fs.mkdir(path.join(deps.dir, REVIEW_UPLOADS_DIR), { recursive: true, mode: 0o750 });
        photoFile = `${reviewId}.${upload.ext}`;
        await fs.writeFile(path.join(deps.dir, REVIEW_UPLOADS_DIR, photoFile), upload.bytes, { mode: 0o640 });
      }
      review = {
        id: reviewId,
        code: row.code,
        item_code: target.code,
        slug: target.slug ?? "",
        product: target.title ?? "",
        variant: target.variant ?? {},
        first_name: firstName,
        connection: !!input.connection,
        stars: written.value?.stars ?? null,
        title: written.value?.title ?? null,
        text: written.value?.text ?? null,
        review_status: written.value ? "pending" : null,
        photo: photoFile,
        feature_ok: !!input.featureOk && !!photoFile,
        photo_status: photoFile ? "pending" : null,
        created_at: at,
      };
      await deps.reviews.add(review);
    }
    await fs.mkdir(deps.dir, { recursive: true, mode: 0o750 });
    await fs.appendFile(
      path.join(deps.dir, REGISTRATIONS_FILE),
      JSON.stringify({ code: row.code, items: items.map((i) => i.code), first_name: firstName, email: email || null, opt_in: !!input.optIn && !!email, at, review_id: reviewId }) + "\n",
      { mode: 0o640 }
    );
  } catch (err) {
    deps.log(`[register] saving the registration details failed: ${(err as Error).message}`);
  }
  deps.log(`[register] code registered${review ? ` with review ${review.id}` : ""}`);

  const email_ = registrationEmail({ firstName, email, optIn: !!input.optIn, items, target, review, deps });
  return {
    status: 200,
    body: { ok: true, ...(deps.reward ? { reward: deps.reward } : {}) },
    after: async () => {
      if (input.optIn && email) await deps.subscribe(email).catch((e) => deps.log(`[register] opt-in failed: ${(e as Error).message}`));
      try {
        const r = await deps.notify(email_.subject, email_.body);
        if (!r.ok) deps.log(`[register] email to John failed (${r.error ?? "unknown"})${review ? ` for review ${review.id}` : ""}`);
      } catch (e) {
        deps.log(`[register] email to John failed (${(e as Error).message})`);
      }
    },
  };
}

function registrationEmail({
  firstName,
  email,
  optIn,
  items,
  target,
  review,
  deps,
}: {
  firstName: string;
  email: string;
  optIn: boolean;
  items: ItemCode[];
  target: ItemCode;
  review: Review | null;
  deps: RegisterDeps;
}) {
  const site = deps.siteUrl.replace(/\/+$/, "");
  const link = (id: string, action: ModerationAction) =>
    deps.linkSecret ? `${site}/moderate/${id}?action=${action}&sig=${moderationSignature(id, action, deps.linkSecret)}` : null;
  const parts = [review?.stars ? `★${review.stars} review` : null, review?.photo ? "photo" : null].filter(Boolean);
  const subject = `MOP registration: ${firstName}, ${target.title}${parts.length ? ` (${parts.join(" + ")})` : ""}`;
  const lines = [
    `${firstName} registered ${items.length === 1 ? "their" : `${items.length}`} MOP piece${items.length === 1 ? "" : "s"}:`,
    ...items.map((i) => `- ${i.code}: ${i.title} (${summaryOf(i.slug ?? "", i.variant ?? {})})`),
    "",
    `Email: ${email || "not given"}${optIn && email ? " (joined the new-drops list)" : ""}`,
  ];
  if (review) {
    lines.push("", `ABOUT: ${review.product} (${summaryOf(review.slug, review.variant)})`);
    if (review.connection) lines.push("They said: I know John / I'm a friend or family of MOP (shows a \"Friend of MOP\" tag).");
    if (review.stars) {
      lines.push("", `REVIEW (pending): ${"★".repeat(review.stars)}${"☆".repeat(5 - review.stars)} ${review.title}`, review.text ?? "");
      const a = link(review.id, "approve-review");
      const h = link(review.id, "hide-review");
      if (a && h) lines.push("", `Approve the review: ${a}`, `Hide the review: ${h}`);
    }
    if (review.photo) {
      const photoLink = deps.linkSecret ? `${site}/api/review-photo/${review.id}?sig=${photoSignature(review.id, deps.linkSecret)}` : null;
      lines.push("", `PHOTO (pending): ${photoLink ?? `saved on the server as ${REVIEW_UPLOADS_DIR}/${review.photo}`}`);
      if (review.feature_ok) {
        const a = link(review.id, "approve-photo");
        const h = link(review.id, "hide-photo");
        if (a && h) lines.push(`Approve photo for The MOP Crew: ${a}`, `Hide the photo: ${h}`);
        lines.push("They said it's OK to feature it. Add to Out in the wild? (not automatic)");
      } else {
        lines.push("Not OK to feature: it stays private.");
      }
    }
    if (!deps.linkSecret) lines.push("", "(Set MOP_LINK_SECRET to get approve/hide links here.)");
  }
  return { subject, body: lines.join("\n") };
}
