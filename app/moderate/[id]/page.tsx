// /moderate/<id>?action=…&sig=… — the page John's email links open. It only
// SHOWS what's about to happen; the change needs the button (a POST), so link
// previews and mail scanners can't approve or hide anything.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { verifyModeration } from "@/lib/reviews";
import { CLAIM_ACTIONS, claimPhotoSignature, claimSignature, verifyClaim, type ClaimAction } from "@/lib/legacy-claims";
import { linkSecret, stores } from "@/lib/register-deps";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Moderate | MOP", robots: { index: false, follow: false } };

const LABELS: Record<string, string> = {
  "approve-review": "Approve this review (it shows on the product page)",
  "hide-review": "Hide this review",
  "approve-photo": "Approve this photo for The MOP Crew (home page)",
  "hide-photo": "Hide this photo",
};

export default async function ModeratePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const action = q.action ?? "";
  if (CLAIM_ACTIONS.includes(action as ClaimAction)) return <ClaimSection id={id} action={action as ClaimAction} sig={q.sig} done={!!q.done} />;
  if (!verifyModeration(id, action, q.sig, linkSecret())) notFound();
  const r = await stores().reviews.get(id);
  if (!r) notFound();
  const part = action.endsWith("photo") ? "photo" : "review";
  const status = part === "photo" ? r.photo_status : r.review_status;
  const box: React.CSSProperties = { maxWidth: 560, margin: "2rem auto", padding: "1.25rem", background: "rgba(255,255,255,.9)", borderRadius: 16, fontFamily: "system-ui, sans-serif", lineHeight: 1.5 };
  return (
    <main style={box}>
      <h1 style={{ fontSize: "1.2rem" }}>{q.done ? "Done" : LABELS[action]}</h1>
      <p>
        <b>{r.first_name}</b> on <b>{r.product}</b> · {part}: <b>{status ?? "none"}</b>
        {r.connection ? " · Friend of MOP" : ""}
      </p>
      {part === "review" && r.stars ? (
        <blockquote style={{ margin: "1rem 0", padding: "0.75rem 1rem", background: "#f4f6f7", borderRadius: 10 }}>
          <div>{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)} <b>{r.title}</b></div>
          <div style={{ whiteSpace: "pre-wrap" }}>{r.text}</div>
        </blockquote>
      ) : null}
      {part === "photo" && !r.feature_ok ? <p>The owner didn&apos;t OK featuring this photo, so it can&apos;t be shown.</p> : null}
      {q.done ? (
        <p>Saved. It&apos;s {status} now.</p>
      ) : (
        <form method="post" action={`/api/moderate/${id}`}>
          <input type="hidden" name="action" value={action} />
          <input type="hidden" name="sig" value={q.sig} />
          <button type="submit" style={{ padding: "0.8rem 1.4rem", border: 0, borderRadius: 12, background: "#000", color: "#fff", fontSize: "1rem" }}>
            {action.startsWith("approve") ? "Approve" : "Hide"}
          </button>
        </form>
      )}
    </main>
  );
}

// Old card claims (/redeem, lib/legacy-claims.ts): the claim, its photo, Approve / Reject.
// Approving only marks it approved: John pays any reward himself.
async function ClaimSection({ id, action, sig, done }: { id: string; action: ClaimAction; sig?: string; done: boolean }) {
  const secret = linkSecret();
  if (!secret || !verifyClaim(id, action, sig, secret)) notFound();
  const c = await stores().claims.get(id);
  if (!c) notFound();
  const box: React.CSSProperties = { maxWidth: 560, margin: "2rem auto", padding: "1.25rem", background: "rgba(255,255,255,.92)", borderRadius: 16, fontFamily: "system-ui, sans-serif", lineHeight: 1.5 };
  const button = (bg: string): React.CSSProperties => ({ padding: "0.8rem 1.4rem", border: 0, borderRadius: 12, background: bg, color: "#fff", fontSize: "1rem", cursor: "pointer" });
  const colour = c.status === "approved" ? "#2a7a2a" : c.status === "rejected" ? "#b00020" : "#b26a00";
  return (
    <main style={box}>
      <p style={{ margin: 0, color: "#666", fontSize: "0.85rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>Old card claims</p>
      <h1 style={{ fontSize: "1.3rem", margin: "0.25rem 0 0.75rem" }}>
        {c.code} <span style={{ fontSize: "0.9rem", color: colour }}>· {c.status}</span>
      </h1>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.95rem" }}>
        <tbody>
          {[
            ["Name", c.name],
            ["Fun fact", c.fact ?? "(none)"],
            ["Contact", c.contact ?? "(none given)"],
            ["On the saved list", c.listed ? "yes (codes.json)" : "no (the list was lost; old card format)"],
            ["Claimed", new Date(c.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }) + " PT"],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: "4px 12px 4px 0", color: "#666", verticalAlign: "top", whiteSpace: "nowrap" }}>{k}</td>
              <td style={{ padding: "4px 0", whiteSpace: "pre-wrap" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/claim-photo/${id}?sig=${claimPhotoSignature(id, secret)}`}
        alt={`Photo sent with the claim for ${c.code}`}
        style={{ display: "block", width: "100%", maxHeight: 420, objectFit: "contain", margin: "1rem 0", borderRadius: 12, background: "#f4f6f7" }}
      />
      {done ? (
        <p>Saved. This claim is {c.status} now.</p>
      ) : null}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {(["approve-claim", "reject-claim"] as const).map((a) => (
          <form key={a} method="post" action={`/api/moderate/${id}`}>
            <input type="hidden" name="action" value={a} />
            <input type="hidden" name="sig" value={claimSignature(id, a, secret)} />
            <button type="submit" style={button(a === "approve-claim" ? "#000" : "#b00020")}>
              {a === "approve-claim" ? "Approve" : "Reject"}
            </button>
          </form>
        ))}
      </div>
      <p style={{ marginTop: "1rem", color: "#666", fontSize: "0.85rem" }}>
        Approve only marks the claim approved (and the code redeemed on the saved list, if it&apos;s there). Nothing is paid or sent
        automatically. Reject frees the code for another claim.
      </p>
    </main>
  );
}
