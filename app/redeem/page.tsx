// 🖥️ app/redeem/page.tsx (frontend UI)
"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";

export default function RedeemPage() {
  const [step, setStep] = useState<"code" | "info" | "done">("code");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [fact, setFact] = useState("");
  const [error, setError] = useState("");

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/validate-code", {
        method: "POST",
        body: JSON.stringify({ code }),
        headers: { "Content-Type": "application/json" },
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.valid) setStep("info");
      else
        setError(data.alreadyRedeemed ? "Code already used." : "Invalid code.");
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/redeem", {
        method: "POST",
        body: JSON.stringify({ code, name, fact }),
        headers: { "Content-Type": "application/json" },
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) setStep("done");
      else setError("Something went wrong.");
    },
  });

  return (
    <main
      style={{
        textAlign: "center",
        padding: "3rem",
        fontFamily: "var(--font-orbitron), sans-serif",
      }}
    >
      <h1>Redeem Your Code</h1>
      {step === "code" && (
        <>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter your code"
            style={{
              padding: "0.75rem",
              fontSize: "1rem",
              border: "2px solid #ff8c00",
              borderRadius: "6px",
              marginRight: "1rem",
              fontFamily: "var(--font-orbitron), sans-serif",
            }}
          />
          <button
            onClick={() => validateMutation.mutate()}
            style={{
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
            }}
          >
            Validate
          </button>
        </>
      )}

      {step === "info" && (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={{
              padding: "0.75rem",
              fontSize: "1rem",
              border: "2px solid #ff8c00",
              borderRadius: "6px",
              marginRight: "1rem",
              fontFamily: "var(--font-orbitron), sans-serif",
            }}
          />
          <input
            value={fact}
            onChange={(e) => setFact(e.target.value)}
            placeholder="Fun fact"
            style={{
              padding: "0.75rem",
              fontSize: "1rem",
              border: "2px solid #ff8c00",
              borderRadius: "6px",
              marginRight: "1rem",
              fontFamily: "var(--font-orbitron), sans-serif",
            }}
          />
          <button
            onClick={() => redeemMutation.mutate()}
            style={{
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
            }}
          >
            Submit
          </button>
        </>
      )}

      {step === "done" && <p>Thanks! You're all set.</p>}

      {error && <p style={{ color: "red" }}>{error}</p>}

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
