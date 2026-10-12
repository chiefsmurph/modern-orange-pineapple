// Order persistence in $MOP_DATA_DIR (production: /var/lib/mopclothing; locally ./data):
//   orders.jsonl        append-only: an "order" line when a paid session arrives
//                       (written BEFORE any supplier call), a "fulfilment" line after.
//   royalties.jsonl     one line per royalty-bearing item.
//   orders-state.json   per session: progress through the steps. This is what
//                       makes the webhook idempotent (Stripe retries and repeats events).
// All state changes go through one in-process queue (the site is one Node process).
import { promises as fs } from "node:fs";
import path from "node:path";
import type { OrderRecord, RoyaltyRow, SupplierResult } from "./types.ts";

export type SessionStatus =
  | "processing"
  | "awaiting_payment"
  | "done"
  | "done_with_errors"
  | "error";

export type SessionEntry = {
  status: SessionStatus;
  order_ref?: string;
  started_at: string;
  updated_at: string;
  attempts: number;
  record?: OrderRecord;
  /** Per supplier group ("printful", "yoycol", "manual"). */
  suppliers: Record<string, SupplierResult>;
  royalties_written?: boolean;
  royalty_total?: number;
  emailed?: boolean;
  email_error?: string;
  error?: string;
};

type State = { sessions: Record<string, SessionEntry> };

/** A "processing" claim older than this is treated as abandoned (crash) and resumed. */
export const STALE_MS = 10 * 60 * 1000;

export type Claim =
  | { proceed: true; entry: SessionEntry; resumed: boolean }
  | { proceed: false; entry: SessionEntry };

export const dataDir = (env: Record<string, string | undefined> = process.env) =>
  path.resolve(env.MOP_DATA_DIR || path.join(process.cwd(), "data"));

export function createOrderStore(dir: string) {
  const statePath = path.join(dir, "orders-state.json");
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const ensureDir = () => fs.mkdir(dir, { recursive: true, mode: 0o750 });

  async function load(): Promise<State> {
    let text: string;
    try {
      text = await fs.readFile(statePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { sessions: {} };
      throw err;
    }
    // A corrupt state file must stop processing, not reset it: resetting could re-order everything.
    return JSON.parse(text) as State;
  }

  async function save(state: State) {
    await ensureDir();
    const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 1), { mode: 0o640 });
    await fs.rename(tmp, statePath);
  }

  async function appendLine(file: string, row: unknown) {
    await ensureDir();
    await fs.appendFile(path.join(dir, file), JSON.stringify(row) + "\n", { mode: 0o640 });
  }

  return {
    dir,

    /** Take a session for processing, or say why not (already done / in progress). */
    claim(sessionId: string, now: Date): Promise<Claim> {
      return serial(async () => {
        const state = await load();
        const at = now.toISOString();
        const prev = state.sessions[sessionId];
        if (prev) {
          const stale =
            prev.status === "processing" &&
            now.getTime() - Date.parse(prev.updated_at) > STALE_MS;
          const resumable = prev.status === "error" || prev.status === "awaiting_payment" || stale;
          if (!resumable) return { proceed: false, entry: prev };
          const entry: SessionEntry = {
            ...prev,
            status: "processing",
            updated_at: at,
            attempts: prev.attempts + 1,
            error: undefined,
          };
          // A session that was waiting for payment is re-read from the new event.
          if (prev.status === "awaiting_payment") entry.record = undefined;
          state.sessions[sessionId] = entry;
          await save(state);
          return { proceed: true, entry, resumed: true };
        }
        const entry: SessionEntry = {
          status: "processing",
          started_at: at,
          updated_at: at,
          attempts: 1,
          suppliers: {},
        };
        state.sessions[sessionId] = entry;
        await save(state);
        return { proceed: true, entry, resumed: false };
      });
    },

    /** Change a session's entry and save; returns the new entry. */
    update(
      sessionId: string,
      now: Date,
      change: (entry: SessionEntry) => void
    ): Promise<SessionEntry> {
      return serial(async () => {
        const state = await load();
        const entry = state.sessions[sessionId];
        if (!entry) throw new Error(`no state for ${sessionId}`);
        change(entry);
        entry.updated_at = now.toISOString();
        await save(state);
        return entry;
      });
    },

    /** Forget a claim that never recorded anything, so Stripe's retry starts clean. */
    release(sessionId: string): Promise<void> {
      return serial(async () => {
        const state = await load();
        const entry = state.sessions[sessionId];
        if (!entry) return;
        if (entry.record) entry.status = "error";
        else delete state.sessions[sessionId];
        await save(state);
      });
    },

    get(sessionId: string): Promise<SessionEntry | undefined> {
      return serial(async () => (await load()).sessions[sessionId]);
    },

    appendOrder: (row: { type: "order"; at: string } & OrderRecord) =>
      serial(() => appendLine("orders.jsonl", row)),

    appendFulfilment: (row: {
      type: "fulfilment";
      at: string;
      session_id: string;
      order_ref: string;
      status: SessionStatus;
      suppliers: Record<string, SupplierResult>;
      emailed: boolean;
    }) => serial(() => appendLine("orders.jsonl", row)),

    /** All rows in one write, so a failure can't leave half an order's royalties behind. */
    appendRoyalties: (rows: RoyaltyRow[]) =>
      serial(async () => {
        if (rows.length === 0) return;
        await ensureDir();
        await fs.appendFile(
          path.join(dir, "royalties.jsonl"),
          rows.map((r) => JSON.stringify(r) + "\n").join(""),
          { mode: 0o640 }
        );
      }),
  };
}

export type OrderStore = ReturnType<typeof createOrderStore>;

const stores = new Map<string, OrderStore>();

/** One store (one queue) per data directory for the life of the process. */
export const orderStore = (dir: string) => {
  let s = stores.get(dir);
  if (!s) stores.set(dir, (s = createOrderStore(dir)));
  return s;
};
