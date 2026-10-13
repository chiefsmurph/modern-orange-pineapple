// /moderate/<id>?action=…&sig=… — the page John's email links open. It only
// SHOWS what's about to happen; the change needs the button (a POST), so link
// previews and mail scanners can't approve or hide anything.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { verifyModeration } from "@/lib/reviews";
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
