// Custom orders (/custom): the request form's fields and their checks, shared
// by the form (live messages) and the server (the same rules, re-checked).
// Pure: no Node or browser APIs, so both sides import it.

export const WHO = ["personal", "business"] as const;
export type Who = (typeof WHO)[number];

export const ITEM_TYPES = [
  { id: "tee", label: "Tee" },
  { id: "all-over", label: "All-over" },
  { id: "crop-top", label: "Crop top" },
  { id: "polo", label: "Polo" },
  { id: "hat", label: "Hat" },
  { id: "shorts", label: "Shorts" },
  { id: "other", label: "Other" },
] as const;
export type ItemType = (typeof ITEM_TYPES)[number]["id"];

export const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"] as const;
export type Size = (typeof SIZES)[number];

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};
export const UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif";

export type CustomRequestInput = {
  who?: string;
  description?: string;
  link?: string;
  items?: string[];
  quantity?: string | number;
  sizes?: Partial<Record<string, string | number>>;
  notSure?: boolean;
  deadline?: string;
  budget?: string;
  name?: string;
  email?: string;
  phone?: string;
};

export type CustomRequest = {
  who: Who;
  description: string;
  link: string | null;
  items: ItemType[];
  quantity: number;
  sizes: Partial<Record<Size, number>> | null; // null = "not sure yet" (or one-size items)
  deadline: string | null;
  budget: string | null;
  name: string;
  email: string;
  phone: string | null;
};

export type FieldErrors = Partial<Record<
  "who" | "description" | "link" | "items" | "quantity" | "sizes" | "deadline" | "budget" | "name" | "email" | "phone" | "file",
  string
>>;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
export const isEmail = (s: string) => s.length >= 6 && s.length <= 254 && EMAIL_RE.test(s);

const intOf = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  return /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Today as YYYY-MM-DD in the visitor's (or server's) local time. */
export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export const sizesTotal = (sizes: CustomRequestInput["sizes"]) =>
  SIZES.reduce((n, s) => n + (intOf(sizes?.[s]) ?? 0), 0);

/**
 * Check a request. Messages are written for the visitor. `value` is the clean
 * request when there are no errors.
 */
export function validateCustomRequest(
  input: CustomRequestInput,
  { today = todayIso() }: { today?: string } = {}
): { errors: FieldErrors; value: CustomRequest | null } {
  const errors: FieldErrors = {};

  const who = WHO.find((w) => w === input.who);
  if (!who) errors.who = "Choose who it's for";

  const description = str(input.description, 4000);
  if (description.length < 10) errors.description = "Tell us a bit more about what you want";

  const link = str(input.link, 500);
  if (link && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(link)) errors.link = "That link doesn't look right (it should start with https://)";

  const items = ITEM_TYPES.map((t) => t.id).filter((id) => input.items?.includes(id));

  const quantity = intOf(input.quantity);
  if (quantity === null || quantity < 1) errors.quantity = "Add a quantity";
  else if (quantity > 100000) errors.quantity = "That's a lot! Tell us the number in the description instead";

  // Sizes must add up to the quantity, unless "not sure yet" or every item is one-size (hats).
  const oneSizeOnly = items.length > 0 && items.every((i) => i === "hat");
  let sizes: CustomRequest["sizes"] = null;
  if (!input.notSure && !oneSizeOnly) {
    const bad = SIZES.filter((s) => {
      const v = input.sizes?.[s];
      return v !== undefined && v !== "" && intOf(v) === null;
    });
    const total = sizesTotal(input.sizes);
    if (bad.length) errors.sizes = `Use whole numbers for sizes (check ${bad.join(", ")})`;
    else if (quantity !== null && quantity >= 1 && total !== quantity)
      errors.sizes =
        total === 0
          ? `Add how many of each size (they should add up to ${quantity}), or tick 'Not sure yet'`
          : `Your sizes add up to ${total}, but you asked for ${quantity} (or tick 'Not sure yet')`;
    sizes = Object.fromEntries(
      SIZES.map((s) => [s, intOf(input.sizes?.[s]) ?? 0]).filter(([, n]) => (n as number) > 0)
    ) as CustomRequest["sizes"];
  }

  const deadline = str(input.deadline, 10);
  if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(Date.parse(deadline))))
    errors.deadline = "Pick a date";
  else if (deadline && deadline < today) errors.deadline = "Pick a date from today on";

  const budget = str(input.budget, 200);

  const name = str(input.name, 100);
  if (!name) errors.name = "Add your name";

  const email = str(input.email, 254).toLowerCase();
  if (!email) errors.email = "Add your email so we can reply";
  else if (!isEmail(email)) errors.email = "That email doesn't look right";

  const phone = str(input.phone, 40);
  if (phone && (!/^[+()\d\s.\-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7 || phone.replace(/\D/g, "").length > 15))
    errors.phone = "That phone number doesn't look right";

  if (Object.keys(errors).length) return { errors, value: null };
  return {
    errors,
    value: {
      who: who!,
      description,
      link: link || null,
      items,
      quantity: quantity!,
      sizes,
      deadline: deadline || null,
      budget: budget || null,
      name,
      email,
      phone: phone || null,
    },
  };
}

/** Client-side check of a chosen file (the server checks the bytes too). */
export function checkUpload(file: { name: string; type: string; size: number } | null | undefined): string | null {
  if (!file) return null;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const typeOk = file.type in UPLOAD_TYPES || ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext);
  if (!typeOk) return "Images only, please (JPG, PNG, WebP or HEIC)";
  if (file.size > UPLOAD_MAX_BYTES) return "That image is over 10 MB; try a smaller one";
  if (file.size === 0) return "That file is empty";
  return null;
}

const itemLabel = (id: string) => ITEM_TYPES.find((t) => t.id === id)?.label ?? id;

/** "Custom request: business, 10 × Tee + Polo from Ana Diaz" */
export const customRequestSubject = (r: CustomRequest) =>
  `Custom request: ${r.who}, ${r.quantity} × ${r.items.length ? r.items.map(itemLabel).join(" + ") : "item not chosen"} from ${r.name}`;

/** The email to John: every field, so he can reply straight away. */
export function customRequestBody(
  r: CustomRequest,
  meta: { id: string; at: string; upload: { link: string | null; file: string } | null }
) {
  const lines = [
    `New custom request ${meta.id} (${meta.at})`,
    "",
    `Who: ${r.who === "business" ? "A business or team" : "Just me"}`,
    `Items: ${r.items.length ? r.items.map(itemLabel).join(", ") : "not chosen"}`,
    `Quantity: ${r.quantity}`,
    `Sizes: ${r.sizes && Object.keys(r.sizes).length ? Object.entries(r.sizes).map(([s, n]) => `${s} ${n}`).join(", ") : "not sure yet"}`,
    `Deadline: ${r.deadline ?? "none given"}`,
    `Budget: ${r.budget ?? "none given"}`,
    "",
    "What they want:",
    r.description,
    "",
    `Link: ${r.link ?? "none"}`,
    `Reference image: ${
      meta.upload ? (meta.upload.link ? meta.upload.link : `saved on the server as ${meta.upload.file} (id ${meta.id})`) : "none"
    }`,
    "",
    "Reply to:",
    `${r.name}`,
    `Email: ${r.email}`,
    `Phone: ${r.phone ?? "not given"}`,
  ];
  return lines.join("\n");
}
