// Verified reviews and owner photos ("The MOP Crew"), from /register.
//
// One row per registration that came with a review and/or a photo, in
// $MOP_DATA_DIR/reviews.jsonl:
//   { id, code, item_code, slug, product, variant, first_name, connection,
//     stars, title, text, review_status,        // null when there's no written review
//     photo, feature_ok, photo_status,          // null when there's no photo
//     created_at, review_moderated_at, photo_moderated_at }
// Both parts start "pending"; John approves or hides each one separately from
// signed links in his email. Approved reviews show on the product page;
// approved photos with feature_ok show in The MOP Crew on the home page.
// Original photos stay private (review-uploads/); approval makes web copies
// (crew/<id>-sq.webp 500 px, crew/<id>.webp 1000 px, metadata stripped).
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const REVIEWS_FILE = "reviews.jsonl";
export const REVIEW_UPLOADS_DIR = "review-uploads";
export const CREW_DIR = "crew";

export type Status = "pending" | "approved" | "hidden";

export type Review = {
  id: string;
  code: string;
  item_code: string;
  slug: string;
  product: string;
  variant: Record<string, string>;
  first_name: string;
  connection: boolean;
  stars: number | null;
  title: string | null;
  text: string | null;
  review_status: Status | null;
  photo: string | null;
  feature_ok: boolean;
  photo_status: Status | null;
  created_at: string;
  review_moderated_at?: string | null;
  photo_moderated_at?: string | null;
};

export type ReviewInput = { stars?: unknown; title?: unknown; text?: unknown };
export type ReviewErrors = Partial<Record<"stars" | "title" | "text", string>>;

/** The written part is optional; if any of it is there, all of it must be right. */
export function validateWrittenReview(input: ReviewInput): {
  errors: ReviewErrors;
  value: { stars: number; title: string; text: string } | null;
} {
  const stars = typeof input.stars === "number" ? input.stars : Number(input.stars || 0);
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 100) : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!stars && !title && !text) return { errors: {}, value: null };
  const errors: ReviewErrors = {};
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) errors.stars = "Pick 1 to 5 stars";
  if (title.length < 2) errors.title = "Add a short title";
  if (text.length < 10) errors.text = "Tell us a bit more (at least 10 characters)";
  else if (text.length > 1000) errors.text = "Please keep it under 1,000 characters";
  return Object.keys(errors).length ? { errors, value: null } : { errors, value: { stars, title, text } };
}

// --- moderation links -----------------------------------------------------------

export type ModerationAction = "approve-review" | "hide-review" | "approve-photo" | "hide-photo";
export const ACTIONS: ModerationAction[] = ["approve-review", "hide-review", "approve-photo", "hide-photo"];

export const moderationSignature = (id: string, action: ModerationAction, secret: string) =>
  crypto.createHmac("sha256", secret).update(`review:${id}:${action}`).digest("hex").slice(0, 32);

export function verifyModeration(id: string, action: string, sig: string | null | undefined, secret: string | undefined) {
  if (!secret || !sig || !/^[0-9a-f]{32}$/.test(sig) || !/^[0-9a-f]{16}$/.test(id) || !ACTIONS.includes(action as ModerationAction))
    return false;
  const want = Buffer.from(moderationSignature(id, action as ModerationAction, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export const photoSignature = (id: string, secret: string) =>
  crypto.createHmac("sha256", secret).update(`review-photo:${id}`).digest("hex").slice(0, 32);

export function verifyPhotoSignature(id: string, sig: string | null, secret: string | undefined) {
  if (!secret || !sig || !/^[0-9a-f]{32}$/.test(sig) || !/^[0-9a-f]{16}$/.test(id)) return false;
  const want = Buffer.from(photoSignature(id, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// --- store ----------------------------------------------------------------------

export function createReviewStore(dir: string) {
  const file = path.join(dir, REVIEWS_FILE);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const readAll = async (): Promise<Review[]> => {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return text.split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l) as Review];
      } catch {
        return [];
      }
    });
  };
  return {
    dir,
    readAll: () => serial(readAll),
    get: (id: string) => serial(async () => (await readAll()).find((r) => r.id === id)),
    add: (r: Review) =>
      serial(async () => {
        await fs.mkdir(dir, { recursive: true, mode: 0o750 });
        await fs.appendFile(file, JSON.stringify(r) + "\n", { mode: 0o640 });
      }),
    /** Apply a moderation action; returns the updated row (unchanged if the part doesn't exist). */
    moderate: (id: string, action: ModerationAction, at: string) =>
      serial(async () => {
        const all = await readAll();
        const r = all.find((x) => x.id === id);
        if (!r) return undefined;
        const [verb, part] = action.split("-") as ["approve" | "hide", "review" | "photo"];
        const status: Status = verb === "approve" ? "approved" : "hidden";
        if (part === "review" && r.review_status) {
          r.review_status = status;
          r.review_moderated_at = at;
        }
        if (part === "photo" && r.photo_status) {
          // a photo can only be shown with the owner's OK
          r.photo_status = status === "approved" && !r.feature_ok ? r.photo_status : status;
          r.photo_moderated_at = at;
        }
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, all.map((x) => JSON.stringify(x) + "\n").join(""), { mode: 0o640 });
        await fs.rename(tmp, file);
        return r;
      }),
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;

export const reviewStore = (dir: string): ReviewStore => {
  const g = globalThis as unknown as { __mopReviews?: Map<string, ReviewStore> };
  g.__mopReviews ??= new Map();
  let s = g.__mopReviews.get(dir);
  if (!s) g.__mopReviews.set(dir, (s = createReviewStore(dir)));
  return s;
};

// --- what the site shows --------------------------------------------------------

export type PublicReview = {
  id: string;
  stars: number;
  title: string;
  text: string;
  first_name: string;
  connection: boolean;
  variant: Record<string, string>;
  date: string;
};

/** Approved written reviews for a product (any variant), newest first, with the average. */
export function approvedReviews(all: Review[], slug: string): { average: number; count: number; reviews: PublicReview[] } {
  const reviews = all
    .filter((r) => r.slug === slug && r.review_status === "approved" && r.stars && r.title && r.text)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => ({
      id: r.id,
      stars: r.stars!,
      title: r.title!,
      text: r.text!,
      first_name: r.first_name,
      connection: r.connection,
      variant: r.variant,
      date: r.created_at.slice(0, 10),
    }));
  const average = reviews.length ? Math.round((reviews.reduce((n, r) => n + r.stars, 0) / reviews.length) * 10) / 10 : 0;
  return { average, count: reviews.length, reviews };
}

export type CrewPhoto = {
  id: string;
  first_name: string;
  product: string;
  slug: string;
  src: string;
  square: string;
  width: number;
  height: number;
};

/** Approved owner photos the owner said may be featured, for The MOP Crew. */
export async function crewPhotos(all: Review[], dir: string): Promise<CrewPhoto[]> {
  const out: CrewPhoto[] = [];
  for (const r of all) {
    if (r.photo_status !== "approved" || !r.feature_ok || !r.photo) continue;
    const meta = await fs.readFile(path.join(dir, CREW_DIR, `${r.id}.json`), "utf8").then(JSON.parse).catch(() => null);
    if (!meta) continue; // web copies not made yet
    out.push({
      id: r.id,
      first_name: r.first_name,
      product: r.product,
      slug: r.slug,
      src: `/api/crew-photo/${r.id}`,
      square: `/api/crew-photo/${r.id}?size=square`,
      width: meta.width,
      height: meta.height,
    });
  }
  return out;
}

/** On photo approval: the web copies (EXIF/GPS stripped, upright), kept in the data dir. */
export async function makeCrewCopies(dir: string, r: Review) {
  if (!r.photo) return;
  const sharp = (await import("sharp")).default;
  const src = path.join(dir, REVIEW_UPLOADS_DIR, r.photo);
  const out = path.join(dir, CREW_DIR);
  await fs.mkdir(out, { recursive: true, mode: 0o750 });
  // .rotate() applies the EXIF orientation; sharp writes no metadata unless asked
  const full = await sharp(src).rotate().resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  const square = await sharp(src).rotate().resize({ width: 500, height: 500, fit: "cover", position: sharp.strategy.attention }).webp({ quality: 78 }).toBuffer();
  await fs.writeFile(path.join(out, `${r.id}.webp`), full.data, { mode: 0o640 });
  await fs.writeFile(path.join(out, `${r.id}-sq.webp`), square, { mode: 0o640 });
  await fs.writeFile(path.join(out, `${r.id}.json`), JSON.stringify({ width: full.info.width, height: full.info.height }), { mode: 0o640 });
}
