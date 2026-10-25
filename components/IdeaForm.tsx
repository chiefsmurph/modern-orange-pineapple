"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { IDEA_MAX, TERMS, validateIdea, type IdeaErrors } from "@/lib/ideas";
import { track } from "@/lib/umami";
import styles from "./CustomRequestForm.module.css";
import own from "./IdeaForm.module.css";

type Field = keyof IdeaErrors;
const ORDER: Field[] = ["idea", "name", "email", "agree"];

// The /ideas form: the idea, a name, an email and the terms. Checks run as you
// type (lib/ideas.ts, the same rules the server applies), shown once you've left
// a field and all at once when you press Send, as on /custom.
export default function IdeaForm() {
  const [idea, setIdea] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<IdeaErrors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const errors = useMemo(() => validateIdea({ idea, name, email, agree }).errors, [idea, name, email, agree]);
  const valid = Object.keys(errors).length === 0;
  // the server's verdict is about what was sent: any edit clears it
  useEffect(() => setServerErrors({}), [idea, name, email, agree]);
  const shown = (f: Field) => serverErrors[f] || ((tried || touched[f]) && errors[f]) || undefined;
  const blur = (f: Field) => () => setTouched((t) => ({ ...t, [f]: true }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid) {
      const first = ORDER.find((f) => errors[f]);
      if (first) document.getElementById(`idea-${first}`)?.focus();
      return;
    }
    setStatus("sending");
    setMessage("");
    setServerErrors({});
    const website = (formRef.current?.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "";
    try {
      const r = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, name, email, agree, website }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        if (j.errors) setServerErrors(j.errors);
        throw new Error(j.error || "Please check the fields above.");
      }
      setStatus("done");
      track("idea-submit");
      window.scrollTo({ top: 0 });
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  };

  if (status === "done") {
    return (
      <div className={styles.done} role="status">
        <h2>Thanks for your idea!</h2>
        <p>We read every one. If we make it into a shirt, we&apos;ll email you.</p>
        <Link href="/" className={styles.back}>
          Back to the shop
        </Link>
      </div>
    );
  }

  const err = (f: Field) =>
    shown(f) ? (
      <p className={styles.error} id={`idea-${f}-error`} role="alert">
        {shown(f)}
      </p>
    ) : null;
  const described = (f: Field) => (shown(f) ? { "aria-invalid": true, "aria-describedby": `idea-${f}-error` } : {});

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="idea-idea">
          Your idea
        </label>
        <textarea
          id="idea-idea"
          className={styles.textarea}
          rows={5}
          maxLength={IDEA_MAX}
          placeholder="A pelican surfing a wave of coffee, with “Morning Shift” underneath…"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onBlur={blur("idea")}
          {...described("idea")}
        />
        <p className={styles.hint}>
          Words only: describe what&apos;s on the shirt. {idea.length.toLocaleString("en-US")} / {IDEA_MAX.toLocaleString("en-US")}
        </p>
        {err("idea")}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="idea-name">
          Name
        </label>
        <input
          id="idea-name"
          className={styles.input}
          type="text"
          autoComplete="name"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={blur("name")}
          {...described("name")}
        />
        {err("name")}
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="idea-email">
          Email
        </label>
        <input
          id="idea-email"
          className={styles.input}
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={blur("email")}
          {...described("email")}
        />
        <p className={styles.hint}>Only so we can reach you about your idea. Never shown on the site.</p>
        {err("email")}
      </div>

      <section className={own.terms} aria-labelledby="idea-terms-title">
        <h2 id="idea-terms-title" className={own.termsTitle}>
          The terms, in plain English
        </h2>
        <ul className={own.termsList}>
          {TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <div className={styles.field}>
        <label className={`${styles.check} ${own.agree}`}>
          <input
            id="idea-agree"
            type="checkbox"
            checked={agree}
            onChange={(e) => {
              setAgree(e.target.checked);
              setTouched((t) => ({ ...t, agree: true }));
            }}
            {...described("agree")}
          />{" "}
          It&apos;s my own idea and I agree to these terms.
        </label>
        {err("agree")}
      </div>

      {/* honeypot: hidden from people, bots fill it in */}
      <input className={styles.honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />

      <button type="submit" className={styles.submit} aria-disabled={!valid || status === "sending"} disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Send my idea"}
      </button>
      {tried && !valid && (
        <p className={styles.error} role="alert">
          Please fix the {Object.keys(errors).length === 1 ? "field" : "fields"} marked above.
        </p>
      )}
      {status === "error" && message && (
        <p className={styles.error} role="alert">
          {message}
        </p>
      )}
    </form>
  );
}
