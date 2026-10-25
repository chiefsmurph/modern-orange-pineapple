import type { Metadata } from "next";
import Link from "next/link";
import { shareMeta } from "@/lib/share-meta";
import { creditText, designs } from "@/lib/artists";
import { ROYALTY } from "@/lib/ideas";
import { aboutJsonLd, INSTAGRAM_URL } from "@/lib/structured-data";
import HomeLink from "@/components/HomeLink";
import JsonLd from "@/components/JsonLd";
import styles from "../[productId]/ProductClientView.module.css";
import own from "../shipping-returns/shipping.module.css";

// /about: the plain facts about MOP, written so a search engine or an AI answer
// can repeat them (Google 10/25 had MOP "born out of Chico"). Only facts the site
// already states; the same ones are in lib/structured-data.ts.
const DESCRIPTION =
  "Modern Orange Pineapple (MOP) is a small, art-led apparel brand from Morro Bay, California: characters and skies on clothes, made to order.";

export const metadata: Metadata = {
  title: "About | Modern Orange Pineapple",
  description: DESCRIPTION,
  ...shareMeta({ title: "About · Modern Orange Pineapple", description: DESCRIPTION, path: "/about" }),
};

export default function AboutPage() {
  return (
    <div className={`${styles.container} ${own.page}`}>
      <JsonLd data={aboutJsonLd(DESCRIPTION)} />
      <HomeLink className={styles.home} />
      <h1 className={own.title}>About Modern Orange Pineapple</h1>
      <p>
        Modern Orange Pineapple, or MOP for short, is a small apparel brand from Morro Bay, California. We put
        characters and skies on clothes, and every piece is made to order.
      </p>

      <h2 className={own.h2}>How it started</h2>
      <p>
        It started with a painted star. Then came a smoking alpaca. Then a pelican, who later (sometimes) wears a
        beanie. A rabbit in a monocle and bow tie became the logo.
      </p>

      <h2 className={own.h2}>Who makes the art</h2>
      <p>
        MOP designs every piece. Some of the art is our own, and some starts with artists we work with, credited on
        the product pages:
      </p>
      <ul>
        <li>The star: {creditText(designs["original-star"])}</li>
        <li>The smoking alpaca: {creditText(designs["smoking-alpaca"])}</li>
        <li>The pelican&apos;s beanie: {creditText(designs["pelican-beanie"])}</li>
      </ul>

      <h2 className={own.h2}>What we make</h2>
      <p>
        Tees, crop tops, polos, all-over prints, shorts, a skater dress and a snapback. The tees, crop tops and polos
        are 100% cotton, and the all-overs and shorts are cotton with a little stretch. The dress and the snapback
        aren&apos;t cotton, and their product pages say so up front.
      </p>

      <h2 className={own.h2}>How it&apos;s made</h2>
      <p>
        Every piece is printed or embroidered by our print partners after you order, so nothing sits in a warehouse.
        Shipping is free, and for now we ship to the US only. See <Link href="/shipping-returns">shipping &amp;
        returns</Link> for delivery times and replacements.
      </p>

      <h2 className={own.h2}>Join in</h2>
      <ul>
        <li>
          Got a shirt idea? <Link href="/ideas">Send it</Link>. If we make it, you get {ROYALTY} for every one sold.
        </li>
        <li>
          Want your own design, or shirts for your team? <Link href="/custom">Custom orders</Link>.
        </li>
        <li>
          Got an old MOP card? <Link href="/redeem">Claim it</Link>.
        </li>
        <li>
          Follow MOP on{" "}
          <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
            Instagram
          </a>
          .
        </li>
      </ul>
    </div>
  );
}
