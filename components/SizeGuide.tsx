"use client";
import { useEffect, useRef, useState } from "react";
import type { SizeGuide as Guide } from "@/lib/catalog/sizes.generated";
import styles from "./SizeGuide.module.css";

// "Size guide" under a product's size picker: a sheet with the garment's
// measurements (Printful's, laid flat, in inches), only the sizes this product
// sells, the picked size highlighted, and our one-line fit note.
export default function SizeGuide({
  guide,
  title,
  sizes,
  selected,
}: {
  guide: Guide;
  title: string;
  /** The sizes this product sells, in order. */
  sizes: string[];
  selected?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const shown = sizes.filter((s) => guide.rows.some((r) => r.values[s] !== undefined));

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const before = html.style.overflow;
    const opener = document.activeElement as HTMLElement | null;
    html.style.overflow = "hidden";
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = before;
      opener?.focus?.();
    };
  }, [open]);

  if (shown.length === 0) return null;
  return (
    <>
      <button type="button" className={styles.link} onClick={() => setOpen(true)}>
        Size guide
      </button>
      {open && (
        <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="size-guide-title">
            <div className={styles.head}>
              <h2 id="size-guide-title" className={styles.title}>
                Size guide · {title}
              </h2>
              <button ref={close} type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            {guide.fit && <p className={styles.fit}>{guide.fit}</p>}
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Size</th>
                    {guide.rows.map((r) => (
                      <th key={r.label} scope="col">
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s} className={s === selected ? styles.picked : undefined} aria-current={s === selected || undefined}>
                      <th scope="row">{s}</th>
                      {guide.rows.map((r) => (
                        <td key={r.label}>{r.values[s] ? `${r.values[s]}″` : "–"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              Inches, measured laid flat. Each piece is made to order and may vary by up to 1–2″. Tip: measure a shirt you
              love and compare.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
