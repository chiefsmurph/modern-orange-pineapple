// The exact <img> attributes for product photos, shared by the visible images
// and the background preloader so both ask for the very same URL.
//
// Product photos go through next/image's optimizer (AVIF/WebP at the displayed
// width). getImageProps() gives the src/srcSet/sizes that <Image> would render;
// the preloader puts the identical srcset + sizes on a detached Image, so the
// browser picks the same candidate for the same viewport and the visible <img>
// later finds it in the memory cache.
import { getImageProps } from "next/image";
import type { PreloadKind } from "./catalog/preload-plan";

export const IMAGE_KINDS: Record<PreloadKind, { width: number; height: number; sizes: string }> = {
  // the big photo in the product gallery
  main: { width: 1000, height: 1000, sizes: "(max-width: 767px) calc(100vw - 48px), 300px" },
  // gallery thumbnails and the Sky picker's tiles
  thumb: { width: 120, height: 120, sizes: "64px" },
};

export function imageAttrs(kind: PreloadKind, src: string, alt = "", priority = false) {
  const { props } = getImageProps({ src, alt, priority, ...IMAGE_KINDS[kind] });
  return props;
}

const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/** Load (and decode) one photo with exactly the attributes the page will use. */
export function preloadImage(
  kind: PreloadKind,
  src: string,
  urgent: boolean,
  signal: AbortSignal
): Promise<HTMLImageElement> {
  const attrs = imageAttrs(kind, src);
  const img = new Image();
  img.decoding = "async";
  // Background preloads must never compete with what's on screen.
  try {
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = urgent ? "high" : "low";
  } catch {}
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const stop = () => {
      // cancels the download in every browser
      img.removeAttribute("srcset");
      img.src = BLANK;
      reject(new Error("aborted"));
    };
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    img.onload = () => {
      signal.removeEventListener("abort", stop);
      resolve(img);
    };
    img.onerror = () => {
      signal.removeEventListener("abort", stop);
      reject(new Error(`could not load ${src}`));
    };
    // sizes and srcset before src, as the browser picks the candidate when src is set
    if (attrs.sizes) img.sizes = attrs.sizes;
    if (attrs.srcSet) img.srcset = attrs.srcSet;
    img.src = attrs.src;
  });
}

/** Decode before swapping so the swap paints at once; older Safari has no decode(). */
export const decodeImage = (img: HTMLImageElement | undefined | null): Promise<void> =>
  img && typeof img.decode === "function" ? img.decode().catch(() => undefined) : Promise.resolve();

/** Save-Data, or a 2G connection: preload only what the visitor is looking at. */
export const wantsLessData = () => {
  try {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? ""));
  } catch {
    return false;
  }
};
