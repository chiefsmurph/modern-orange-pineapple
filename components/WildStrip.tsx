"use client";
import type { WildPhoto } from "@/lib/wild.generated";
import { STRIP_COUNT } from "@/lib/wild";
import styles from "./WildStrip.module.css";

// A small row of "Out in the wild" photos near the top of the home page. Its
// height is fixed (placeholders until the visit's shuffle after hydration), so
// nothing moves; the thumbnails are 240 px and load at low priority so they
// never hold up the products. The label jumps to the full section below; a
// photo opens the lightbox at that photo.
export default function WildStrip({
  photos,
  onOpen,
}: {
  /** The 5 to show, or null before the visit's shuffle. */
  photos: WildPhoto[] | null;
  onOpen: (photo: WildPhoto) => void;
}) {
  return (
    <div className={styles.strip}>
      <a href="#out-in-the-wild" className={styles.label}>
        Out in the wild ↓
      </a>
      <ul className={styles.row}>
        {Array.from({ length: STRIP_COUNT }, (_, i) => {
          const p = photos?.[i];
          return (
            <li key={p?.n ?? `slot-${i}`} className={styles.cell}>
              {p ? (
                <button type="button" className={styles.tile} onClick={() => onOpen(p)} aria-label={`${p.alt}: open the photo`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.small} alt={p.alt} width={240} height={240} loading="eager" decoding="async" fetchPriority="low" />
                </button>
              ) : (
                <span className={styles.tile} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
