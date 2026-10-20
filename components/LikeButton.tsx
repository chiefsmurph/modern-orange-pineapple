"use client";

// "♡ I'd wear this" under a product's price (lib/likes.ts, John 2026-10-20): anyone
// can like the design they're looking at without buying. A like is per design
// (the visual picks: sky, colour, style, print), so each sky gets its own heart.
// The browser remembers its own likes (localStorage "mop-likes") and its random
// id ("mop-device"); the count shows only once at least 10 people like the product.
// Every failure (storage blocked, offline) leaves the page working.
import { useEffect, useState } from "react";
import { track } from "@/lib/umami";
import styles from "./LikeButton.module.css";

const LIKES_KEY = "mop-likes";
const DEVICE_KEY = "mop-device";

const designOf = (opts: Record<string, string | undefined>) =>
  Object.keys(opts)
    .filter((k) => k !== "size" && opts[k])
    .sort()
    .map((k) => `${k}=${opts[k]}`)
    .join("&");

function readLikes(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(LIKES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeLikes(list: string[]) {
  try {
    window.localStorage.setItem(LIKES_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    // private mode: the like still counts, the heart just won't stay filled next visit
  }
}

function deviceId(): string {
  try {
    const known = window.localStorage.getItem(DEVICE_KEY);
    if (known && /^[a-f0-9]{32}$/.test(known)) return known;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    window.localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "";
  }
}

const fromSession = (key: string) => {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

/** John's own browsers opted out of stats (?nostats) don't count toward the totals. */
const isSelf = () => {
  try {
    return window.localStorage.getItem("umami.disabled") === "1";
  } catch {
    return false;
  }
};

export default function LikeButton({
  slug,
  opts,
  className = "",
}: {
  slug: string;
  /** The current picks; size is ignored. */
  opts: Record<string, string | undefined>;
  className?: string;
}) {
  const design = designOf(opts);
  const key = `${slug}|${design}`;
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => setLiked(readLikes().includes(key)), [key]);
  useEffect(() => {
    let live = true;
    fetch(`/api/likes?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && typeof j?.count === "number" && setCount(j.count))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slug]);

  const toggle = () => {
    const on = !liked;
    setLiked(on);
    const list = readLikes().filter((x) => x !== key);
    writeLikes(on ? [...list, key] : list);
    const visual = Object.fromEntries(Object.entries(opts).filter(([k, v]) => k !== "size" && v));
    track(on ? "like" : "unlike", { slug, ...visual });
    const device = deviceId();
    if (!device) return;
    fetch("/api/likes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, opts: visual, on, device, src: fromSession("mop-src"), self: isSelf() }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCount(typeof j?.count === "number" ? j.count : null))
      .catch(() => undefined);
  };

  return (
    <p className={`${styles.row} ${className}`}>
      <button
        type="button"
        className={`${styles.like} ${liked ? styles.on : ""}`}
        aria-pressed={liked}
        onClick={toggle}
      >
        <span className={styles.heart} aria-hidden="true">
          {liked ? "♥" : "♡"}
        </span>
        {liked ? "Liked" : "I'd wear this"}
      </button>
      {count !== null && <span className={styles.count}>{count} people would</span>}
    </p>
  );
}
