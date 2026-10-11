"use client";
import { CSSProperties, useEffect, useRef } from "react";

// A muted, looping clip that downloads nothing until it scrolls into view
// (preload="none" + poster), plays while visible and pauses when it leaves.
// Data-saver users just get the poster.
export default function InViewVideo({
  src,
  poster,
  width,
  height,
  style,
}: {
  src: string;
  poster: string;
  width: number;
  height: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true; // React doesn't serialize `muted`; autoplay policies require it
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const play = () => video.play().catch(() => {});
    if (!("IntersectionObserver" in window)) {
      play();
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? play() : video.pause()),
      { rootMargin: "200px 0px" }
    );
    io.observe(video);
    return () => io.disconnect();
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      width={width}
      height={height}
      muted
      loop
      playsInline
      preload="none"
      style={{ aspectRatio: `${width} / ${height}`, height: "auto", ...style }}
    />
  );
}
