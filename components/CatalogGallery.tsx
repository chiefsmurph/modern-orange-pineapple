"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { decodeImage, imageAttrs } from "@/lib/product-image";
import { preloadKey } from "@/lib/catalog/preload-plan";
import type { PreloadQueue } from "@/lib/preload-queue";
import WildLightbox from "./WildLightbox";
import styles from "./CatalogGallery.module.css";

// Photos for the Printful line-up: one big photo in a fixed square frame plus
// thumbnails. The page owns which photo is shown (index), so it survives picker
// changes (keepPhotoPosition()).
//
// Loading:
// - First visit: a spinner in the frame until the first photo has loaded, then
//   it fades in. (A capturing "load" listener in app/layout.tsx marks the frame
//   ready even before React has hydrated; see data-main-photo.)
// - A new pick that's already preloaded: the old photo stays until the new one
//   is decoded, then they swap in one paint.
// - A new pick that isn't: it jumps the preload queue and a spinner shows over
//   the old photo until it's in. Only the latest pick ever lands.
//
// Clicking or tapping the big photo opens it full screen (components/WildLightbox.tsx)
// with the rest of the set that's showing, at the original files (1600 px for the
// line-up). Arrowing through the viewer doesn't change the photo here.
export default function CatalogGallery({
  images,
  alt,
  index,
  onIndexChange,
  queue,
  onReady,
}: {
  images: string[];
  alt: string;
  index: number;
  onIndexChange: (index: number) => void;
  queue?: PreloadQueue<HTMLImageElement> | null;
  /** The first photo is showing: background work may start. */
  onReady?: () => void;
}) {
  const target = images[index] ?? images[0];
  const [shown, setShown] = useState(target);
  // the thumbnails follow the photo that's showing, so they never run ahead of it
  const [shownSet, setShownSet] = useState(images);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  // the viewer, open at this photo of shownSet
  const [viewer, setViewer] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const latest = useRef(0);

  const markReady = () => {
    frame.current?.setAttribute("data-ready", "");
    if (!ready) {
      setReady(true);
      onReady?.();
    }
  };

  // Loaded before hydration (or from cache)?
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth > 0) markReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new pick: swap when it's loaded and decoded; the latest pick wins.
  useEffect(() => {
    const ticket = ++latest.current;
    const set = images;
    if (target === shown) {
      setShownSet(set);
      setBusy(false);
      return;
    }
    const key = preloadKey({ kind: "main", src: target });
    if (!queue || queue.status(key) !== "loaded") setBusy(true);
    const loading = queue ? queue.request(key) : Promise.resolve(null);
    loading
      .then((el) => decodeImage(el))
      .catch(() => undefined) // a failed preload: let the <img> try on its own
      .then(() => {
        if (latest.current !== ticket) return;
        setShown(target);
        setShownSet(set);
        setBusy(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, images.join("|")]);

  if (!shown) return null;
  const main = imageAttrs("main", shown, alt, true);

  return (
    <div className={styles.gallery}>
      <div
        ref={frame}
        className={`${styles.frame} ${busy ? styles.busy : ""}`}
        data-main-photo-frame=""
        aria-busy={busy || !ready}
      >
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img
          {...main}
          ref={img}
          className={styles.main}
          data-main-photo=""
          onLoad={markReady}
          onError={markReady}
        />
        <span className={styles.spinner} aria-hidden="true" />
        {/* over the photo (the <img> stays the frame's child for the ready script in app/layout.tsx) */}
        <button
          type="button"
          className={styles.enlarge}
          onClick={() => setViewer(Math.max(0, shownSet.indexOf(shown)))}
          aria-label="Enlarge photo"
        />
      </div>
      {shownSet.length > 1 && (
        <div className={styles.thumbs}>
          {shownSet.map((src, i) => (
            <button
              key={src}
              type="button"
              className={`${styles.thumb} ${i === index ? styles.active : ""}`}
              onClick={() => onIndexChange(i)}
              aria-label={`Photo ${i + 1} of ${shownSet.length}`}
              aria-pressed={i === index}
            >
              {/* thumbnails wait for the big photo, so it gets the bandwidth first */}
              {ready && <Image src={src} alt="" width={120} height={120} sizes="64px" fetchPriority="low" />}
            </button>
          ))}
        </div>
      )}
      {/* on <body>: the sticky gallery column would keep it under the bag button */}
      {viewer !== null &&
        createPortal(
          <WildLightbox
            photos={shownSet.map((src) => ({ src, alt }))}
            start={viewer}
            onClose={() => setViewer(null)}
            label={alt}
            pinchZoom
          />,
          document.body
        )}
    </div>
  );
}
