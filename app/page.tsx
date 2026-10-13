"use client";
import Link from "next/link";
import { shopCards } from "@/lib/shop-cards";
import { groupSections } from "@/lib/catalog/copy";

import styles from "./HomeGrid.module.css";
import "./styles.css";
import ProductCard from "@/components/ProductCard";
import OutInTheWild from "@/components/OutInTheWild";
import WildStrip from "@/components/WildStrip";
import DropsSignup from "@/components/DropsSignup";
import { track } from "@/lib/umami";
import WildLightbox from "@/components/WildLightbox";
import { wildPhotos, type WildPhoto } from "@/lib/wild.generated";
import { pickRandom, splitWild } from "@/lib/wild";
import InViewVideo from "@/components/InViewVideo";
import { useEffect, useRef, useState } from "react";
import { takeHomeRestore } from "@/lib/home-scroll";

// Products first: a compact title + one tagline line, then the grid, then the
// links and the brand story. Everything is server-rendered visible — no
// scroll lock, no typewriter, no staggered reveal; the only motion is a short
// CSS fade (off under prefers-reduced-motion, see HomeGrid.module.css).
export default function HomePage() {
  const [isCouponHovered, setIsCouponHovered] = useState(false);
  const [isHoveredBtn2, setIsHoveredBtn2] = useState(false);
  const glowRef = useRef<HTMLHeadingElement>(null);

  // "Out in the wild": one shuffle per visit, after hydration (the HTML stays
  // the same for everyone), shared by the strip at the top (first 5) and the
  // grid at the bottom (next 9). One lightbox for both, over all the photos.
  const [wild, setWild] = useState<{ strip: WildPhoto[]; grid: WildPhoto[] } | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  useEffect(() => {
    setWild(splitWild(pickRandom(wildPhotos, wildPhotos.length)));
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

  // The title's glow animates text-shadow, which repaints every frame; pause it
  // while the title is scrolled out of view so it can't compete with scrolling.
  useEffect(() => {
    const el = glowRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) =>
      el.classList.toggle("glow-paused", !entry.isIntersecting)
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <main className={styles.main}>
      <header className={`${styles.header} ${styles.fadeIn}`}>
        <h1 ref={glowRef} className={`glitch ${styles.title}`}>
          mopclothing.com
          {/* a span, not <hr>: an <hr> can't sit inside an <h1> */}
          <span className={styles.rule} aria-hidden="true" />
          <i className={styles.subtitle}>Modern Orange Pineapple</i>
        </h1>
        <p className={styles.tagline}>
          Escape the Ordinary — Own a Collectible Piece of Paradise.
        </p>
      </header>

      <p className={`${styles.materialNote} ${styles.fadeIn}`}>
        Real cotton — even the all-overs.
      </p>
      {wildPhotos.length > 0 && <WildStrip photos={wild?.strip ?? null} onOpen={(p) => openWild(p, "strip")} />}
      {/* Catalog groups (e.g. Premium all-over) get their own section above the main grid. */}
      {Object.entries(groupSections).map(([group, { title, line }]) => {
        const cards = shopCards().filter((c) => c.group === group);
        if (cards.length === 0) return null;
        return (
          <section
            key={group}
            className={`${styles.group} ${styles.fadeIn}`}
            aria-labelledby={`group-${group}`}
          >
            <h2 id={`group-${group}`} className={styles.groupTitle}>
              {title}
            </h2>
            <p className={styles.groupLine}>{line}</p>
            <div className={styles.grid}>
              {cards.map((card, index) => (
                <div key={card.href} className={styles.cell}>
                  <ProductCard card={card} priority={index === 0} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <section
        className={`${styles.grid} ${styles.fadeIn}`}
        aria-label="Products"
      >
        {shopCards()
          .filter((c) => !c.group || !groupSections[c.group])
          .map((card, index) => (
            <div key={card.href} className={styles.cell}>
              <ProductCard
                card={card}
                priority={index === 0 && !shopCards().some((c) => c.group && groupSections[c.group])}
              />
            </div>
          ))}
        <div className={styles.cell}>
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

      <DropsSignup source="home" />

      <Link href="/custom" className={styles.customCard}>
        <span>Want your own design, or shirts for your team?</span>
        <b>Custom orders →</b>
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
            boxShadow: isCouponHovered ? "0 4px 12px rgba(0,0,0,0.25)" : "none",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={() => setIsCouponHovered(true)}
          onMouseLeave={() => setIsCouponHovered(false)}
        >
          Redeem a Coupon Code
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
              ? "0 4px 12px rgba(0, 0, 0, 0.25)"
              : "none",
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
      </section>
    </main>
  );
}
