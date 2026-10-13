"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UPLOAD_ACCEPT, checkUpload, isEmail } from "@/lib/custom-request";
import { track } from "@/lib/umami";
import styles from "./RegisterForm.module.css";

type Item = { code: string; slug: string; title: string; summary: string; image: string | null };
type Errors = Partial<Record<"code" | "firstName" | "email" | "photo" | "stars" | "title" | "text", string>>;

// /register: the code from the packing slip, then the piece's photo + name, and
// the registration (first name, optional email / new drops), an owner photo
// ("Show us yours!") and/or a review, all optional except the first name.
// Legacy two-part codes (COW-76) go to the old redeem page as before.
export default function RegisterForm() {
  const router = useRouter();
  const [step, setStep] = useState<"code" | "details" | "done">("code");
  const [code, setCode] = useState("");
  const [lookupMsg, setLookupMsg] = useState<{ text: string; used?: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [canonical, setCanonical] = useState("");

  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [featureOk, setFeatureOk] = useState(false);
  const [stars, setStars] = useState(0);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [connection, setConnection] = useState(false);
  const [reviewOn, setReviewOn] = useState("");
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [reward, setReward] = useState<{ code: string; off: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // a code in the link (?code=COW-76-K3P9) fills the box
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c);
  }, []);

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setLookupMsg(null);
    try {
      const r = await fetch("/api/register/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await r.json();
      if (j.status === "legacy") {
        router.push(`/redeem?code=${encodeURIComponent(j.code)}`);
        return;
      }
      if (j.status === "ok") {
        setItems(j.items);
        setCanonical(j.code);
        setReviewOn(j.items[0]?.code ?? "");
        setStep("details");
      } else if (j.status === "used") setLookupMsg({ text: "This code is already registered.", used: true });
      else if (j.status === "limited") setLookupMsg({ text: "Too many tries; please wait a few minutes." });
      else setLookupMsg({ text: "We couldn't find that code. Check it on your packing slip (e.g. COW-76-K3P9)." });
    } catch {
      setLookupMsg({ text: "Something went wrong; please try again." });
    } finally {
      setChecking(false);
    }
  };

  // the same rules as the server (lib/register-server.ts)
  const errors: Errors = {};
  if (!firstName.trim()) errors.firstName = "Add your first name";
  if (email && !isEmail(email.trim())) errors.email = "That email doesn't look right";
  if (optIn && !email.trim()) errors.email = "Add your email to get new-drop emails";
  const photoError = checkUpload(photo);
  if (photoError) errors.photo = photoError;
  const writing = stars > 0 || title.trim() !== "" || text.trim() !== "";
  if (writing) {
    if (!stars) errors.stars = "Pick 1 to 5 stars";
    if (title.trim().length < 2) errors.title = "Add a short title";
    if (text.trim().length < 10) errors.text = "Tell us a bit more (at least 10 characters)";
    else if (text.trim().length > 1000) errors.text = "Please keep it under 1,000 characters";
  }
  const show = (k: keyof Errors) => serverErrors[k] || (tried && errors[k]) || undefined;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) return;
    setSending(true);
    setMessage("");
    setServerErrors({});
    const fd = new FormData();
    const add = (k: string, v: string) => fd.append(k, v);
    add("code", canonical);
    add("firstName", firstName);
    add("email", email);
    add("optIn", String(optIn));
    add("reviewOn", reviewOn);
    add("stars", String(stars || ""));
    add("title", title);
    add("text", text);
    add("connection", String(connection));
    add("featureOk", String(featureOk && !!photo));
    add("website", (e.currentTarget.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "");
    if (photo) fd.append("photo", photo);
    try {
      const r = await fetch("/api/register", { method: "POST", body: fd });
      if (r.status === 413) throw new Error("That photo is too big to send; try a smaller one.");
      const j = await r.json().catch(() => ({}));
      if (j.used) {
        setStep("code");
        setLookupMsg({ text: "This code is already registered.", used: true });
        return;
      }
      if (!r.ok || !j.ok) {
        if (j.errors) setServerErrors(j.errors);
        throw new Error(j.error || "Please check the fields above.");
      }
      setReward(j.reward ?? null);
      setStep("done");
      track("register", { review: writing ? "yes" : "no", photo: photo ? "yes" : "no" });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (step === "code") {
    return (
      <form className={styles.card} onSubmit={lookup}>
        <label className={styles.label} htmlFor="reg-code">
          Your code
        </label>
        <p className={styles.hint}>It&apos;s on the packing slip in your package, like COW-76-K3P9.</p>
        <div className={styles.codeRow}>
          <input
            id="reg-code"
            className={`${styles.input} ${styles.codeInput}`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="COW-76-K3P9"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button className={styles.button} type="submit" disabled={checking || code.trim().length < 5}>
            {checking ? "…" : "Continue"}
          </button>
        </div>
        {lookupMsg && (
          <p className={styles.error} role="alert">
            {lookupMsg.text}
            {lookupMsg.used && (
              <>
                {" "}
                Not you? <Link href="/custom">Contact us</Link> and we&apos;ll sort it out.
              </>
            )}
          </p>
        )}
      </form>
    );
  }

  if (step === "done") {
    return (
      <div className={styles.card} role="status">
        <h2 className={styles.doneTitle}>Thanks, {firstName.trim()}!</h2>
        <p>
          {items.length === 1 ? `Your ${items[0].title} is registered.` : `Your ${items.length} pieces are registered.`}
          {writing || photo ? " John reads every review and photo before it goes up on the site." : ""}
        </p>
        {reward && (
          <div className={styles.reward}>
            <p>
              Here&apos;s {reward.off} off your next order:
            </p>
            <p className={styles.rewardRow}>
              <b className={styles.rewardCode}>{reward.code}</b>
              <button
                type="button"
                className={styles.copy}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(reward.code);
                  } catch {}
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </p>
            <p className={styles.hint}>Enter it at checkout under &ldquo;Add promotion code&rdquo;.</p>
          </div>
        )}
        <Link href="/" className={styles.button}>
          Back to the shop
        </Link>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {items.map((it) => (
        <div key={it.code} className={styles.item}>
          {it.image && <Image src={it.image} alt="" width={160} height={160} className={styles.itemImage} />}
          <div>
            <b>{it.title}</b>
            <p className={styles.hint}>{it.summary}</p>
            <p className={styles.verified}>✓ Code {it.code}</p>
          </div>
        </div>
      ))}

      {/* the owner photo is the centrepiece: first and biggest */}
      <section className={styles.photoBox}>
        <h2 className={styles.photoTitle}>Show us yours!</h2>
        <p className={styles.hint}>Upload a photo of you wearing it (optional).</p>
        <input id="reg-photo" className={styles.fileInput} type="file" accept={UPLOAD_ACCEPT} onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        <label htmlFor="reg-photo" className={styles.photoButton}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="Your photo" className={styles.preview} /> : <span>＋ Add your photo</span>}
        </label>
        {photo && (
          <>
            <button type="button" className={styles.linkButton} onClick={() => setPhoto(null)}>
              Remove photo
            </button>
            <label className={styles.check}>
              <input type="checkbox" checked={featureOk} onChange={(e) => setFeatureOk(e.target.checked)} /> OK to feature my
              photo on the site
            </label>
          </>
        )}
        {show("photo") && <p className={styles.error}>{show("photo")}</p>}
      </section>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="reg-first">
          First name
        </label>
        <input id="reg-first" className={styles.input} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={50} />
        {show("firstName") && <p className={styles.error}>{show("firstName")}</p>}
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="reg-email">
          Email <span className={styles.optional}>optional, for your thank-you</span>
        </label>
        <input id="reg-email" className={styles.input} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <label className={styles.check}>
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> Email me about new drops
        </label>
        {show("email") && <p className={styles.error}>{show("email")}</p>}
      </div>

      <fieldset className={styles.review}>
        <legend className={styles.label}>
          Leave a review <span className={styles.optional}>optional</span>
        </legend>
        {items.length > 1 && (
          <select className={styles.input} value={reviewOn} onChange={(e) => setReviewOn(e.target.value)} aria-label="Which piece">
            {items.map((it) => (
              <option key={it.code} value={it.code}>
                {it.title} · {it.summary}
              </option>
            ))}
          </select>
        )}
        <div className={styles.stars} role="radiogroup" aria-label="Stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} className={n <= stars ? styles.starOn : styles.star} onClick={() => setStars(stars === n ? 0 : n)}>
              ★
            </button>
          ))}
        </div>
        {show("stars") && <p className={styles.error}>{show("stars")}</p>}
        <input className={styles.input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} aria-label="Review title" />
        {show("title") && <p className={styles.error}>{show("title")}</p>}
        <textarea className={styles.textarea} rows={4} placeholder="How does it look, feel and fit?" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} aria-label="Review" />
        <p className={styles.counter}>{text.trim().length}/1000</p>
        {show("text") && <p className={styles.error}>{show("text")}</p>}
        <label className={styles.check}>
          <input type="checkbox" checked={connection} onChange={(e) => setConnection(e.target.checked)} /> I know John / I&apos;m a friend or
          family of MOP
        </label>
      </fieldset>

      <input className={styles.honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <button className={styles.button} type="submit" disabled={sending}>
        {sending ? "Sending…" : "Register my shirt"}
      </button>
      {tried && Object.keys(errors).length > 0 && <p className={styles.error} role="alert">Please fix the fields marked above.</p>}
      {message && <p className={styles.error} role="alert">{message}</p>}
    </form>
  );
}
