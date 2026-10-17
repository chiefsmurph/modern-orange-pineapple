"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WildPhoto } from "@/lib/wild.generated";

/**
 * What the lightbox shows: an "Out in the wild" photo, an owner photo from The
 * MOP Crew, or a product photo (no caption link: only src and alt).
 */
export type LightboxPhoto = Pick<WildPhoto, "alt" | "src"> &
  Partial<Pick<WildPhoto, "n" | "design" | "href" | "width" | "height">> & {
    /** e.g. "Ana · Verified owner" */
    credit?: string;
  };
import styles from "./WildLightbox.module.css";

// Full-screen photo viewer: swipe left/right (touch or pen), arrow buttons and
// ←/→ keys, Esc or ✕ closes. The page behind doesn't scroll while it's open,
// focus moves into it and back to where it was on close. Neighbouring photos are
// fetched ahead so a swipe shows the next one at once.
//
// Also the product photo viewer (components/CatalogGallery.tsx, ProductGallery.tsx):
// `label` names the dialog, `tile` puts the light photo tile behind transparent
// product cut-outs (a black tee would vanish on the dark backdrop), and
// `pinchZoom` lets phones pinch-zoom the photo with the browser's own zoom. While
// zoomed in, one finger pans around the photo (no swipe to the next one); pinch
// back out to swipe again.
export default function WildLightbox({
  photos,
  start,
  onClose,
  label = "Out in the wild",
  tile = false,
  pinchZoom = false,
}: {
  photos: LightboxPhoto[];
  start: number;
  onClose: () => void;
  /** the dialog's name: "<label>: photo 2 of 5" */
  label?: string;
  tile?: boolean;
  pinchZoom?: boolean;
}) {
  const [i, setI] = useState(start);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const zoomed = useZoomed(pinchZoom);
  const n = photos.length;
  const go = useCallback((d: number) => setI((v) => (v + d + n) % n), [n]);

  // keys, scroll lock, focus in and back out
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = overflow;
      before?.focus?.();
    };
  }, [go, onClose]);

  // fetch the neighbours ahead
  useEffect(() => {
    for (const d of [1, -1]) {
      const img = new Image();
      img.decoding = "async";
      img.src = photos[(i + d + n) % n].src;
    }
  }, [i, n, photos]);

  const p = photos[i];
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`${label}: photo ${i + 1} of ${n}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button ref={closeBtn} type="button" className={styles.close} onClick={onClose} aria-label="Close">
        ✕
      </button>
      <div
        className={`${styles.stage} ${pinchZoom ? styles.pinch : ""} ${zoomed ? styles.zoomed : ""}`}
        onPointerDown={(e) => {
          // a second finger is a pinch, not a swipe; zoomed in, one finger pans
          if (!e.isPrimary || zoomed) swipe.current = null;
          else if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => (swipe.current = null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={p.src}
          src={p.src}
          alt={p.alt}
          width={p.width}
          height={p.height}
          className={`${styles.photo} ${tile ? styles.tile : ""}`}
          draggable={false}
        />
      </div>
      {n > 1 && (
        <>
          <button type="button" className={`${styles.nav} ${styles.prev}`} onClick={() => go(-1)} aria-label="Previous photo">
            ‹
          </button>
          <button type="button" className={`${styles.nav} ${styles.next}`} onClick={() => go(1)} aria-label="Next photo">
            ›
          </button>
        </>
      )}
      <p className={styles.caption}>
        {p.href && (
          <Link href={p.href} onClick={onClose}>
            {p.design}
          </Link>
        )}
        {p.credit && <span className={styles.credit}>{p.credit}</span>}
        {n > 1 && (
          <span className={styles.count}>
            {i + 1} / {n}
          </span>
        )}
      </p>
    </div>
  );
}

/** Is the page pinch-zoomed in (visualViewport.scale > 1)? Only tracked when `on`. */
function useZoomed(on: boolean) {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!on || !vv) return;
    const check = () => setZoomed(vv.scale > 1.01);
    check();
    vv.addEventListener("resize", check);
    return () => vv.removeEventListener("resize", check);
  }, [on]);
  return zoomed;
}
