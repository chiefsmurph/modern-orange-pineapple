// Customer emails sent exactly once: an append-only ledger in $MOP_DATA_DIR and
// the claim -> send -> record -> alert flow around it. Used by the shipped
// emails (shipments.ts, shipments-emailed.jsonl) and the order confirmation
// (confirmation.ts, confirmations-emailed.jsonl).
//
// One line per step for a key:
//   sending   written BEFORE the email is sent (the claim, like orders-state's "processing")
//   emailed   written once Resend accepted it; only then is the key done
//   failed    the send failed: not done, a later try sends it
//   skipped   MOP_RESEND_API_KEY isn't set: not done, nothing was sent
//   dry_run   MOP_EMAIL_DRY_RUN=1: logged, not sent, not done
// A key with an "emailed" line is never emailed again (unless a person forces a
// resend); a "sending" line younger than STALE_MS means another delivery is on
// it right now; an older one was abandoned (crash) and is resumed. The resumed
// send reuses the same Resend Idempotency-Key, so even then the customer gets
// one email.
import { promises as fs } from "node:fs";
import path from "node:path";
import { sendEmail } from "./notify.ts";
import { isEmail, maskEmail, sendCustomerEmail, type SendResult } from "./customer-email.ts";
import type { FetchLike } from "./http.ts";

export const STALE_MS = 10 * 60 * 1000;

export type LedgerStatus = "sending" | "emailed" | "failed" | "skipped" | "dry_run";

/** What every ledger line has; each email adds its own fields. */
export type BaseLedgerRow = {
  at: string;
  status: LedgerStatus;
  key: string;
  order_ref: string;
  to?: string;
  resend_id?: string;
  error?: string;
};

/**
 * proceed: go ahead (resumed: an abandoned "sending" is being retried; failures: earlier
 * failed sends; resends: earlier successful sends, when forced). Else `reason`.
 */
export type Claim = { proceed: boolean; reason?: "emailed" | "in_progress"; resumed?: boolean; failures?: number; resends?: number };

const parseLines = <Row>(text: string): Row[] =>
  text.split("\n").flatMap((l) => {
    if (!l.trim()) return [];
    try {
      return [JSON.parse(l) as Row];
    } catch {
      return []; // a torn last line from a crash: ignore it, the key is retried
    }
  });

export function createEmailLedger<Row extends BaseLedgerRow>(dir: string, fileName: string) {
  const file = path.join(dir, fileName);
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };
  const rows = async (): Promise<Row[]> => {
    try {
      return parseLines<Row>(await fs.readFile(file, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  };
  const append = async (row: Row) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    await fs.appendFile(file, JSON.stringify(row) + "\n", { mode: 0o640 });
  };

  return {
    file,
    rows: () => serial(rows),
    /** Run `fn` on the ledger's lines inside its queue (for queries built on top). */
    query: <T>(fn: (rows: Row[]) => T) => serial(async () => fn(await rows())),

    /** Take a key for sending (writes its "sending" line), or say why not. `force`: send even if already emailed. */
    claim(row: Omit<Row, "at" | "status">, now: Date, { force = false }: { force?: boolean } = {}): Promise<Claim> {
      return serial(async () => {
        const mine = (await rows()).filter((r) => r.key === row.key);
        const emailed = mine.filter((r) => r.status === "emailed").length;
        if (emailed && !force) return { proceed: false, reason: "emailed" };
        const last = mine[mine.length - 1];
        const fresh = last?.status === "sending" && now.getTime() - Date.parse(last.at) < STALE_MS;
        if (fresh) return { proceed: false, reason: "in_progress" };
        await append({ ...row, at: now.toISOString(), status: "sending" } as Row);
        return {
          proceed: true,
          resumed: last?.status === "sending",
          failures: mine.filter((r) => r.status === "failed").length,
          ...(emailed ? { resends: emailed } : {}),
        };
      });
    },

    record: (row: Row) => serial(() => append(row)),
  };
}

export type EmailLedger<Row extends BaseLedgerRow> = ReturnType<typeof createEmailLedger<Row>>;

export type DeliverStatus = "emailed" | "duplicate" | "in_progress" | "dry_run" | "skipped" | "failed";

export type OnceResult = { key: string; status: DeliverStatus; retryable?: boolean; error?: string; resendId?: string };

export type OnceJob<Row extends BaseLedgerRow> = {
  ledger: EmailLedger<Row>;
  /** The ledger fields (key, order_ref, to, ...); every line for this send carries them. */
  row: Omit<Row, "at" | "status">;
  /** Log prefix, e.g. "[shipping]". */
  tag: string;
  /** "shipped email": used in the log lines. */
  what: string;
  /** Who/what this is, for the log: "mop-… (printful 1, package 2)". */
  who: string;
  to: string;
  /** Shown after the masked address in the "sent" log line, e.g. "order_record". */
  toNote?: string;
  /** Why there's no address, when `to` isn't one. */
  noAddressError: string;
  /** Built only once the key is claimed (so a duplicate costs no lookups). */
  build: () => { subject: string; html: string; text: string } | Promise<{ subject: string; html: string; text: string }>;
  /** Resend Idempotency-Key for the first try (a suffix is added after failures / for a forced resend). */
  idempotencyKey: string;
  /** John's alert for a failed send (only the first failure of a key alerts). */
  alert: (sent: SendResult) => { subject: string; body: string };
  /** Send even if the ledger says it was emailed (a person asked for a resend). */
  force?: boolean;
};

export type OnceDeps = {
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  log: (msg: string) => void;
  now: () => Date;
  retryDelayMs?: number;
};

/**
 * One email: claim the key, send, record the outcome. A failed send is logged,
 * not marked emailed, and John is told (PingPigeon) the first time a key fails.
 */
export async function deliverOnce<Row extends BaseLedgerRow>(job: OnceJob<Row>, deps: OnceDeps): Promise<OnceResult> {
  const { ledger, tag, what, who } = job;
  const log = deps.log;
  const key = job.row.key;

  const claim = await ledger.claim(job.row, deps.now(), { force: job.force });
  if (!claim.proceed) {
    log(`${tag} ${who}: ${claim.reason === "emailed" ? "already emailed, not sending again" : "another delivery is sending it right now"}`);
    return { key, status: claim.reason === "emailed" ? "duplicate" : "in_progress" };
  }
  if (claim.resumed) log(`${tag} ${who}: an earlier attempt stopped mid-send; trying again (same idempotency key)`);
  if (claim.resends) log(`${tag} ${who}: already emailed ${claim.resends} time(s); sending again because it was forced`);

  const at = () => deps.now().toISOString();
  let email: { subject: string; html: string; text: string } | undefined;
  let buildError = "";
  try {
    email = await job.build();
  } catch (err) {
    buildError = `could not build the email: ${(err as Error).message}`;
  }
  const sent: SendResult = !email
    ? { ok: false, error: buildError, retryable: false }
    : isEmail(job.to)
      ? await sendCustomerEmail(
          { to: job.to, subject: email.subject, html: email.html, text: email.text },
          {
            env: deps.env,
            fetch: deps.fetch,
            log,
            tag,
            // Same key when resuming an abandoned send (Resend dedupes it); a new one after a
            // recorded failure (the retried email may differ) or for a forced resend.
            idempotencyKey: `${job.idempotencyKey}${claim.failures ? `/retry-${claim.failures}` : ""}${claim.resends ? `/resend-${claim.resends}` : ""}`,
            retryDelayMs: deps.retryDelayMs,
          }
        )
      : { ok: false, error: job.noAddressError, retryable: false };

  if (sent.ok && sent.dryRun) {
    await ledger.record({ ...job.row, at: at(), status: "dry_run" } as Row);
    return { key, status: "dry_run" };
  }
  if (sent.ok) {
    try {
      await ledger.record({ ...job.row, at: at(), status: "emailed", resend_id: sent.id } as Row);
    } catch (err) {
      // Sent but not recorded: a retry may send again within Resend's 24 h idempotency window (deduped there).
      log(`${tag} ${who}: EMAILED but could not record it in ${ledger.file}: ${(err as Error).message}`);
    }
    log(`${tag} ${who}: ${what} sent to ${maskEmail(job.to)}${job.toNote ? ` (${job.toNote})` : ""}, Resend ${sent.id}`);
    return { key, status: "emailed", resendId: sent.id };
  }
  if (sent.noKey) {
    log(`${tag} ${who}: MOP_RESEND_API_KEY is not set: ${what} NOT sent (skipped; set the key to send)`);
    await ledger.record({ ...job.row, at: at(), status: "skipped", error: sent.error } as Row);
    return { key, status: "skipped", error: sent.error };
  }

  log(`${tag} ${who}: ${what.toUpperCase()} FAILED: ${sent.error}`);
  await ledger.record({ ...job.row, at: at(), status: "failed", error: sent.error } as Row).catch((err) =>
    log(`${tag} ${who}: could not record the failure: ${(err as Error).message}`)
  );
  if (!claim.failures) {
    const { subject, body } = job.alert(sent);
    const alert = await sendEmail({ subject, body, html: "" }, { env: deps.env, fetch: deps.fetch, log, retryDelayMs: deps.retryDelayMs }).catch(
      (err) => ({ ok: false, error: (err as Error).message })
    );
    if (!alert.ok) log(`${tag} ${who}: could not alert John either: ${alert.error}`);
  }
  return { key, status: "failed", retryable: sent.retryable, error: sent.error };
}
