// /moderate/ideas?sig=… — John's review page for shirt ideas (lib/ideas-server.ts).
// The same protection as the other /moderate pages: the link is signed with
// MOP_LINK_SECRET (it's in every "New shirt idea" email), and a wrong or missing
// signature is a 404. Viewing changes nothing; each button is a POST with its own
// signature (/api/ideas/admin). Emails and payout handles show only here.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { STATUSES, TERMS_VERSION, type IdeaStatus } from "@/lib/ideas";
import {
  declineEmailEnabled,
  ideaSignature,
  ideaStore,
  ideasListSignature,
  liveEmailEnabled,
  verifyIdeasList,
  type Idea,
  type IdeaAction,
} from "@/lib/ideas-server";
import { dataDir } from "@/lib/orders/store";
import { linkSecret } from "@/lib/register-deps";

export const dynamic = "force-dynamic";
// no-referrer: the signed link never leaves in a Referer header (a product link, a mailto:, …)
export const metadata: Metadata = { title: "Shirt ideas | MOP", robots: { index: false, follow: false }, referrer: "no-referrer" };

const COLOUR: Record<IdeaStatus, string> = { new: "#b26a00", approved: "#2a7a2a", denied: "#b00020", launched: "#1559a8" };

const EMAIL_NOTE: Record<string, string> = {
  off: "The email to them is switched off, so nothing was sent. Email them yourself if you like.",
  emailed: "Emailed them.",
  duplicate: "They were already sent this email before, so it wasn't sent again.",
  in_progress: "Another send of this email is in progress.",
  dry_run: "MOP_EMAIL_DRY_RUN is on: the email was logged, not sent.",
  skipped: "MOP_RESEND_API_KEY isn't set, so the email wasn't sent.",
  failed: "The email FAILED (you'll get an ACTION NEEDED email). Press the button again to retry.",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) + " PT" : "";

export default async function IdeasAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const secret = linkSecret();
  if (!secret || !verifyIdeasList(q.sig, secret)) notFound();
  const filter = STATUSES.includes(q.status as IdeaStatus) ? (q.status as IdeaStatus) : undefined;

  const all = await ideaStore(dataDir()).readAll();
  const number = new Map([...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((x, i) => [x.id, i + 1]));
  const senders = new Map<string, number>();
  for (const x of all) senders.set(x.ipHash, (senders.get(x.ipHash) ?? 0) + 1);
  const shown = all.filter((x) => !filter || x.status === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const count = (s?: IdeaStatus) => all.filter((x) => !s || x.status === s).length;
  const link = (status?: IdeaStatus) => `/moderate/ideas?sig=${ideasListSignature(secret)}${status ? `&status=${status}` : ""}`;

  const live = liveEmailEnabled(process.env);
  const decline = declineEmailEnabled(process.env);
  const box: React.CSSProperties = { maxWidth: 760, margin: "2rem auto", padding: "1.25rem", background: "rgba(255,255,255,.94)", borderRadius: 16, fontFamily: "system-ui, sans-serif", lineHeight: 1.5 };
  const tab = (on: boolean): React.CSSProperties => ({
    padding: "0.35rem 0.8rem",
    borderRadius: 999,
    border: "1.5px solid #222",
    background: on ? "#000" : "#fff",
    color: on ? "#fff" : "#000",
    textDecoration: "none",
    fontSize: "0.85rem",
  });

  return (
    <main style={box}>
      <p style={{ margin: 0, color: "#666", fontSize: "0.85rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>Shirt ideas · mopclothing.com/ideas</p>
      <h1 style={{ fontSize: "1.3rem", margin: "0.25rem 0 0.5rem" }}>
        {count()} {count() === 1 ? "idea" : "ideas"} · {count("new")} new
      </h1>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "#555" }}>
        Emails to senders: &ldquo;Your idea is live&rdquo; is <b>{live ? "on" : "off"}</b>, &ldquo;not this time&rdquo; is <b>{decline ? "on" : "off"}</b>.
        {live && decline ? "" : " Off means nothing is sent to them; email them yourself if you want to."}
      </p>
      <nav style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0 0 1rem" }} aria-label="Filter by status">
        <a href={link()} style={tab(!filter)}>All ({count()})</a>
        {STATUSES.map((s) => (
          <a key={s} href={link(s)} style={tab(filter === s)}>
            {s[0].toUpperCase() + s.slice(1)} ({count(s)})
          </a>
        ))}
      </nav>
      {shown.length === 0 ? <p>No {filter ?? ""} ideas yet.</p> : null}
      {shown.map((x) => (
        <IdeaCard
          key={x.id}
          x={x}
          n={number.get(x.id)!}
          others={(senders.get(x.ipHash) ?? 1) - 1}
          secret={secret}
          filter={filter}
          saved={q.saved === x.id}
          email={q.saved === x.id ? q.email : undefined}
          error={q.failed === x.id ? "Add the shirt's page (a link starting https://) to mark it launched." : undefined}
          decline={decline}
        />
      ))}
    </main>
  );
}

function IdeaCard({
  x,
  n,
  others,
  secret,
  filter,
  saved,
  email,
  error,
  decline,
}: {
  x: Idea;
  n: number;
  others: number;
  secret: string;
  filter?: IdeaStatus;
  saved: boolean;
  email?: string;
  error?: string;
  decline: boolean;
}) {
  const hidden = (action: IdeaAction) => (
    <>
      <input type="hidden" name="id" value={x.id} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="sig" value={ideaSignature(x.id, action, secret)} />
      {filter ? <input type="hidden" name="filter" value={filter} /> : null}
    </>
  );
  const button = (bg: string): React.CSSProperties => ({ padding: "0.6rem 1.1rem", border: 0, borderRadius: 10, background: bg, color: "#fff", fontSize: "0.95rem", cursor: "pointer" });
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "0.5rem 0.6rem", border: "1.5px solid #9aa7ae", borderRadius: 8, font: "inherit", fontSize: 16 };
  const rows: [string, React.ReactNode][] = [
    ["Name", x.name],
    ["Email", <a key="e" href={`mailto:${x.email}`}>{x.email}</a>],
    ["Venmo / Zelle", x.payout ?? "not given yet"],
    ["Sent", `${when(x.createdAt)}${others ? ` · same sender as ${others} other ${others === 1 ? "idea" : "ideas"}` : ""}`],
    ["Terms", `agreed (${x.terms}${x.terms === TERMS_VERSION ? "" : ", older wording"})`],
  ];
  if (x.productUrl) rows.push(["Shirt", <a key="p" href={x.productUrl} target="_blank" rel="noreferrer">{x.productUrl}</a>]);
  if (x.decidedAt) rows.push([x.status[0].toUpperCase() + x.status.slice(1), when(x.decidedAt)]);

  return (
    <article id={`idea-${x.id}`} style={{ borderTop: "1px solid #ddd", padding: "1rem 0" }}>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>
        #{n} <span style={{ color: COLOUR[x.status], textTransform: "uppercase", fontSize: "0.8rem", letterSpacing: "0.05em" }}>· {x.status}</span>
      </h2>
      {saved ? (
        <p role="status" style={{ margin: "0 0 0.5rem", padding: "0.5rem 0.75rem", background: "#eaf6ea", borderRadius: 8, fontSize: "0.9rem" }}>
          Saved. {email ? EMAIL_NOTE[email] ?? "" : ""}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ margin: "0 0 0.5rem", padding: "0.5rem 0.75rem", background: "#fbeaea", borderRadius: 8, fontSize: "0.9rem", color: "#b00020" }}>
          {error}
        </p>
      ) : null}
      <blockquote style={{ margin: "0 0 0.75rem", padding: "0.75rem 1rem", background: "#f4f6f7", borderRadius: 10, whiteSpace: "pre-wrap" }}>{x.idea}</blockquote>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: "3px 12px 3px 0", color: "#666", verticalAlign: "top", whiteSpace: "nowrap" }}>{k}</td>
              <td style={{ padding: "3px 0", wordBreak: "break-word" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", margin: "0.85rem 0 0" }}>
        {x.status !== "approved" && x.status !== "launched" ? (
          <form method="post" action="/api/ideas/admin">
            {hidden("approve")}
            <button type="submit" style={button("#000")}>Approve</button>
          </form>
        ) : null}
        {x.status !== "denied" ? (
          <form method="post" action="/api/ideas/admin" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {hidden("deny")}
            <button type="submit" style={button("#b00020")}>Deny</button>
            {decline ? (
              <label style={{ fontSize: "0.85rem" }}>
                <input type="checkbox" name="sendEmail" value="1" /> also send the &ldquo;not this time&rdquo; email
              </label>
            ) : null}
          </form>
        ) : null}
      </div>

      <form method="post" action="/api/ideas/admin" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.75rem 0 0" }}>
        {hidden("launch")}
        <input
          name="productUrl"
          type="url"
          required
          placeholder="The shirt's page: https://mopclothing.com/…"
          defaultValue={x.productUrl ?? ""}
          aria-label="The shirt's page"
          style={{ ...input, flex: "1 1 260px", width: "auto" }}
        />
        <button type="submit" style={button("#1559a8")}>{x.status === "launched" ? "Update link" : "Mark launched"}</button>
      </form>

      <form method="post" action="/api/ideas/admin" style={{ display: "flex", flexDirection: "column", gap: "0.4rem", margin: "0.75rem 0 0" }}>
        {hidden("save")}
        <label style={{ fontSize: "0.8rem", color: "#666" }}>
          Notes (only you see them)
          <textarea name="notes" rows={2} maxLength={2000} defaultValue={x.notes ?? ""} style={{ ...input, display: "block", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: "0.8rem", color: "#666" }}>
          Their Venmo or Zelle (once they send it)
          <input name="payout" type="text" maxLength={100} defaultValue={x.payout ?? ""} placeholder="Venmo @name / Zelle phone or email" style={{ ...input, display: "block", marginTop: 4 }} />
        </label>
        <div>
          <button type="submit" style={button("#444")}>Save notes</button>
        </div>
      </form>
    </article>
  );
}
