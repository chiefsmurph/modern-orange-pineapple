"use client";
import Link from "next/link";
import { homeCards } from "@/lib/shop-cards";
import { BENEFITS, BENEFIT_HIGHLIGHT, HERO_LINE } from "@/lib/home-copy";
import { FOUNDING50, founding50Parts, type Founding50Line } from "@/lib/founding50";
import { ROYALTY } from "@/lib/ideas";

import styles from "./HomeGrid.module.css";
import ProductCard from "@/components/ProductCard";
import OutInTheWild from "@/components/OutInTheWild";
import WildStrip from "@/components/WildStrip";
import DropsSignup from "@/components/DropsSignup";
import { track } from "@/lib/umami";
import WildLightbox from "@/components/WildLightbox";
import MopCrew from "@/components/MopCrew";
import { wildPhotos, type WildPhoto } from "@/lib/wild.generated";
import { mixWild } from "@/lib/wild";
import InViewVideo from "@/components/InViewVideo";
import { Fragment, useEffect, useState } from "react";
import { takeHomeRestore } from "@/lib/home-scroll";

// Products first: a compact hero (the logo, one line under it, the slogan and
// the benefits row), the "Out in the wild" strip, then the grid, then the links
// and the brand story. Everything is server-rendered visible — no
// scroll lock, no typewriter, no staggered reveal; the only motion is a short
// CSS fade (off under prefers-reduced-motion, see HomeGrid.module.css).
// `founding50`: the launch-code line under the benefits (app/page.tsx reads it from
// Stripe on the server); null hides it.
export default function HomePage({ founding50 }: { founding50: Founding50Line | null }) {
  const [isCouponHovered, setIsCouponHovered] = useState(false);
  const [isHoveredBtn2, setIsHoveredBtn2] = useState(false);

  // "Out in the wild": one mix per visit, after hydration (the HTML stays the
  // same for everyone, so the page can stay static and cached; the strip and
  // grid hold their size with placeholders until then, so nothing moves): the
  // strip at the top shows 5 different people, the grid at the bottom 9 other
  // photos with nobody twice side by side (lib/wild.ts mixWild). One lightbox
  // for both, over all the photos.
  const [wild, setWild] = useState<{ strip: WildPhoto[]; grid: WildPhoto[] } | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  useEffect(() => {
    setWild(mixWild(wildPhotos));
  }, []);
  const openWild = (p: WildPhoto | null, from: "strip" | "grid" | "see-all") => {
    setLightbox(p ? Math.max(0, wildPhotos.indexOf(p)) : 0);
    track("gallery-open", { from, photo: p?.n });
  };

  // Back from a product page via "← Home": return to the same place in the grid
  // (lib/home-scroll.ts). Applied now and again once late layout has settled,
  // so it holds whatever the router or the browser does with scroll on its own.
  useEffect(() => {
    let y: number | null = null;
    try {
      y = takeHomeRestore(window.sessionStorage);
    } catch {}
    if (y == null) return;
    const go = () => window.scrollTo(0, y!);
    go();
    const raf = requestAnimationFrame(go);
    const timers = [60, 250].map((ms) => setTimeout(go, ms));
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <main className={styles.main}>
      <header className={`${styles.header} ${styles.fadeIn}`}>
        {/* The logo (John 10/17), as in the emails: the bunny beside the wordmark on a
            white card with an orange stripe. The wordmark is live Orbitron text (crisp
            at any size). The image's alt names the brand, so the same words beside it
            are hidden from screen readers: the heading reads "MOP Clothing Modern
            Orange Pineapple" once. Two sizes of the bunny cover 1x to 3x screens. */}
        <h1 className={styles.logo}>
          <img
            className={styles.bunny}
            src="/images/brand/mop-bunny-120.webp"
            srcSet="/images/brand/mop-bunny-120.webp 120w, /images/brand/mop-bunny-240.webp 240w"
            sizes="(max-width: 768px) 43px, 74px"
            width={120}
            height={216}
            alt="MOP Clothing"
          />
          <span className={styles.wordmark}>
            <span className={styles.name} aria-hidden="true">MOP Clothing</span>
            <span className={styles.subtitle}>Modern Orange Pineapple</span>
          </span>
        </h1>
        <p className={styles.heroLine}>{HERO_LINE}</p>
        <p className={styles.tagline}>
          Escape the Ordinary — Own a Collectible Piece of Paradise.
        </p>
        {/* one row; on a very narrow phone it breaks between items, never inside one */}
        <p className={styles.benefits}>
          {BENEFITS.map((b, i) => (
            <Fragment key={b}>
              {i > 0 && (
                <>
                  {" "}
                  <span aria-hidden="true">·</span>{" "}
                </>
              )}
              <span className={b === BENEFIT_HIGHLIGHT ? `${styles.benefit} ${styles.benefitHot}` : styles.benefit}>{b}</span>
            </Fragment>
          ))}
        </p>
        {/* Founding 50 (John 10/20): the launch code, how many are left (lib/founding50.ts). The code
            sits on the orange pill; the line breaks only between its parts. No "was $X" pricing. */}
        {founding50 && (
          <p className={styles.founding}>
            {founding50Parts(founding50).map((t, i) => (
              <Fragment key={t}>
                {i > 0 && (
                  <>
                    {" "}
                    <span aria-hidden="true">·</span>{" "}
                  </>
                )}
                {t === `code ${FOUNDING50.code}` ? (
                  <span className={styles.benefit}>
                    code <span className={styles.benefitHot}>{FOUNDING50.code}</span>
                  </span>
                ) : (
                  <span className={styles.benefit}>{t}</span>
                )}
              </Fragment>
            ))}
          </p>
        )}
      </header>

      {wildPhotos.length > 0 && <WildStrip photos={wild?.strip ?? null} onOpen={(p) => openWild(p, "strip")} />}
      {/* The featured cards first (lib/catalog/copy.ts `featured`: the Sky Tee, Day, the shorts, ...), then the rest. */}
      <section
        className={`${styles.grid} ${styles.fadeIn}`}
        aria-label="Products"
      >
        {homeCards().map((card, index) => (
          <div key={card.href} className={styles.cell}>
            <ProductCard card={card} priority={index === 0} position={index + 1} />
          </div>
        ))}
        <div className={`${styles.cell} ${styles.wide}`}>
          <div className="product-card featured-store">
            <a
              href="https://www.google.com/maps?q=Under the Sea Gallery, 833 b, 725 Embarcadero, Morro Bay, CA 93442"
              target="_blank"
              rel="noopener noreferrer"
              className="store-maps-link"
              aria-label="Directions to Under The Sea Gallery, Morro Bay"
            >
              <InViewVideo
                src="/videos/underthesea-web.mp4"
                poster="/images/underthesea-poster.webp"
                width={540}
                height={960}
                style={{
                  width: "100%",
                  maxWidth: "400px",
                  borderRadius: "12px",
                  margin: "auto",
                  display: "block",
                }}
              />
            </a>
            <p className="store-caption">
              <b>
                Premium Pelican In Clouds
                <br />
                Morro Bay Edition
              </b>
              <br />
              <br />
              Now available at{" "}
              <strong>Harborwalk Convenience / Under The Sea Gallery</strong>
              <br />
              in Morro Bay, California – tap for directions&nbsp;
              <a
                href="https://undertheseagallery.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="store-site-link"
              >
                or here specifically to go to their website
              </a>
            </p>
          </div>
        </div>
      </section>

      <OutInTheWild
        photos={wild?.grid ?? null}
        total={wildPhotos.length}
        onOpen={(p) => openWild(p, p ? "grid" : "see-all")}
      />
      {lightbox !== null && (
        <WildLightbox photos={wildPhotos} start={lightbox} onClose={() => setLightbox(null)} />
      )}
      <MopCrew />

      <DropsSignup source="home" />

      <Link href="/custom" className={styles.customCard}>
        <span>Want your own design, or shirts for your team?</span>
        <b>Custom orders →</b>
      </Link>

      <Link href="/ideas" className={styles.customCard}>
        <span>Got a shirt idea? If we make it, you get {ROYALTY} for every one sold.</span>
        <b>Submit an idea →</b>
      </Link>

      <nav className={`button-container ${styles.links}`} aria-label="More">
        <Link
          href="/redeem"
          style={{
            display: "inline-block",
            padding: "0.75rem 1.5rem",
            border: "2px solid #ff8c00",
            borderRadius: "8px",
            fontFamily: "var(--font-orbitron), sans-serif",
            color: isCouponHovered ? "white" : "#fff", // white text always visible
            backgroundColor: isCouponHovered
              ? "#ff8c00"
              : "linear-gradient(to bottom, #ff8c00aa, #ff8c0055)", // soft warm gradient
            textDecoration: "none",
            fontWeight: "bold",
            boxShadow: isCouponHovered ? "0 8px 16px rgba(0,0,0,0.2)" : "none",
            transform: isCouponHovered ? "scale(1.05)" : "scale(1)",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={() => setIsCouponHovered(true)}
          onMouseLeave={() => setIsCouponHovered(false)}
        >
          Got an old MOP card? Claim it
        </Link>
        <a
          href="https://www.instagram.com/modernorangepineapple"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            padding: "0.75rem 1.5rem",
            border: "2px solid #E1306C",
            borderRadius: "8px",
            fontFamily: "var(--font-orbitron), sans-serif",
            color: isHoveredBtn2 ? "white" : "#E1306C",
            backgroundColor: isHoveredBtn2
              ? "#E1306C"
              : "rgba(225, 48, 108, 0.1)", // base color subtle
            textDecoration: "none",
            fontWeight: "bold",
            boxShadow: isHoveredBtn2
              ? "0 8px 16px rgba(0, 0, 0, 0.2)"
              : "none",
            transform: isHoveredBtn2 ? "scale(1.05)" : "scale(1)",
            transition: "all 0.3s ease",
            textShadow: isHoveredBtn2 ? "0 0 8px #fff" : "none",
          }}
          onMouseEnter={() => setIsHoveredBtn2(true)}
          onMouseLeave={() => setIsHoveredBtn2(false)}
        >
          Follow us on Instagram
        </a>
      </nav>

      <section className={styles.story} aria-labelledby="our-story">
        <h2 id="our-story" className={styles.storyHeading}>
          Our story
        </h2>
        <p>
          Modern Orange Pineapple is an apparel brand born from a love of art —
          and a frustration with how hard it is to find clothing that’s both
          interesting and made from natural materials. We highlight when items
          aren't 100% cotton or organic, because we think that should be clear.
        </p>
        <p>
          It started with a painted star. Then came a smoking alpaca. Then a
          pelican — who later (sometimes) wears a beanie. Each piece is a
          creative swing at making fashion feel artistic, cool, and quietly bold
          — without being childish or overdone.
        </p>
        <p>
          Who knows what’s next? One thing’s for sure: it’s going to put a smile
          on your face — and very possibly have strangers stopping to say “I
          love your shirt” or giving you a thumbs up as they pass.
        </p>
        <p>
          <Link href="/about" className={styles.storyMore}>
            More about MOP →
          </Link>
        </p>
      </section>
    </main>
  );
}
