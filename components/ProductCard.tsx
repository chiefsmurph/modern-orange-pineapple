"use client";
import Image from "next/image";
import Link from "next/link";
import styles from "./ProductCard.module.css";
import {
  getTotalPrice,
  getProductImages,
  getDelivery,
  Product,
} from "@/public/products";

type Props = {
  product: Product;
};

export default function ProductCard({ product }: Props) {
  const { id, title, freeShippingMode, fabricNote } = product;
  const displayPrice = getTotalPrice(product);
  const img = getProductImages(product)[0];
  return (
    <Link href={`/${id}`} className={styles.card}>
      {/* next/image: served as AVIF/WebP at the card's real width (was a raw 0.5–1.9 MB PNG) */}
      <Image
        src={img}
        alt={title}
        className={styles.image}
        width={900}
        height={900}
        sizes="(max-width: 820px) calc(100vw - 120px), (max-width: 1200px) calc(50vw - 84px), 460px"
      />
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.price}>${displayPrice}</p>
      {freeShippingMode && <p className={styles.freeShipping}>FREE SHIPPING</p>}
      <p className={styles.delivery}>{getDelivery(product).text}</p>
      {fabricNote && <p className={styles.fabricNote}>{fabricNote}</p>}
    </Link>
  );
}
