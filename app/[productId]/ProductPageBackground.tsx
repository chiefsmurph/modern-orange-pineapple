import Image from "next/image";
import { useEffect, useState } from "react";
import styles from "./ProductClientView.module.css";
export default function ProductPageBackground({
  side,
  src,
}: {
  side: "left" | "right";
  src: string;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setLoaded(true), 50); // delay to trigger transition
    return () => clearTimeout(timeout);
  }, []);

  // Products with a single photo have no second ghost.
  if (!src) return null;

  // Decorative, desktop-only (display:none under 768px). Lazy, so phones never
  // download it; served at half the viewport width instead of the full PNG.
  return (
    <Image
      alt=""
      aria-hidden="true"
      width={900}
      height={900}
      sizes="50vw"
      className={
        styles["product-page-background"] +
        " " +
        styles["background-ghost"] +
        " " +
        (loaded ? styles["loaded"] : "") +
        " " +
        styles["bg-" + side]
      }
      src={src}
    />
  );
}
