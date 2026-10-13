"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CrewPhoto } from "@/lib/reviews";
import { pickRandom } from "@/lib/wild";
import { track } from "@/lib/umami";
import WildLightbox, { type LightboxPhoto } from "./WildLightbox";
import wild from "./OutInTheWild.module.css";
import styles from "./MopCrew.module.css";

const SHOW = 9;
const MIN = 3;

// "The MOP Crew": owners' own photos, approved by John and OK'd for featuring
// by the owner (lib/reviews.ts). Fetched from /api/crew when the section comes
// near the screen (so approving one needs no rebuild), shuffled per visit, and
// shown only once there are at least 3.
export default function MopCrew() {
  const anchor = useRef<HTMLDivElement>(null);
  const [photos, setPhotos] = useState<CrewPhoto[] | null>(null);
  const [shown, setShown] = useState<CrewPhoto[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const load = () =>
      fetch("/api/crew")
        .then((r) => r.json())
        .then((j) => {
          const all: CrewPhoto[] = Array.isArray(j.photos) ? j.photos : [];
          setPhotos(all);
          setShown(pickRandom(all, SHOW));
        })
        .catch(() => setPhotos([]));
    if (!("IntersectionObserver" in window)) {
      void load();
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          io.disconnect();
          void load();
        }
      },
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!photos || photos.length < MIN) return <div ref={anchor} aria-hidden="true" />;

  const lightbox: LightboxPhoto[] = photos.map((p) => ({
    n: p.id,
    design: p.product,
    href: `/${p.slug}`,
    alt: `${p.product}, worn by its owner`,
    src: p.src,
    width: p.width,
    height: p.height,
    credit: `${p.first_name} · Verified owner`,
  }));
  const openAt = (p: CrewPhoto | null) => {
    setOpen(p ? Math.max(0, photos.indexOf(p)) : 0);
    track("gallery-open", { from: "crew", photo: p?.id });
  };

  return (
    <section className={wild.wild} aria-labelledby="mop-crew">
      <h2 id="mop-crew" className={wild.title}>
        The MOP Crew
      </h2>
      <p className={wild.sub}>Our owners, in their MOP.</p>
      <ul className={wild.grid}>
        {shown.map((p) => (
          <li key={p.id} className={wild.cell}>
            <button type="button" className={`${wild.tile} ${styles.tile}`} onClick={() => openAt(p)} aria-label={`${p.product}, worn by ${p.first_name}: open the photo`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.square} alt={`${p.product}, worn by its owner`} width={500} height={500} loading="lazy" decoding="async" />
              <span className={styles.badge}>✓ Verified owner</span>
            </button>
            <p className={styles.caption}>
              <b>{p.first_name}</b> ·{" "}
              <Link href={`/${p.slug}`} className={styles.link}>
                {p.product}
              </Link>
            </p>
          </li>
        ))}
      </ul>
      <button type="button" className={wild.seeAll} onClick={() => openAt(null)}>
        See all {photos.length} photos
      </button>
      {open !== null && <WildLightbox photos={lightbox} start={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
