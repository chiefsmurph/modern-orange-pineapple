"use client";
// The product page's buy buttons: "Add to bag" (primary) and "Buy now" (this
// one item straight to Stripe, as before). Adding opens a small sheet:
// "Added to bag: Pelican Tee · Big · Lagoon Blue · M" with Checkout / Keep shopping.
// A product that can't go in the bag (buyNowOnly, lib/product-page.ts) gets one
// "Buy now" button in the primary style instead.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { PageProduct } from "@/lib/product-page";
import { addLine, bagCount, bagId, readBag, variantSummary, writeBag } from "@/lib/bag";
import { startBagCheckout } from "@/lib/bag-checkout-client";
import { imageSetFor, imagesFor } from "@/lib/catalog/select";
import { track } from "@/lib/umami";
import { singleCheckout } from "./StripeButton";
import bag from "@/components/Bag.module.css";

type Variant = { opts: Record<string, string>; price: number };

export default function AddToBag({
  product,
  sel,
  variant,
  chooseLabel,
}: {
  product: PageProduct;
  sel: Record<string, string | undefined>;
  /** The complete pick, or undefined until every option is chosen. */
  variant: Variant | undefined;
  /** "Choose a size" etc., while the pick isn't complete. */
  chooseLabel: string;
}) {
  const [added, setAdded] = useState<{ text: string; image: string } | null>(null);
  const [busy, setBusy] = useState<"buy" | "checkout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!added) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAdded(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [added]);

  const add = () => {
    if (!variant) return;
    setError(null);
    const summary = variantSummary(product, variant.opts);
    const { lines, ok } = addLine(readBag().lines, bagId(product.slug, variant.opts), product.title);
    if (!ok) {
      setError("Your bag is full (20 of an item, or 20 different items). Check out, or remove something first.");
      return;
    }
    writeBag(lines);
    setCount(bagCount(lines));
    track("add-to-bag", { slug: product.slug, variant: summary, price: variant.price });
    if (typeof window !== "undefined" && window.gtag)
      window.gtag("event", "add_to_cart", {
        currency: "USD",
        value: variant.price,
        items: [{ item_id: product.slug, item_name: product.title, item_variant: summary, price: variant.price, quantity: 1 }],
      });
    setAdded({
      text: [product.title, summary].filter(Boolean).join(" · "),
      image: imageSetFor(product, variant.opts)?.checkout ?? imagesFor(product, variant.opts)[0],
    });
  };

  const buyNow = async () => {
    if (!variant) return;
    setBusy("buy");
    setError(null);
    const err = await singleCheckout({ productId: product.slug, title: product.title, value: variant.price, options: sel });
    if (err) {
      setBusy(null);
      setError(err);
    }
  };

  const checkout = async () => {
    setBusy("checkout");
    setError(null);
    const { error: err } = await startBagCheckout(readBag().lines);
    if (err) {
      setBusy(null);
      setError(err);
    }
  };

  return (
    <>
      <div className={bag.buttons}>
        {product.buyNowOnly ? (
          <button type="button" className={bag.add} onClick={buyNow} disabled={!variant || busy !== null}>
            {!variant ? chooseLabel : busy === "buy" ? "Opening…" : "Buy now"}
          </button>
        ) : (
          <>
            <button type="button" className={bag.add} onClick={add} disabled={!variant || busy !== null}>
              {variant ? "Add to bag" : chooseLabel}
            </button>
            <button type="button" className={bag.buyNow} onClick={buyNow} disabled={!variant || busy !== null}>
              {busy === "buy" ? "Opening…" : "Buy now"}
            </button>
          </>
        )}
      </div>
      {error && !added && (
        <p role="alert" className={bag.error}>
          {error}
        </p>
      )}

      {added && (
        <div className={bag.sheet} role="dialog" aria-label="Added to bag">
          <div className={bag.sheetRow}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={added.image} alt="" className={bag.sheetThumb} width={56} height={56} />
            <p className={bag.sheetText} role="status">
              <b>✓ ADDED TO BAG</b>
              {added.text}
            </p>
          </div>
          <div className={bag.sheetButtons}>
            <button type="button" className={bag.add} onClick={checkout} disabled={busy !== null}>
              {busy === "checkout" ? "Opening…" : "Checkout"}
            </button>
            <button type="button" className={bag.buyNow} onClick={() => setAdded(null)} disabled={busy !== null}>
              Keep shopping
            </button>
          </div>
          {error && (
            <p role="alert" className={bag.error}>
              {error}
            </p>
          )}
          <p className={bag.sheetBag}>
            {count} item{count === 1 ? "" : "s"} in your bag · <Link href="/bag">View bag</Link>
          </p>
        </div>
      )}
    </>
  );
}
