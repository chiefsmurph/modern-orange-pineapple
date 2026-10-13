"use client";
import { useState } from "react";
import { track } from "@/lib/umami";
import styles from "./DropsSignup.module.css";

// "Get notified of new drops": email + button, posting to /api/subscribe.
// `compact` is the smaller one under a product's description.
export default function DropsSignup({ source, compact = false }: { source: string; compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setMessage("");
    const website = (new FormData(e.currentTarget).get("website") as string) || "";
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source, website }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "Something went wrong, please try again.");
      setCode(typeof j.code === "string" && j.code ? j.code : null);
      setState("done");
      track("signup", { source });
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  };

  return (
    <section className={`${styles.signup} ${compact ? styles.compact : ""}`} aria-labelledby={`drops-${source}`}>
      <h2 id={`drops-${source}`} className={styles.title}>
        Get notified of new drops
      </h2>
      <p className={styles.line}>New skies and drops, first. No spam.</p>
      {state === "done" ? (
        code ? (
          <div className={styles.done} role="status">
            <p>
              You&apos;re on the list. Here&apos;s 10% off your first order:
            </p>
            <p className={styles.codeRow}>
              <b className={styles.code}>{code}</b>
              <button
                type="button"
                className={styles.copy}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                  } catch {
                    // older browsers: select the code so it can be copied by hand
                    const el = document.querySelector(`.${styles.code}`);
                    if (el) window.getSelection()?.selectAllChildren(el);
                  }
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </p>
            <p className={styles.codeHint}>Enter it at checkout under &ldquo;Add promotion code&rdquo;.</p>
          </div>
        ) : (
          <p className={styles.done} role="status">
            You&apos;re on the list. Thanks!
          </p>
        )
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <label className={styles.visuallyHidden} htmlFor={`drops-email-${source}`}>
            Email address
          </label>
          <input
            id={`drops-email-${source}`}
            className={styles.input}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@email.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {/* honeypot: hidden from people, bots fill it in */}
          <input className={styles.honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <button className={styles.button} type="submit" disabled={state === "sending"}>
            {state === "sending" ? "…" : "Notify me"}
          </button>
        </form>
      )}
      {state === "error" && (
        <p className={styles.error} role="alert">
          {message}
        </p>
      )}
      <p className={styles.privacy}>We&apos;ll only email about MOP. Unsubscribe anytime.</p>
    </section>
  );
}
