// Where /meta-checkout sends a Meta Shops cart with nothing left to buy (every
// item retired, off sale or unknown), or when Checkout couldn't be started.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import HomeLink from "@/components/HomeLink";
import { shopCards } from "@/lib/shop-cards";
import styles from "../../[productId]/ProductClientView.module.css";
import own from "./unavailable.module.css";

export const metadata: Metadata = {
  title: "Checkout | Modern Orange Pineapple",
  robots: { index: false, follow: false },
};

export default async function MetaCheckoutUnavailable({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const error = sp.reason === "error";
  const wanted = new Set(String(sp.p ?? "").split(",").filter(Boolean));
  const cards = shopCards();
  // The products the cart named first (another color or size may still be on sale), then everything else.
  const sorted = [...cards.filter((c) => wanted.has(c.href.slice(1))), ...cards.filter((c) => !wanted.has(c.href.slice(1)))];

  return (
    <div className={`${styles.container} ${own.page}`}>
      <HomeLink className={styles.home} />
      <h1 className={own.title}>{error ? "Checkout didn't open" : "Some items are no longer available"}</h1>
      <p>
        {error
          ? "Something went wrong on our side starting checkout. Please try again in a minute, or pick your items here on the site."
          : "The items in your cart aren't on sale right now. Here's everything in the shop today:"}
      </p>
      <ul className={own.list}>
        {sorted.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className={own.item}>
              <Image src={c.image} alt="" width={64} height={64} sizes="64px" className={own.thumb} />
              <span className={own.name}>{c.title}</span>
              <span className={own.price}>{c.price}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p>
        <Link href="/">Shop everything →</Link>
      </p>
    </div>
  );
}
