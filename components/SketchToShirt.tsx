import Image from "next/image";
import { Fragment } from "react";
import styles from "./SketchToShirt.module.css";

export type SketchStep = {
  src: string;
  width: number;
  height: number;
  alt: string;
  /** Short label under the image, e.g. "The original drawing". */
  caption: string;
};

// The original artwork → the finished piece, side by side with an arrow.
export default function SketchToShirt({
  steps,
  title = "From the page to the shirt",
}: {
  steps: SketchStep[];
  title?: string;
}) {
  if (steps.length === 0) return null;
  return (
    <section className={styles.strip} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.row}>
        {steps.map((s, i) => (
          <Fragment key={s.src}>
            {i > 0 && (
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            )}
            <figure className={styles.step}>
              <div className={styles.frame}>
                <Image
                  src={s.src}
                  alt={s.alt}
                  width={s.width}
                  height={s.height}
                  sizes="(max-width: 600px) 45vw, 260px"
                />
              </div>
              <figcaption className={styles.caption}>{s.caption}</figcaption>
            </figure>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
