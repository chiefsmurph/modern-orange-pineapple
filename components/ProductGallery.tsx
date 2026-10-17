"use client";
import Image from "next/image";
import { useState } from "react";
import { createPortal } from "react-dom";
import styles from "./ProductGallery.module.css";
import { useKeenSlider } from "keen-slider/react";
import "keen-slider/keen-slider.min.css";
import WildLightbox from "./WildLightbox";

// Rendered on the server too (it used to return null until mounted, so the
// gallery popped in and shoved the page down). Each slide starts at the exact
// offset keen-slider gives it at rest — i × spacing, see --slide-gap in the CSS
// module — so nothing moves when the slider takes over.
//
// Clicking or tapping a photo opens it full screen (components/WildLightbox.tsx)
// at the original file; a drag only slides (keen-slider swallows that click).
export default function ProductGallery({ images }: { images: string[] }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const [sliderRef] = useKeenSlider<HTMLDivElement>({
    // whole-pixel transforms: smoother drags on phones
    renderMode: "performance",
    slides: {
      perView: 1.5,
      spacing: 16,
    },
    breakpoints: {
      "(min-width: 768px)": {
        slides: {
          perView: 2.5,
          spacing: 24,
        },
      },
    },
  });

  return (
    <div className={styles.sliderWrapper}>
      <div ref={sliderRef} className="keen-slider">
        {images.map((src, i) => (
          <div
            key={i}
            className="keen-slider__slide"
            style={{ transform: `translate3d(calc(${i} * var(--slide-gap)), 0, 0)` }}
          >
            <button
              type="button"
              className={styles.enlarge}
              onClick={() => setViewer(i)}
              aria-label={`Enlarge photo ${i + 1} of ${images.length}`}
            >
              <Image
                src={src}
                alt={`Product ${i + 1}`}
                width={900}
                height={900}
                // img is 170% of a 76.6%-wide slide (see the CSS module)
                sizes="(max-width: 767px) calc((100vw - 48px) * 1.3), 400px"
                priority={i === 0}
              />
            </button>
          </div>
        ))}
      </div>
      {viewer !== null &&
        createPortal(
          <WildLightbox
            photos={images.map((src, i) => ({ src, alt: `Product ${i + 1}` }))}
            start={viewer}
            onClose={() => setViewer(null)}
            label="Product photos"
            tile
            pinchZoom
          />,
          document.body
        )}
    </div>
  );
}
