"use client";
import Image from "next/image";
import Link from "next/link";
import styles from "./ProductCard.module.css";
import type { ShopCard } from "@/lib/shop-cards";
import { rememberHomeCard } from "@/lib/home-scroll";

type Props = {
  card: ShopCard;
  /** above the fold (the home page's first card): load eagerly, preloaded */
  priority?: boolean;
};

export default function ProductCard({ card, priority = false }: Props) {
  const { href, title, image, price, freeShipping, delivery, fabricNote } = card;
  return (
    <Link
      href={href}
      className={styles.card}
      // so "← Home" on the product page can bring the visitor back to this spot
      onClick={() => rememberHomeCard(href, window.scrollY)}
    >
      {/* next/image: served as AVIF/WebP at the card's real width (was a raw 0.5–1.9 MB PNG) */}
      <Image
        src={image}
        alt={title}
        className={styles.image}
        width={900}
        height={900}
        priority={priority}
        sizes="(max-width: 768px) calc(100vw - 56px), (max-width: 1200px) calc(50vw - 84px), 460px"
      />
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.price}>{price}</p>
      {freeShipping && <p className={styles.freeShipping}>FREE SHIPPING</p>}
      <p className={styles.delivery}>{delivery}</p>
      {fabricNote && <p className={styles.fabricNote}>{fabricNote}</p>}
    </Link>
  );
}
