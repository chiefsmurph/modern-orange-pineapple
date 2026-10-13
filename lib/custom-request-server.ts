// Custom orders: the server side of POST /api/custom-request.
// - Honeypot + per-visitor rate limit (salted in-memory IP hash, as for the signup).
// - The same checks as the form (lib/custom-request.ts), plus the upload's real
//   bytes (JPEG / PNG / WebP / HEIC, ≤10 MB).
// - Saved to $MOP_DATA_DIR/custom-requests.jsonl (+ custom-uploads/<id>.<ext>)
//   BEFORE emailing John, so a failed email never loses a request.
// - Nothing the visitor wrote goes to stdout: logs carry the id only.
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  UPLOAD_MAX_BYTES,
  customRequestBody,
  customRequestSubject,
  validateCustomRequest,
  type CustomRequest,
  type CustomRequestInput,
  type FieldErrors,
} from "./custom-request.ts";

export const REQUESTS_FILE = "custom-requests.jsonl";
export const UPLOADS_DIR = "custom-uploads";

export type UploadIn = { name: string; type: string; size: number; bytes: () => Promise<Uint8Array> };

/** What the bytes really are (never trust the name or the browser's type). */
export function sniffImage(b: Uint8Array): "jpg" | "png" | "webp" | "heic" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return "heic";
  return null;
}

/** The link John gets for an upload: an HMAC of the id, so only links we made open it. */
export const uploadSignature = (id: string, secret: string) =>
  crypto.createHmac("sha256", secret).update(`custom-upload:${id}`).digest("hex").slice(0, 32);

export function verifyUploadSignature(id: string, sig: string | null, secret: string | undefined) {
  if (!secret || !sig || !/^[0-9a-f]{32}$/.test(sig) || !/^[0-9a-f]{16}$/.test(id)) return false;
  const want = Buffer.from(uploadSignature(id, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export type CustomRequestDeps = {
  dir: string;
  allow: (ip: string) => boolean;
  now: () => Date;
  /** Base URL for John's upload link, and the secret that signs it; no secret = no link. */
  siteUrl: string;
  linkSecret?: string;
  notify: (subject: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  log: (msg: string) => void;
};

export type CustomRequestResult = {
  status: number;
  body: { ok: boolean; id?: string; errors?: FieldErrors; error?: string };
  after?: () => Promise<void>;
};

/** Fields as the form sends them (multipart strings) -> the validator's input. */
export function inputFromForm(get: (k: string) => string | null): CustomRequestInput & { website?: string } {
  const json = <T,>(k: string, fallback: T): T => {
    try {
      return (JSON.parse(get(k) ?? "") as T) ?? fallback;
    } catch {
      return fallback;
    }
  };
  return {
    who: get("who") ?? undefined,
    description: get("description") ?? undefined,
    link: get("link") ?? undefined,
    items: json<string[]>("items", []),
    quantity: get("quantity") ?? undefined,
    sizes: json<Record<string, string | number>>("sizes", {}),
    notSure: get("notSure") === "true",
    deadline: get("deadline") ?? undefined,
    budget: get("budget") ?? undefined,
    name: get("name") ?? undefined,
    email: get("email") ?? undefined,
    phone: get("phone") ?? undefined,
    website: get("website") ?? undefined,
  };
}

export async function handleCustomRequest(
  input: CustomRequestInput & { website?: string },
  file: UploadIn | null,
  req: { ip: string },
  deps: CustomRequestDeps
): Promise<CustomRequestResult> {
  if (!deps.allow(req.ip)) return { status: 429, body: { ok: false, error: "Too many requests; please try again in a few minutes." } };
  // honeypot: a normal-looking "thanks", nothing saved or sent
  if (input.website && input.website.trim()) return { status: 200, body: { ok: true } };

  const now = deps.now();
  const { errors, value } = validateCustomRequest(input, {
    // a day of slack either side, as the visitor's "today" may differ from the server's
    today: new Date(now.getTime() - 36 * 3600 * 1000).toISOString().slice(0, 10),
  });

  let upload: { bytes: Uint8Array; ext: string } | null = null;
  if (file && file.size > 0) {
    if (file.size > UPLOAD_MAX_BYTES) errors.file = "That image is over 10 MB; try a smaller one";
    else {
      const bytes = await file.bytes();
      const ext = bytes.length > UPLOAD_MAX_BYTES ? null : sniffImage(bytes);
      if (!ext) errors.file = "Images only, please (JPG, PNG, WebP or HEIC)";
      else upload = { bytes, ext };
    }
  }
  if (!value || errors.file) return { status: 400, body: { ok: false, errors } };

  const id = crypto.randomBytes(8).toString("hex");
  const at = now.toISOString();
  let uploadFile: string | null = null;
  try {
    await fs.mkdir(deps.dir, { recursive: true, mode: 0o750 });
    if (upload) {
      const updir = path.join(deps.dir, UPLOADS_DIR);
      await fs.mkdir(updir, { recursive: true, mode: 0o750 });
      uploadFile = `${id}.${upload.ext}`;
      await fs.writeFile(path.join(updir, uploadFile), upload.bytes, { mode: 0o640 });
    }
    const record: CustomRequest & { id: string; at: string; upload: string | null } = { id, at, ...value, upload: uploadFile };
    await fs.appendFile(path.join(deps.dir, REQUESTS_FILE), JSON.stringify(record) + "\n", { mode: 0o640 });
  } catch (err) {
    deps.log(`[custom] could not save request ${id}: ${(err as Error).message}`);
    return { status: 500, body: { ok: false, error: "Something went wrong saving your request; please try again." } };
  }
  deps.log(`[custom] request ${id} saved${uploadFile ? " (with image)" : ""}`);

  const link =
    uploadFile && deps.linkSecret
      ? `${deps.siteUrl.replace(/\/+$/, "")}/api/custom-upload/${id}?sig=${uploadSignature(id, deps.linkSecret)}`
      : null;
  const subject = customRequestSubject(value);
  const body = customRequestBody(value, { id, at, upload: uploadFile ? { link, file: `${UPLOADS_DIR}/${uploadFile}` } : null });
  return {
    status: 200,
    body: { ok: true, id },
    // after the response: the email helper retries once; a failure is logged (id only), the request stays saved
    after: async () => {
      try {
        const r = await deps.notify(subject, body);
        if (!r.ok) deps.log(`[custom] request ${id}: email to John failed (${r.error ?? "unknown"}); it's saved in ${REQUESTS_FILE}`);
      } catch (err) {
        deps.log(`[custom] request ${id}: email to John failed (${(err as Error).message}); it's saved in ${REQUESTS_FILE}`);
      }
    },
  };
}

/** The saved upload for an id (any extension), for John's signed link. */
export async function findUpload(dir: string, id: string): Promise<{ file: string; ext: string } | null> {
  if (!/^[0-9a-f]{16}$/.test(id)) return null;
  const updir = path.join(dir, UPLOADS_DIR);
  let names: string[] = [];
  try {
    names = await fs.readdir(updir);
  } catch {
    return null;
  }
  const name = names.find((n) => n.startsWith(`${id}.`));
  return name ? { file: path.join(updir, name), ext: name.split(".").pop()! } : null;
}
