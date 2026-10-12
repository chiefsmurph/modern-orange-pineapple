import Link from "next/link";
import HomeLink from "@/components/HomeLink";
import type { Product } from "@/public/products";
import styles from "./ProductClientView.module.css";
import own from "./ComingSoonView.module.css";

// A product that's temporarily off sale (`comingSoon` in public/products.ts):
// the product page's frame, a short note and the way back to the shop. No
// price, no photos (they show the design that's being replaced), no buy button.
export default function ComingSoonView({ product }: { product: Product }) {
  return (
    <div className={styles.container}>
      <HomeLink className={styles.home} />
      <h1 className={styles.title}>{product.title}</h1>
      <p className={own.note}>{product.comingSoon?.message}.</p>
      <p className={own.more}>
        It&apos;s off the shelf while we finish the new design.
      </p>
      <Link href="/" className={own.shop}>
        See what&apos;s in the shop
      </Link>
    </div>
  );
}
