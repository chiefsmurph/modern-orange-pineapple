"use client";
import type { WildPhoto } from "@/lib/wild.generated";
import { STRIP_COUNT } from "@/lib/wild";
import styles from "./WildStrip.module.css";

/** The tile's width on computers (WildStrip.module.css): 180 px from 1200 px wide, at most 150 px below. */
const STRIP_DESKTOP_SIZES = "(min-width: 1200px) 180px, 150px";

// A row of "Out in the wild" photos near the top of the home page. Its height
// is fixed (placeholders until the visit's shuffle after hydration), so nothing
// moves. Phones show the 240 px thumbnails (100 px tiles); computers, where the
// tiles are bigger (150–180 px), the same square crop at 500 px, so they stay
// sharp on a retina screen. They load at low priority so they never hold up the
// products. The label jumps to the full section below; a photo opens the
// lightbox at that photo.
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
                  <picture>
                    {/* computers only (WildStrip.module.css): phones keep the 240 px file */}
                    <source media="(min-width: 769px)" srcSet={`${p.small} 240w, ${p.square} 500w`} sizes={STRIP_DESKTOP_SIZES} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.small} alt={p.alt} width={240} height={240} loading="eager" decoding="async" fetchPriority="low" />
                  </picture>
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
