"use client";
import Image from "next/image";
import styles from "./CatalogGallery.module.css";

// Photos for the Printful line-up: Printful's square mockups (on-model, model2,
// flat, ...), one big photo plus thumbnails. The page owns which photo is shown
// (index), so it survives picker changes: see keepPhotoPosition().
export default function CatalogGallery({
  images,
  alt,
  index,
  onIndexChange,
}: {
  images: string[];
  alt: string;
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const setIndex = onIndexChange;
  const current = images[index] ?? images[0];
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
