"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ITEM_TYPES,
  SIZES,
  UPLOAD_ACCEPT,
  checkUpload,
  sizesTotal,
  todayIso,
  validateCustomRequest,
  type FieldErrors,
} from "@/lib/custom-request";
import { track } from "@/lib/umami";
import styles from "./CustomRequestForm.module.css";

type Field = keyof FieldErrors;
const ORDER: Field[] = ["who", "description", "link", "file", "items", "quantity", "sizes", "deadline", "budget", "name", "email", "phone"];

// The /custom request form. Checks run as you type (lib/custom-request.ts, the
// same rules the server applies); a field's message shows once you've left it,
// and every message shows when you press Send. Send looks disabled until it's
// all valid, but pressing it still says what's missing.
export default function CustomRequestForm() {
  const [who, setWho] = useState("");
  const [description, setDescription] = useState("");
  const [link, setLink] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [quantity, setQuantity] = useState("");
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [notSure, setNotSure] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [budget, setBudget] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const today = todayIso();
  const errors: FieldErrors = useMemo(() => {
    const { errors } = validateCustomRequest(
      { who, description, link, items, quantity, sizes, notSure, deadline, budget, name, email, phone },
      { today }
    );
    const fileError = checkUpload(file);
    return { ...errors, ...(fileError ? { file: fileError } : {}) };
  }, [who, description, link, items, quantity, sizes, notSure, deadline, budget, name, email, phone, file, today]);
  const valid = Object.keys(errors).length === 0;
  // the server's verdict is about what was sent: any edit clears it
  useEffect(() => setServerErrors({}), [who, description, link, items, quantity, sizes, notSure, deadline, budget, name, email, phone, file]);
  const shown = (f: Field) => serverErrors[f] || ((tried || touched[f]) && errors[f]) || undefined;
  const blur = (f: Field) => () => setTouched((t) => ({ ...t, [f]: true }));
  const total = sizesTotal(sizes);
  const oneSizeOnly = items.length > 0 && items.every((i) => i === "hat");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!valid) {
      const first = ORDER.find((f) => errors[f]);
      if (first) document.getElementById(`custom-${first}`)?.focus();
      return;
    }
    setStatus("sending");
    setMessage("");
    setServerErrors({});
    const fd = new FormData();
    const add = (k: string, v: string) => fd.append(k, v);
    add("who", who);
    add("description", description);
    add("link", link);
    add("items", JSON.stringify(items));
    add("quantity", quantity);
    add("sizes", JSON.stringify(sizes));
    add("notSure", String(notSure));
    add("deadline", deadline);
    add("budget", budget);
    add("name", name);
    add("email", email);
    add("phone", phone);
    add("website", (formRef.current?.elements.namedItem("website") as HTMLInputElement | null)?.value ?? "");
    if (file) fd.append("reference", file);
    try {
      const r = await fetch("/api/custom-request", { method: "POST", body: fd });
      if (r.status === 413) throw new Error("That image is too big to send; try a smaller one.");
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        if (j.errors) setServerErrors(j.errors);
        throw new Error(j.error || "Please check the fields above.");
      }
      setStatus("done");
      track("custom-request", { who, qty: Number(quantity), items: items.join("+") || "none" });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  };

  if (status === "done") {
    return (
      <div className={styles.done} role="status">
        <h2>Thanks!</h2>
        <p>John will get back to you within 1–2 days.</p>
        <Link href="/" className={styles.back}>
          Back to the shop
        </Link>
      </div>
    );
  }

  const err = (f: Field) =>
    shown(f) ? (
      <p className={styles.error} id={`custom-${f}-error`} role="alert">
        {shown(f)}
      </p>
    ) : null;
  const described = (f: Field) => (shown(f) ? { "aria-invalid": true, "aria-describedby": `custom-${f}-error` } : {});

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      {/* 1. who */}
      <fieldset className={styles.field}>
        <legend className={styles.label}>Who it&apos;s for</legend>
        <div className={styles.segmented} role="radiogroup" aria-label="Who it's for" id="custom-who" tabIndex={-1}>
          {[
            ["personal", "Just me"],
            ["business", "A business or team"],
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={who === v}
              className={who === v ? styles.on : ""}
              onClick={() => {
                setWho(v);
                setTouched((t) => ({ ...t, who: true }));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {err("who")}
      </fieldset>

      {/* 2. what */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="custom-description">
          What you want
        </label>
        <textarea
          id="custom-description"
          className={styles.textarea}
          rows={4}
          maxLength={4000}
          placeholder="Our logo on the front, sky print on the back…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={blur("description")}
          {...described("description")}
        />
        {err("description")}
      </div>

      {/* 3. reference */}
      <div className={styles.field}>
        <span className={styles.label}>
          Reference <span className={styles.optional}>optional</span>
        </span>
        <div className={styles.upload}>
          <input
            ref={fileInput}
            id="custom-file"
            className={styles.fileInput}
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setTouched((t) => ({ ...t, file: true }));
            }}
            {...described("file")}
          />
          <label htmlFor="custom-file" className={styles.fileButton}>
            {file ? "Change image" : "Add an image"}
          </label>
          {file && (
            <span className={styles.fileName}>
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB{" "}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                Remove
              </button>
            </span>
          )}
        </div>
        <p className={styles.hint}>JPG, PNG, WebP or HEIC, up to 10 MB.</p>
        {err("file")}
        <input
          id="custom-link"
          className={styles.input}
          type="url"
          inputMode="url"
          placeholder="Or a link (Instagram, Pinterest, your site…)"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onBlur={blur("link")}
          aria-label="Reference link (optional)"
          {...described("link")}
        />
        {err("link")}
      </div>

      {/* 4. items */}
      <fieldset className={styles.field}>
        <legend className={styles.label}>
          Item type <span className={styles.optional}>pick any</span>
        </legend>
        <div className={styles.chips} id="custom-items" tabIndex={-1}>
          {ITEM_TYPES.map((t) => {
            const on = items.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                className={on ? styles.on : ""}
                onClick={() => setItems((xs) => (on ? xs.filter((x) => x !== t.id) : [...xs, t.id]))}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 5. quantity */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="custom-quantity">
          Quantity
        </label>
        <input
          id="custom-quantity"
          className={`${styles.input} ${styles.qty}`}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={blur("quantity")}
          {...described("quantity")}
        />
        {err("quantity")}
      </div>

      {/* 6. sizes */}
      {!oneSizeOnly && (
        <fieldset className={styles.field}>
          <legend className={styles.label}>Sizes</legend>
          <div className={styles.sizes} id="custom-sizes" tabIndex={-1}>
            {SIZES.map((s) => (
              <label key={s} className={styles.size}>
                <span>{s}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  disabled={notSure}
                  value={sizes[s] ?? ""}
                  onChange={(e) => setSizes((x) => ({ ...x, [s]: e.target.value }))}
                  onBlur={blur("sizes")}
                  aria-label={`How many in ${s}`}
                />
              </label>
            ))}
          </div>
          <div className={styles.sizesFoot}>
            <label className={styles.check}>
              <input type="checkbox" checked={notSure} onChange={(e) => setNotSure(e.target.checked)} /> Not sure yet
            </label>
            {!notSure && Number(quantity) > 0 && (
              <span className={total === Number(quantity) ? styles.totalOk : styles.total}>
                {total} of {quantity}
              </span>
            )}
          </div>
          {err("sizes")}
        </fieldset>
      )}

      {/* 7. deadline, budget */}
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="custom-deadline">
            Deadline <span className={styles.optional}>optional</span>
          </label>
          <input
            id="custom-deadline"
            className={styles.input}
            type="date"
            min={today}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            onBlur={blur("deadline")}
            {...described("deadline")}
          />
          {err("deadline")}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="custom-budget">
            Budget <span className={styles.optional}>optional</span>
          </label>
          <input
            id="custom-budget"
            className={styles.input}
            type="text"
            maxLength={200}
            placeholder="e.g. around $300"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
      </div>

      {/* 8. contact */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="custom-name">
          Name
        </label>
        <input
          id="custom-name"
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
        <label className={styles.label} htmlFor="custom-email">
          Email
        </label>
        <input
          id="custom-email"
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
        {err("email")}
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="custom-phone">
          Phone <span className={styles.optional}>optional</span>
        </label>
        <input
          id="custom-phone"
          className={styles.input}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={blur("phone")}
          {...described("phone")}
        />
        {err("phone")}
      </div>

      {/* honeypot: hidden from people, bots fill it in */}
      <input className={styles.honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />

      <button
        type="submit"
        className={styles.submit}
        aria-disabled={!valid || status === "sending"}
        disabled={status === "sending"}
      >
        {status === "sending" ? "Sending…" : "Send request"}
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
