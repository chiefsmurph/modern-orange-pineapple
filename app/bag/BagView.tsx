"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import HomeLink from "@/components/HomeLink";
import { bagCount, clearBag, lineView, MAX_BAG_QTY, removeLine, setQty, useBag, writeBag, type BagLineView } from "@/lib/bag";
import { startBagCheckout } from "@/lib/bag-checkout-client";
import { formatPrice } from "@/lib/catalog/select";
import styles from "../[productId]/ProductClientView.module.css";
import own from "./bag.module.css";
import bagStyles from "@/components/Bag.module.css";

const money = (n: number) => (Number.isInteger(n) ? formatPrice(n) : `$${n.toFixed(2)}`);

export default function BagView() {
  const { lines, dropped } = useBag();
  const [mounted, setMounted] = useState(false);
  const [paid, setPaid] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Back from Stripe after paying: the order is in, so the bag is done.
    if (new URLSearchParams(window.location.search).get("status") === "success") {
      clearBag();
      setPaid(true);
    }
  }, []);

  // Items the shop no longer sells are taken out, with a note.
  useEffect(() => {
    if (!mounted || dropped.length === 0) return;
    setNote(`Removed from your bag (no longer available): ${dropped.join(", ")}.`);
    writeBag(lines);
  }, [mounted, dropped, lines]);

  const views = lines.map(lineView).filter((v): v is BagLineView => v !== null);
  const subtotal = views.reduce((n, v) => n + v.unitPrice * v.qty, 0);
  const count = bagCount(lines);

  const checkout = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await startBagCheckout(lines);
    if (err) {
      setBusy(false);
      setError(err);
    }
  };

  return (
    <div className={`${styles.container} ${own.page}`}>
      <HomeLink className={styles.home} />
      <h1 className={own.title}>Your bag</h1>

      {!mounted ? null : paid ? (
        <div className={own.thanks} role="status">
          <p>
            <b>Thank you! Your order is in.</b>
          </p>
          <p>Stripe is emailing your receipt. Everything is made to order; we&apos;ll let you know when it ships.</p>
          <p>
            <Link href="/">Back to the shop →</Link>
          </p>
        </div>
      ) : (
        <>
          {note && <p className={own.note}>{note}</p>}
          {views.length === 0 ? (
            <div className={own.empty}>
              <p>Your bag is empty.</p>
              <p>
                <Link href="/">Shop everything →</Link>
              </p>
            </div>
          ) : (
            <>
              <ul className={own.lines}>
                {views.map((v) => (
                  <li key={v.id} className={own.line}>
                    <Link href={v.href} className={own.thumbLink}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.image} alt="" width={84} height={84} className={own.thumb} />
                    </Link>
                    <div className={own.info}>
                      <Link href={v.href} className={own.name}>
                        {v.title}
                      </Link>
                      {v.summary && <span className={own.variant}>{v.summary}</span>}
                      <span className={own.unit}>{money(v.unitPrice)} each</span>
                      <div className={own.controls}>
                        <div className={own.stepper} role="group" aria-label={`Quantity of ${v.title}`}>
                          <button
                            type="button"
                            aria-label="One fewer"
                            disabled={v.qty <= 1 || busy}
                            onClick={() => writeBag(setQty(lines, v.id, v.qty - 1))}
                          >
                            −
                          </button>
                          <span aria-live="polite">{v.qty}</span>
                          <button
                            type="button"
                            aria-label="One more"
                            disabled={v.qty >= MAX_BAG_QTY || busy}
                            onClick={() => writeBag(setQty(lines, v.id, v.qty + 1))}
                          >
                            +
                          </button>
                        </div>
                        <button type="button" className={own.remove} disabled={busy} onClick={() => writeBag(removeLine(lines, v.id))}>
                          Remove
                        </button>
                      </div>
                    </div>
                    <span className={own.lineTotal}>{money(v.unitPrice * v.qty)}</span>
                  </li>
                ))}
              </ul>

              <div className={own.summary}>
                <p className={own.subtotal}>
                  <span>
                    Subtotal ({count} item{count === 1 ? "" : "s"})
                  </span>
                  <b>{money(subtotal)}</b>
                </p>
                <p className={own.free}>Free US shipping</p>
                <p className={own.code}>Have a code? Add it at checkout.</p>
                <button type="button" className={bagStyles.add} style={{ width: "100%" }} onClick={checkout} disabled={busy}>
                  {busy ? "Opening checkout…" : "Checkout"}
                </button>
                {error && (
                  <p role="alert" className={bagStyles.error}>
                    {error}
                  </p>
                )}
                <p className={own.keep}>
                  <Link href="/">Keep shopping</Link> ·{" "}
                  <Link href="/shipping-returns">Shipping &amp; returns</Link>
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
