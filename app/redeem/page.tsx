// /redeem — old two-part card codes (COW-76). A code is checked, then claimed
// with a name, a fun fact, a photo of the shirt or card and an optional way to
// reach the owner; John checks every claim himself (lib/legacy-claims.ts).
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Step = "code" | "info" | "done";

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "22rem",
  boxSizing: "border-box",
  margin: "0 auto",
  padding: "0.75rem",
  fontSize: "1rem",
  border: "2px solid #ff8c00",
  borderRadius: "6px",
  fontFamily: "var(--font-orbitron), sans-serif",
};

const button: React.CSSProperties = {
  padding: "0.75rem 1.5rem",
  fontSize: "1rem",
  border: "2px solid #ff8c00",
  borderRadius: "6px",
  backgroundColor: "#ff8c00",
  color: "white",
  fontWeight: "bold",
  fontFamily: "var(--font-orbitron), sans-serif",
  cursor: "pointer",
  transition: "all 0.3s ease",
};

const label: React.CSSProperties = { display: "block", margin: "1rem auto 0.35rem", maxWidth: "22rem", fontSize: "0.85rem", textAlign: "left" };
const fieldError: React.CSSProperties = { color: "red", fontSize: "0.8rem", margin: "0.35rem auto 0", maxWidth: "22rem", textAlign: "left" };

export default function RedeemPage() {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [name, setName] = useState("");
  const [fact, setFact] = useState("");
  const [contact, setContact] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);

  // /register sends the old two-part codes here as ?code=COW-76: fill the box
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c.toUpperCase());
  }, []);

  const validate = async () => {
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/legacy-claim/lookup", {
        method: "POST",
        body: JSON.stringify({ code }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await r.json();
      if (data.status === "ok") {
        setClaimCode(data.code);
        setStep("info");
      } else if (data.status === "claimed") setError("This code has already been claimed. If that wasn't you, message us on Instagram.");
      else if (data.status === "limited") setError("Too many tries; please wait a few minutes.");
      else setError("Invalid code.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  };

  const submit = async () => {
    setError("");
    setErrors({});
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = "Add your name";
    if (!photo) local.photo = "Add a photo of your shirt or card";
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("code", claimCode);
      form.set("name", name);
      form.set("fact", fact);
      form.set("contact", contact);
      form.set("website", honeypot.current?.value ?? "");
      if (photo) form.set("photo", photo);
      const r = await fetch("/api/legacy-claim", { method: "POST", body: form });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) setStep("done");
      else if (data.claimed) setError(data.error);
      else if (data.errors) setErrors(data.errors);
      else setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <main
      style={{
        textAlign: "center",
        padding: "3rem 1.25rem",
        fontFamily: "var(--font-orbitron), sans-serif",
      }}
    >
      <h1>Redeem Your Code</h1>
      {step === "code" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void validate();
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter your code"
            aria-label="Your code"
            autoCapitalize="characters"
            autoComplete="off"
            style={input}
          />
          <button type="submit" disabled={busy || !code.trim()} style={{ ...button, marginTop: "1rem" }}>
            Validate
          </button>
        </form>
      )}

      {step === "info" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p style={{ maxWidth: "22rem", margin: "0 auto 0.5rem", fontSize: "0.9rem" }}>
            Code <b>{claimCode}</b>. Tell us who you are and send a photo of your shirt or card.
          </p>

          <label htmlFor="redeem-name" style={label}>
            Your name
          </label>
          <input id="redeem-name" value={name} onChange={(e) => { setName(e.target.value); setErrors(({ name: _n, ...rest }) => rest); }} placeholder="Your name" maxLength={60} style={input} />
          {errors.name && <p style={fieldError}>{errors.name}</p>}

          <label htmlFor="redeem-fact" style={label}>
            Fun fact
          </label>
          <input id="redeem-fact" value={fact} onChange={(e) => setFact(e.target.value)} placeholder="Fun fact" maxLength={300} style={input} />

          <label htmlFor="redeem-photo" style={label}>
            Photo of your shirt or card (required)
          </label>
          <input
            id="redeem-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(e) => {
              setPhoto(e.target.files?.[0] ?? null);
              setErrors(({ photo: _p, ...rest }) => rest);
            }}
            style={{ ...input, padding: "0.5rem", fontSize: "0.8rem", background: "#fff" }}
          />
          {errors.photo && <p style={fieldError}>{errors.photo}</p>}

          <label htmlFor="redeem-contact" style={label}>
            Email or Instagram (optional, so John can reach you)
          </label>
          <input
            id="redeem-contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="you@example.com or @you"
            autoCapitalize="none"
            maxLength={254}
            style={input}
          />
          {errors.contact && <p style={fieldError}>{errors.contact}</p>}

          {/* honeypot: people never see or fill this */}
          <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />

          <button type="submit" disabled={busy} style={{ ...button, marginTop: "1.25rem" }}>
            {busy ? "Sending…" : "Submit"}
          </button>
        </form>
      )}

      {step === "done" && <p role="status">Thanks! John will check it and reach out.</p>}

      {(error || errors.code) && (
        <p role="alert" style={{ color: "red", maxWidth: "22rem", margin: "1rem auto 0" }}>
          {error || errors.code}
        </p>
      )}

      <p style={{ marginTop: "2rem" }}>
        <Link
          href="/"
          style={{
            color: "#ff8c00",
            textDecoration: "none",
            fontWeight: "bold",
          }}
          onClick={() => {
            sessionStorage.setItem("fromClientNav", "true");
          }}
        >
          ← Back to Home
        </Link>
      </p>
    </main>
  );
}
