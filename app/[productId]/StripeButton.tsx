"use client";
import { useState } from "react";
import styles from "./StripeButton.module.css";

export default function StripeButton({
  productId,
  title,
  value,
  options,
  disabled,
  label = "Buy with Stripe",
}: {
  productId: string;
  title: string;
  /** The price shown to the customer, for analytics. */
  value: number | undefined;
  /** Option name -> picked value; sent to /api/checkout, which re-checks everything. */
  options: Record<string, string | undefined>;
  disabled: boolean;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkout = async () => {
    setLoading(true);
    setError(null);

    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "begin_checkout", {
        currency: "USD",
        value,
        items: [
          {
            item_id: productId,
            item_name: title,
            ...options,
          },
        ],
      });
    }
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, ...options }),
      });
      const { url } = await r.json();
      if (!r.ok || !url) throw new Error("checkout failed");
      window.location.href = url;
    } catch {
      setLoading(false);
      setError("Sorry, checkout didn't open. Please try again.");
    }
  };

  return (
    <>
      <button
        onClick={checkout}
        disabled={loading || disabled}
        className={styles.buy}
      >
        {loading ? "Redirecting…" : label}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </>
  );
}
