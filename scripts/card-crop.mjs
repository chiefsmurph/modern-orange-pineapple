// Home-grid card crops for gen-catalog.mjs.
//
// Printful's full-body mockups (Men's 2, Women's, Women's 2) show a whole
// standing person on a transparent background, so on a small card the print is
// tiny. For those, the card gets its own square image cropped from the top of
// the head to about the hips. Everything else is used as it is:
// - waist-up cut-outs (the print already reads big),
// - photos with their own background (Duet, On Hanger, Lifestyle shots).
//
// Detection works per image from the alpha channel, so it doesn't depend on
// file names or on which mockup style the Printful agent picked:
//   1. cut-out?    >= 20% of the pixels are transparent (else it's a photo);
//   2. full-body?  the subject covers < 24% of the frame. Measured on Printful's
//                  mockups: full-body 15–21% (Men's 2, Women's, Women's 2), Men's 3 26%
//                  (a closer 3/4 shot, left alone), waist-up 29–41%,
//                  full-length dress 33% (left alone: its skirt is the print).
import sharp from "sharp";

const SAMPLE_WIDTH = 400;
const ALPHA_ON = 64;

/** Measure the subject. Returns null for a photo (no meaningful transparency). */
export async function measure(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .resize({ width: SAMPLE_WIDTH })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 16) clear++;
  if (clear / (w * h) < 0.2) return null;

  const rowSpan = (y) => {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_ON) {
        if (l < 0) l = x;
        r = x;
      }
    }
    return l < 0 ? null : [l, r];
  };
  let top = -1, bottom = -1, area = 0;
  for (let y = 0; y < h; y++) {
    if (!rowSpan(y)) continue;
    if (top < 0) top = y;
    bottom = y;
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > ALPHA_ON) area++;
  }
  if (top < 0) return null;
  return { w, h, top, bottom, figH: bottom - top + 1, fill: area / (w * h), data };
}

/**
 * The square to cut from the full-size image for its card, or null to use the
 * image as it is. Coordinates are in the full-size image's pixels.
 */
export async function cardCrop(file) {
  const m = await measure(file);
  if (!m || m.fill >= 0.24 || m.figH < m.h * 0.6) return null;
  const { width: W, height: H } = await sharp(file).metadata();
  const k = W / m.w; // sample -> full size
  // Head to hips is about 55% of a standing figure.
  const side = Math.round(m.figH * 0.55);
  const top = Math.max(0, m.top - Math.round(side * 0.05));
  // Centre on the subject inside that band (the torso, whatever the pose).
  let sum = 0, n = 0;
  for (let y = top; y < Math.min(m.h, top + side); y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.data[(y * m.w + x) * 4 + 3] > ALPHA_ON) { sum += x; n++; }
    }
  }
  const cx = n ? sum / n : m.w / 2;
  const left = Math.min(Math.max(0, Math.round(cx - side / 2)), m.w - side);
  const S = Math.min(Math.round(side * k), W, H);
  return {
    left: Math.max(0, Math.min(Math.round(left * k), W - S)),
    top: Math.max(0, Math.min(Math.round(top * k), H - S)),
    width: S,
    height: S,
  };
}

/** Write the cropped card image (WebP, alpha kept). */
export async function writeCard(file, crop, out) {
  await sharp(file).extract(crop).resize({ width: 900, height: 900 }).webp({ quality: 82 }).toFile(out);
}
