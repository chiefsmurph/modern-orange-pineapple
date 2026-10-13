// Registration codes: one per item sold, printed on the Printful packing slip,
// entered at /register to register the shirt and leave a verified review.
//
// Format: <ANIMAL>-<NN>-<XXXX>, e.g. COW-76-K3P9. The animal and the two digits
// follow John's legacy redeem codes (lib/db.ts: the same animals and the same
// easy-to-read digits); the last four characters come from an alphabet with no
// 0/O/1/I/L, picked with crypto randomness. That's about 2×10^8 codes, and the
// lookups are rate limited.
//
// Stored in $MOP_DATA_DIR/item-codes.jsonl, one row per code:
//   { code, kind: "item", session_id, order_ref, slug, title, variant, issued_at,
//     registered_at: null, review_id: null }
// An order whose packing slip can't list every item's code also gets one
//   { kind: "order", items: [item codes] } row that registers all of them.
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** John's legacy animals and digits (lib/db.ts generateCode). */
export const ANIMALS = ["FOX", "OWL", "DOG", "BAT", "ANT", "CAT", "RAM", "COW", "HEN"] as const;
export const DIGITS = "23678";
/** No 0/O/1/I/L. */
export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const CODES_FILE = "item-codes.jsonl";

export type ItemCode = {
  code: string;
  kind: "item" | "order";
  session_id: string;
  order_ref: string;
  /** item codes only */
  slug?: string;
  title?: string;
  variant?: Record<string, string>;
  /** order codes only: the item codes it registers */
  items?: string[];
  issued_at: string;
  registered_at: string | null;
  review_id: string | null;
};

const pick = (chars: string | readonly string[], randomInt: (n: number) => number) => chars[randomInt(chars.length)];

export function generateCode(
  taken: Set<string>,
  randomInt: (n: number) => number = (n) => crypto.randomInt(n)
): string {
  for (let i = 0; i < 1000; i++) {
    const code =
      `${pick(ANIMALS, randomInt)}-${pick(DIGITS, randomInt)}${pick(DIGITS, randomInt)}-` +
      Array.from({ length: 4 }, () => pick(ALPHABET, randomInt)).join("");
    if (!taken.has(code)) return code;
  }
  throw new Error("could not find a free code");
}

export type ParsedCode = { kind: "new"; code: string } | { kind: "legacy"; code: string } | { kind: "invalid" };

/**
 * What someone typed, made canonical: case, spaces and separators don't matter
 * ("cow 76 k3p9" -> COW-76-K3P9). Two-part codes (COW-76) are John's legacy
 * redeem codes.
 */
export function parseCode(input: unknown): ParsedCode {
  if (typeof input !== "string") return { kind: "invalid" };
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const full = /^([A-Z]{3})(\d{2})([A-Z0-9]{4})$/.exec(s);
  if (full) return { kind: "new", code: `${full[1]}-${full[2]}-${full[3]}` };
  const legacy = /^([A-Z]{3})(\d{2})$/.exec(s);
  if (legacy) return { kind: "legacy", code: `${legacy[1]}-${legacy[2]}` };
  return { kind: "invalid" };
}

export function createItemCodeStore(dir: string) {
  const file = path.join(dir, CODES_FILE);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const readAll = async (): Promise<ItemCode[]> => {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return text.split("\n").filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l) as ItemCode];
      } catch {
        return [];
      }
    });
  };
  const writeAll = async (rows: ItemCode[]) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, rows.map((r) => JSON.stringify(r) + "\n").join(""), { mode: 0o640 });
    await fs.rename(tmp, file);
  };

  return {
    readAll: () => serial(readAll),

    /**
     * One code per unit sold (qty 3 -> 3 codes). Idempotent per session: a
     * repeated call returns the codes already issued.
     */
    issue(
      order: { session_id: string; order_ref: string; items: { slug: string; title: string; qty: number; opts: Record<string, string> }[] },
      at: string,
      randomInt?: (n: number) => number
    ): Promise<ItemCode[]> {
      return serial(async () => {
        const all = await readAll();
        const mine = all.filter((c) => c.session_id === order.session_id && c.kind === "item");
        if (mine.length) return mine;
        const taken = new Set(all.map((c) => c.code));
        const rows: ItemCode[] = [];
        for (const item of order.items)
          for (let u = 0; u < Math.max(1, item.qty); u++) {
            const code = generateCode(taken, randomInt);
            taken.add(code);
            rows.push({
              code,
              kind: "item",
              session_id: order.session_id,
              order_ref: order.order_ref,
              slug: item.slug,
              title: item.title,
              variant: item.opts,
              issued_at: at,
              registered_at: null,
              review_id: null,
            });
          }
        await fs.mkdir(dir, { recursive: true, mode: 0o750 });
        await fs.appendFile(file, rows.map((r) => JSON.stringify(r) + "\n").join(""), { mode: 0o640 });
        return rows;
      });
    },

    /** An order-level code for these item codes (idempotent per session). */
    issueOrderCode(session_id: string, order_ref: string, items: string[], at: string, randomInt?: (n: number) => number) {
      return serial(async () => {
        const all = await readAll();
        const existing = all.find((c) => c.session_id === session_id && c.kind === "order");
        if (existing) return existing;
        const row: ItemCode = {
          code: generateCode(new Set(all.map((c) => c.code)), randomInt),
          kind: "order",
          session_id,
          order_ref,
          items,
          issued_at: at,
          registered_at: null,
          review_id: null,
        };
        await fs.appendFile(file, JSON.stringify(row) + "\n", { mode: 0o640 });
        return row;
      });
    },

    get: (code: string) => serial(async () => (await readAll()).find((c) => c.code === code)),

    /** The item rows a code stands for (itself, or an order code's items). */
    itemsFor: (code: ItemCode) =>
      serial(async () => {
        if (code.kind === "item") return [code];
        const all = await readAll();
        return (code.items ?? []).map((c) => all.find((r) => r.code === c)).filter(Boolean) as ItemCode[];
      }),

    /**
     * Mark a code (and an order code's items) registered, once. Returns false if
     * it already was. `reviewOn` = the item code the review is about.
     */
    register(code: string, at: string, review: { id: string; on: string } | null): Promise<boolean> {
      return serial(async () => {
        const all = await readAll();
        const row = all.find((c) => c.code === code);
        if (!row || row.registered_at) return false;
        const covered = new Set([row.code, ...(row.items ?? [])]);
        // an item code that's already registered can't be registered again through its order code
        if (row.kind === "order" && all.some((c) => covered.has(c.code) && c.kind === "item" && c.registered_at)) return false;
        for (const c of all) {
          if (!covered.has(c.code)) continue;
          c.registered_at = at;
          if (review && c.code === review.on) c.review_id = review.id;
        }
        await writeAll(all);
        return true;
      });
    },
  };
}

export type ItemCodeStore = ReturnType<typeof createItemCodeStore>;

/** "Pelican Tee: COW-76-K3P9 · Star Polo: HEN-23-X7QZ"-style packing slip text, within `limit`. */
export function packingSlipMessage(
  entries: { name: string; code: string }[],
  orderCode: string | null,
  limit = 200
): string | null {
  if (entries.length === 0) return null;
  const head = "Thanks for supporting Modern Orange Pineapple! Register your shirt + leave a review: mopclothing.com/register";
  if (entries.length === 1) {
    const one = `${head} — Code: ${entries[0].code}`;
    return one.length <= limit ? one : `Register + review at mopclothing.com/register — Code: ${entries[0].code}`;
  }
  const listed = `Thanks for supporting MOP! Register + review at mopclothing.com/register — ${entries.map((e) => `${e.name}: ${e.code}`).join(" · ")}`;
  if (listed.length <= limit) return listed;
  const codesOnly = `Thanks for supporting MOP! Register + review at mopclothing.com/register — Codes: ${entries.map((e) => e.code).join(", ")}`;
  if (codesOnly.length <= limit) return codesOnly;
  if (!orderCode) return null;
  return `Thanks for supporting MOP! Register your ${entries.length} items + leave a review at mopclothing.com/register — Code: ${orderCode}`;
}

/** Short item name for the slip: the product title without the " · …" tail. */
export const shortName = (title: string) => title.split(" · ")[0].replace(/^The /, "").slice(0, 24);

/**
 * One store (one write queue) per data directory for the whole process, shared
 * by every route bundle (the webhook issues codes, /register marks them), so a
 * registration's rewrite can never drop a code the webhook just appended.
 */
export const itemCodeStore = (dir: string): ItemCodeStore => {
  const g = globalThis as unknown as { __mopItemCodes?: Map<string, ItemCodeStore> };
  g.__mopItemCodes ??= new Map();
  let s = g.__mopItemCodes.get(dir);
  if (!s) g.__mopItemCodes.set(dir, (s = createItemCodeStore(dir)));
  return s;
};
