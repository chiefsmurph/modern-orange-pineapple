"use client";
import { useEffect, useRef, useState } from "react";
import { wildPhotos, type WildPhoto } from "@/lib/wild.generated";
import { pickRandom } from "@/lib/wild";
import WildLightbox from "./WildLightbox";
import styles from "./OutInTheWild.module.css";

const GRID = 9;

// "Out in the wild": 9 random photos of people wearing MOP (3×3 squares), and
// "See all" opens a swipeable lightbox of every photo. Nothing loads until the
// section scrolls near the screen, and the random pick happens in the browser
// after hydration, so the page's HTML stays the same for everyone (cacheable,
// no hydration mismatch). Not for sale here: captions link to the product pages.
export default function OutInTheWild({ photos = wildPhotos }: { photos?: WildPhoto[] }) {
  const section = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [shown, setShown] = useState<WildPhoto[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

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

  useEffect(() => {
    setShown(pickRandom(photos, GRID));
  }, [photos]);

  if (photos.length === 0) return null;

  return (
    <section ref={section} className={styles.wild} aria-labelledby="out-in-the-wild">
      <h2 id="out-in-the-wild" className={styles.title}>
        Out in the wild
      </h2>
      <p className={styles.sub}>Real people, real shirts.</p>
      <ul className={styles.grid}>
        {Array.from({ length: Math.min(GRID, photos.length) }, (_, i) => {
          const p = near && shown ? shown[i] : undefined;
          return (
            <li key={p?.n ?? `slot-${i}`} className={styles.cell}>
              {p ? (
                <button
                  type="button"
                  className={styles.tile}
                  onClick={() => setOpen(photos.indexOf(p))}
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
      <button type="button" className={styles.seeAll} onClick={() => setOpen(0)}>
        See all {photos.length} photos
      </button>
      {open !== null && <WildLightbox photos={photos} start={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
