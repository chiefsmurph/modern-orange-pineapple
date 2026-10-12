"use client";
import Image from "next/image";
import { useState } from "react";
import styles from "./CatalogGallery.module.css";

// Photos for the Printful line-up: Printful's square mockups (on-model, flat),
// one big photo plus thumbnails. Remount it (key) when the photo set changes.
export default function CatalogGallery({
  images,
  alt,
}: {
  images: string[];
  alt: string;
}) {
  const [index, setIndex] = useState(0);
  const current = images[Math.min(index, images.length - 1)];
  if (!current) return null;

  return (
    <div className={styles.gallery}>
      <Image
        className={styles.main}
        src={current}
        alt={alt}
        width={1000}
        height={1000}
        priority
        sizes="(max-width: 767px) calc(100vw - 48px), 300px"
      />
      {images.length > 1 && (
        <div className={styles.thumbs}>
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              className={`${styles.thumb} ${i === index ? styles.active : ""}`}
              onClick={() => setIndex(i)}
              aria-label={`Photo ${i + 1} of ${images.length}`}
              aria-pressed={i === index}
            >
              <Image src={src} alt="" width={120} height={120} sizes="64px" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
