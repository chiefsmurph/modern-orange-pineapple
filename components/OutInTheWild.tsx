"use client";
import { useEffect, useRef, useState } from "react";
import type { WildPhoto } from "@/lib/wild.generated";
import { GRID_COUNT } from "@/lib/wild";
import styles from "./OutInTheWild.module.css";

// "Out in the wild" near the bottom of the home page: 9 photos (3×3 squares) and
// "See all". The page decides which 9 (one shuffle per visit, shared with the
// strip at the top: lib/wild.ts mixWild) and owns the lightbox. Nothing loads
// until the section scrolls near the screen. Not for sale here: the lightbox
// captions link to the product pages.
export default function OutInTheWild({
  photos,
  total,
  onOpen,
}: {
  /** The 9 to show, or null before the visit's shuffle (placeholders keep the size). */
  photos: WildPhoto[] | null;
  total: number;
  /** Open the lightbox at this photo (null = from the first). */
  onOpen: (photo: WildPhoto | null) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);

  // Load only when the section is within ~1.5 screens.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (total === 0) return null;

  return (
    <section ref={section} className={styles.wild} aria-labelledby="out-in-the-wild">
      <h2 id="out-in-the-wild" className={styles.title}>
        Out in the wild
      </h2>
      <p className={styles.sub}>Real people, real shirts.</p>
      <ul className={styles.grid}>
        {Array.from({ length: Math.min(GRID_COUNT, total) }, (_, i) => {
          const p = near && photos ? photos[i] : undefined;
          return (
            <li key={p?.n ?? `slot-${i}`} className={styles.cell}>
              {p ? (
                <button
                  type="button"
                  className={styles.tile}
                  onClick={() => onOpen(p)}
                  aria-label={`${p.alt}: open the photo`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.square} alt={p.alt} width={500} height={500} loading="lazy" decoding="async" />
                </button>
              ) : (
                <span className={styles.tile} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className={styles.seeAll} onClick={() => onOpen(null)}>
        See all {total} photos
      </button>
    </section>
  );
}
