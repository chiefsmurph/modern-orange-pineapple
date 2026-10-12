import Image from "next/image";
import {
  creditedArtists,
  getArtist,
  getDesign,
  initials,
  type DesignId,
} from "@/lib/artists";
import styles from "./ArtistCredit.module.css";

// A small side note under a design: round avatar(s) (photo, or initials),
// "<role> by <name> · ...", and the artists' links when they have any.
// Renders nothing for an unknown design or one without credits.
export default function ArtistCredit({
  design: designId,
  className,
}: {
  design: DesignId | undefined;
  className?: string;
}) {
  const design = getDesign(designId);
  if (!design || design.credits.length === 0) return null;

  const people = creditedArtists(design);
  const line = people.find((a) => a.line)?.line;
  const links = people.flatMap((a) =>
    (a.links ?? []).map((l) => ({ ...l, who: a.name }))
  );

  return (
    <aside
      className={[styles.credit, className].filter(Boolean).join(" ")}
      aria-label="Artist credit"
    >
      {people.length > 0 && (
        <div className={styles.avatars} aria-hidden="true">
          {people.map((a) =>
            a.photo ? (
              <Image
                key={a.name}
                className={styles.avatar}
                src={a.photo}
                alt=""
                width={80}
                height={80}
              />
            ) : (
              <span key={a.name} className={`${styles.avatar} ${styles.initials}`}>
                {initials(a.name)}
              </span>
            )
          )}
        </div>
      )}
      <div className={styles.body}>
        <p className={styles.text}>
          {design.credits.map(({ artist, role }, i) => (
            <span key={`${artist}-${role}`}>
              {i > 0 && <span className={styles.sep}> · </span>}
              {role} by <b className={styles.name}>{getArtist(artist).name}</b>
            </span>
          ))}
        </p>
        {line && <p className={styles.line}>{line}</p>}
        {links.length > 0 && (
          <p className={styles.links}>
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${l.who} on ${l.label}`}
              >
                {l.label}
              </a>
            ))}
          </p>
        )}
      </div>
    </aside>
  );
}
