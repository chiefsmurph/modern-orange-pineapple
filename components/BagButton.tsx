"use client";
// The bag button (top right on every page): a link to /bag with the item count.
import Link from "next/link";
import { bagCount, useBag } from "@/lib/bag";
import styles from "./Bag.module.css";

export function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 7h12l1 13H5L6 7z" />
      <path d="M9 7V6a3 3 0 0 1 6 0v1" />
    </svg>
  );
}

export default function BagButton() {
  const { lines } = useBag();
  const n = bagCount(lines);
  return (
    <Link href="/bag" className={styles.bagButton} aria-label={n ? `Bag, ${n} item${n === 1 ? "" : "s"}` : "Bag, empty"}>
      <BagIcon />
      {n > 0 && <span className={styles.count}>{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}
