import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import ArtistCredit from "@/components/ArtistCredit";
import SketchToShirt from "@/components/SketchToShirt";
import { creditText, getDesign } from "@/lib/artists";
import { getPreview, previews } from "@/lib/previews";
import styles from "./preview.module.css";

// Private, link-only pages, built at deploy time. Any other slug renders
// notFound() below (a 404). Not `dynamicParams = false`: in Next 15.5 that
// logs "Error: Internal: NoFallbackError" for every unknown slug.

export function generateStaticParams() {
  return previews.map(({ slug }) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = getPreview(slug);
  if (!p) return { robots: { index: false, follow: false } };
  const design = getDesign(p.design);
  const cover = p.gallery[0] ?? p.options?.[0]?.images[0] ?? p.sketch?.[p.sketch.length - 1];
  const title = `${p.headline} | MOP Clothing`;
  return {
    title,
    description: p.line,
    // never indexed; also sent as an X-Robots-Tag header (next.config.ts)
    robots: { index: false, follow: false },
    metadataBase: new URL("https://mopclothing.com"),
    // so the link unfurls with a picture when it's sent in a message
    openGraph: {
      title,
      description: design ? creditText(design) : p.line,
      url: `/preview/${p.slug}`,
      images: cover
        ? [{ url: cover.src, width: cover.width, height: cover.height }]
        : undefined,
    },
  };
}

export default async function PreviewPage({ params }: Props) {
  const { slug } = await params;
  const p = getPreview(slug);
  if (!p) notFound();

  return (
    <main className={styles.page}>
      <Link href="/" className={styles.brand}>
        MOP Clothing
        <i className={styles.brandSub}>mopclothing.com</i>
      </Link>

      <header className={styles.hero}>
        <h1 className={styles.headline}>{p.headline}</h1>
        <p className={styles.line}>{p.line}</p>
        <ArtistCredit design={p.design} className={styles.credit} />
      </header>

      {p.sketch && <SketchToShirt steps={p.sketch} />}

      {p.gallery.length > 0 && (
        <section className={styles.gallery} aria-label="Mockups">
          {p.gallery.map((g, i) => (
            <figure
              key={g.src}
              className={`${styles.item} ${g.wide ? styles.wide : ""}`}
            >
              <div className={styles.tile}>
                <Image
                  src={g.src}
                  alt={g.alt}
                  width={g.width}
                  height={g.height}
                  sizes={
                    g.wide
                      ? "(max-width: 600px) calc(100vw - 32px), 840px"
                      : "(max-width: 600px) calc(100vw - 32px), 420px"
                  }
                  priority={i === 0 && !p.sketch}
                />
              </div>
              <figcaption className={styles.caption}>{g.caption}</figcaption>
            </figure>
          ))}
        </section>
      )}

      {p.options?.map((o, oi) => (
        <section key={o.name} className={styles.option} aria-label={o.name}>
          {o.tier && <p className={styles.tier}>{o.tier}</p>}
          <h2 className={styles.optionName}>{o.name}</h2>
          <div className={styles.swipe}>
            {o.images.map((g, i) => (
              <figure key={g.src} className={styles.slide}>
                <div className={styles.tile}>
                  <Image
                    src={g.src}
                    alt={g.alt}
                    width={g.width}
                    height={g.height}
                    sizes="(max-width: 600px) 86vw, 520px"
                    priority={oi === 0 && i === 0}
                  />
                </div>
                <figcaption className={styles.caption}>{g.caption}</figcaption>
              </figure>
            ))}
          </div>
          {o.images.length > 1 && <p className={styles.hint}>swipe for more →</p>}
          <p className={styles.line}>{o.line}</p>
          <p className={styles.price}>
            Wholesale <b>{o.wholesale}</b> each · suggested retail <b>{o.retail}</b>
          </p>
        </section>
      ))}

      {p.terms && <p className={styles.line}>{p.terms}</p>}

      <p className={styles.foot}>Private preview · mockups, not final products</p>
    </main>
  );
}
