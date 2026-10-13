"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import HomeLink from "@/components/HomeLink";
import Image from "next/image";
import Link from "next/link";
import type { ShopProduct } from "@/lib/catalog";
import type { Selection } from "@/lib/catalog/types";
import {
  creditLinesFor,
  findVariant,
  formatPrice,
  imageSetFor,
  imagesFor,
  isAvailable,
  optionNames,
  keepPhotoPosition,
  priceLabel,
  syncedQuery,
} from "@/lib/catalog/select";
import { optionTitle, valueLabel } from "@/lib/catalog/copy";
import { crossLinkFor } from "@/lib/catalog";
import { swatchFor } from "@/lib/catalog/colors";
import { designFromCreditLines } from "@/lib/artists";
import { vendorDelivery } from "@/public/products";
import CatalogGallery from "@/components/CatalogGallery";
import ArtistCredit from "@/components/ArtistCredit";
import { createPreloadQueue, type PreloadQueue } from "@/lib/preload-queue";
import { preloadKey, preloadPlan, type PreloadKind } from "@/lib/catalog/preload-plan";
import { imageAttrs, preloadImage, wantsLessData } from "@/lib/product-image";
import StripeButton from "./StripeButton";
import DropsSignup from "@/components/DropsSignup";
import { ProductReviews, RatingSummary } from "@/components/ProductReviews";
import reviewStyles from "@/components/ProductReviews.module.css";
import type { PublicReview } from "@/lib/reviews";
import SizeGuide from "@/components/SizeGuide";
import { sizeGuides } from "@/lib/catalog/sizes.generated";
import { track } from "@/lib/umami";
import styles from "./ProductClientView.module.css";
import own from "./CatalogProductView.module.css";

// A product from the generated Printful line-up: up to three pickers (version,
// style, colour) plus size. Photos follow the version/style/colour, the price
// follows the variant, and the artist credit shows only for the selections it
// applies to (e.g. "Beanie by Janette Garcia" on the Grind Beanie style).
export default function CatalogProductView({
  product,
  initialSelection,
  reviews,
}: {
  product: ShopProduct;
  initialSelection: Selection;
  reviews?: { average: number; count: number; reviews: PublicReview[] } | null;
}) {
  const [sel, setSel] = useState<Selection>(initialSelection);
  const names = useMemo(() => optionNames(product), [product]);

  // Keep the URL in step so a pick can be shared or bookmarked.
  useEffect(() => {
    // keeps any other params (e.g. ?ref=ig from Instagram) as they came
    const query = syncedQuery(window.location.search, names, sel);
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
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
  // "Also as an all-over: Day" (lib/catalog/copy.ts), only when that product is on sale.
  const crossLink = crossLinkFor(product.slug, sel);
  const images = imagesFor(product, sel);
  // Which photo is showing (model, model2, flat...). A size change keeps the same
  // photo set; another colour/print/style keeps the same position if it has one.
  const [photoIndex, setPhoto] = useState(0);
  const photo = keepPhotoPosition(photoIndex, images.length);
  const credit = designFromCreditLines(creditLinesFor(product, sel));

  // Background preloading (lib/preload-queue.ts): starts once the first photo is
  // showing, 2 at a time, most useful first (lib/catalog/preload-plan.ts), and
  // stops when the visitor leaves the page.
  const queue = useRef<PreloadQueue<HTMLImageElement> | null>(null);
  if (!queue.current && typeof window !== "undefined") {
    queue.current = createPreloadQueue<HTMLImageElement>({
      concurrency: 2,
      run: (key, urgent, signal) => {
        const bar = key.indexOf("|");
        return preloadImage(key.slice(0, bar) as PreloadKind, key.slice(bar + 1), urgent, signal);
      },
    });
  }
  useEffect(() => () => queue.current?.abort(), []);
  const visualKey = names.filter((n) => n !== "size").map((n) => sel[n]).join("|");
  useEffect(() => {
    queue.current?.setPlan(
      preloadPlan(product, sel, photo, { saveData: wantsLessData() }).map(preloadKey)
    );
    // the plan only depends on the version/style/colour/sky picks and the photo position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, visualKey, photo]);
  const [photosReady, setPhotosReady] = useState(false);
  const { size: _size, ...withoutSize } = sel;
  const price = variant ? formatPrice(variant.price) : priceLabel(product, withoutSize);
  const delivery = vendorDelivery[product.delivery];
  const summary = names
    .filter((n) => sel[n])
    .map((n) => valueLabel(n, sel[n]!, product.optionLabels))
    .join(" · ");
  const missing = names.filter((n) => !sel[n]);

  return (
    <div className={styles.container}>
      <HomeLink className={styles.home} />

      <h1 className={styles.title}>{product.title}</h1>
      <RatingSummary data={reviews} styles={reviewStyles} />
      <p className={styles.price}>{price}</p>
      {product.fabricNote && (
        <p className={styles.fabricNote}>{product.fabricNote}</p>
      )}

      <div className={styles.productPage}>
        <div className={`${styles.gallerySide} ${own.gallery}`}>
          <CatalogGallery
            index={photo}
            onIndexChange={setPhoto}
            queue={queue.current}
            onReady={() => {
              setPhotosReady(true);
              queue.current?.start();
            }}
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
                  {(name === "color" || name === "sky") && sel[name] && (
                    <span className={own.current}>: {valueLabel(name, sel[name]!, product.optionLabels)}</span>
                  )}
                </legend>
                {name === "size" && product.sizeNote && (
                  <p className={own.sizeNote}>{product.sizeNote}</p>
                )}
                <div className={name === "sky" ? own.thumbChoices : own.choices}>
                  {product.options[name].map((value) => {
                    // Skies are picked from labelled thumbnails of the shirt itself
                    // (its flat front: the whole sky, top to hem).
                    if (name === "sky") {
                      const set = imageSetFor(product, { ...sel, sky: value });
                      const thumb =
                        set?.images.find((src) => /(^|[-/])flat\./.test(src)) ?? set?.images[0];
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={sel.sky === value}
                          onClick={() => pick(name, value)}
                          className={[own.thumbChoice, sel.sky === value ? own.selected : ""].join(" ")}
                        >
                          {/* tiles wait for the big photo, so it gets the bandwidth first */}
                          {photosReady ? (
                            <Image src={thumb} alt="" width={120} height={120} sizes="64px" fetchPriority="low" className={own.thumbImage} />
                          ) : (
                            <span className={own.thumbImage} />
                          )}
                          <span className={own.thumbLabel}>{valueLabel(name, value, product.optionLabels)}</span>
                        </button>
                      );
                    }
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
                        {swatch ? null : valueLabel(name, value, product.optionLabels)}
                      </button>
                    );
                  })}
                </div>
                {name === "size" && sizeGuides[product.printfulCatalogProductId ?? -1] && (
                  <SizeGuide
                    guide={sizeGuides[product.printfulCatalogProductId!]}
                    title={product.title}
                    sizes={product.options.size}
                    selected={sel.size}
                  />
                )}
              </fieldset>
            ))}
          </div>

          <ArtistCredit design={credit} className={styles.credit} />

          {crossLink && (
            <p className={own.crossLink}>
              <Link
                href={crossLink.href}
                onClick={() => track("crosslink-allover", { from: product.slug, to: crossLink.href.split("?")[0].slice(1) })}
              >
                {crossLink.text} →
              </Link>
            </p>
          )}

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

          <p className={own.customLine}>
            Want this for your team? <Link href="/custom">Custom orders →</Link>
          </p>

          <ProductReviews data={reviews} styles={reviewStyles} />

          <DropsSignup source={`product:${product.slug}`} compact />
        </div>
      </div>

      <p className={styles.shipping}>
        <span>
          Free US shipping — {delivery.text}.{" "}
          <Link href="/shipping-returns" className={own.policyLink}>
            Shipping &amp; returns
          </Link>
        </span>
      </p>

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
        <Link href="/shipping-returns" className={own.buyPolicy}>
          Free US shipping · Shipping &amp; returns
        </Link>
      </div>

      {/* Desktop-only faint ghosts at the sides: the same URLs as the big photo
          (no extra downloads), once the photos are in. */}
      {photosReady && <Ghost src={images[0]} side="left" />}
      {photosReady && images[1] && queue.current?.status(preloadKey({ kind: "main", src: images[1] })) === "loaded" && (
        <Ghost src={images[1]} side="right" />
      )}
    </div>
  );
}

function Ghost({ src, side }: { src: string; side: "left" | "right" }) {
  const attrs = imageAttrs("main", src);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...attrs}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className={`${styles["product-page-background"]} ${styles["background-ghost"]} ${styles["loaded"]} ${styles["bg-" + side]}`}
    />
  );
}
