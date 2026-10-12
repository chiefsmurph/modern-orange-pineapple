"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ShopProduct } from "@/lib/catalog";
import type { Selection } from "@/lib/catalog/types";
import {
  creditLinesFor,
  findVariant,
  formatPrice,
  imagesFor,
  isAvailable,
  optionNames,
  priceLabel,
} from "@/lib/catalog/select";
import { optionTitle, valueLabel } from "@/lib/catalog/copy";
import { swatchFor } from "@/lib/catalog/colors";
import { designFromCreditLines } from "@/lib/artists";
import { vendorDelivery } from "@/public/products";
import CatalogGallery from "@/components/CatalogGallery";
import ArtistCredit from "@/components/ArtistCredit";
import ProductPageBackground from "./ProductPageBackground";
import StripeButton from "./StripeButton";
import styles from "./ProductClientView.module.css";
import own from "./CatalogProductView.module.css";

// A product from the generated Printful line-up: up to three pickers (version,
// style, colour) plus size. Photos follow the version/style/colour, the price
// follows the variant, and the artist credit shows only for the selections it
// applies to (e.g. "Beanie by Janette Garcia" on the Grind Beanie style).
export default function CatalogProductView({
  product,
  initialSelection,
}: {
  product: ShopProduct;
  initialSelection: Selection;
}) {
  const [sel, setSel] = useState<Selection>(initialSelection);
  const names = useMemo(() => optionNames(product), [product]);

  // Keep the URL in step so a pick can be shared or bookmarked.
  useEffect(() => {
    const qs = new URLSearchParams();
    for (const n of names) if (sel[n]) qs.set(n, sel[n]!);
    const url = `${window.location.pathname}?${qs}`;
    window.history.replaceState(window.history.state, "", url);
  }, [sel, names]);

  // Pick a value; any other pick that no longer exists with it is moved to the
  // first value that does (size is cleared instead, so nobody buys the wrong size).
  const pick = (name: string, value: string) =>
    setSel((prev) => {
      const next: Selection = { ...prev, [name]: value };
      for (const other of names) {
        if (other === name || !next[other]) continue;
        if (isAvailable(product, next, other, next[other]!)) continue;
        if (other === "size") {
          next.size = undefined;
          continue;
        }
        next[other] = product.options[other].find((v) =>
          isAvailable(product, next, other, v)
        );
      }
      return next;
    });

  const variant = findVariant(product, sel);
  const images = imagesFor(product, sel);
  const credit = designFromCreditLines(creditLinesFor(product, sel));
  const { size: _size, ...withoutSize } = sel;
  const price = variant ? formatPrice(variant.price) : priceLabel(product, withoutSize);
  const delivery = vendorDelivery[product.delivery];
  const summary = names
    .filter((n) => sel[n])
    .map((n) => valueLabel(n, sel[n]!))
    .join(" · ");
  const missing = names.filter((n) => !sel[n]);

  return (
    <div className={styles.container}>
      <Link
        href="/"
        className={styles.home}
        onClick={() => sessionStorage.setItem("fromClientNav", "true")}
      >
        ← Home
      </Link>

      <h1 className={styles.title}>{product.title}</h1>
      <p className={styles.price}>{price}</p>
      {product.fabricNote && (
        <p className={styles.fabricNote}>{product.fabricNote}</p>
      )}

      <div className={styles.productPage}>
        <div className={`${styles.gallerySide} ${own.gallery}`}>
          {/* remount on a new photo set so it starts at the first photo */}
          <CatalogGallery
            key={images.join("|")}
            images={images}
            alt={`${product.title}${summary ? `: ${summary}` : ""}`}
          />
        </div>
        <div className={`${styles.textSide} ${own.text}`}>
          <div className={own.pickers}>
            {names.map((name) => (
              <fieldset key={name} className={own.picker}>
                <legend className={own.legend}>
                  {optionTitle(name)}
                  {name === "color" && sel.color && (
                    <span className={own.current}>: {sel.color}</span>
                  )}
                </legend>
                <div className={own.choices}>
                  {product.options[name].map((value) => {
                    const selected = sel[name] === value;
                    // Only sizes are greyed out (for the current version/style/colour);
                    // any other pick is always allowed and pick() adjusts the rest.
                    const available =
                      name !== "size" || isAvailable(product, withoutSize, name, value);
                    const swatch = name === "color" ? swatchFor(value, product.printfulCatalogProductId) : undefined;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        disabled={!available}
                        onClick={() => pick(name, value)}
                        className={[
                          swatch ? own.swatch : own.pill,
                          selected ? own.selected : "",
                        ].join(" ")}
                        title={swatch ? value : undefined}
                        aria-label={swatch ? value : undefined}
                        style={
                          swatch
                            ? {
                                background:
                                  swatch.length > 1
                                    ? `linear-gradient(135deg, ${swatch[0]} 50%, ${swatch[1]} 50%)`
                                    : swatch[0],
                              }
                            : undefined
                        }
                      >
                        {swatch ? null : valueLabel(name, value)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          <ArtistCredit design={credit} className={styles.credit} />

          <p
            className={styles.desc}
            dangerouslySetInnerHTML={{
              __html: product.description
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .split("\n")
                .join("<br/>"),
            }}
          />
        </div>
      </div>

      <p className={styles.shipping}>Shipping: $0.00 (free) — {delivery.text}</p>

      <div className={own.buyBar}>
        <p className={own.buySummary}>
          <b>{price}</b>
          {summary && <span> · {summary}</span>}
        </p>
        <StripeButton
          productId={product.slug}
          title={product.title}
          value={variant?.price}
          options={sel}
          disabled={!variant}
          label={
            variant
              ? "Buy with Stripe"
              : missing.includes("size")
                ? "Choose a size"
                : `Choose ${missing.map(optionTitle).join(", ").toLowerCase()}`
          }
        />
      </div>

      <ProductPageBackground src={images[0]} side="left" />
      <ProductPageBackground src={images[1]} side="right" />
    </div>
  );
}
