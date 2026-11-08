// Which Yoycol design each Yoycol-made product orders. A designCode is the id of
// a saved Product Template in John's Yoycol dashboard; it changes whenever he
// re-saves a design, so the codes can be overridden without a code change:
//
//   YOYCOL_DESIGN_CODES="clouds-in-sky-shirt=ABCDE,blue-sky-cotton-shorts=FGHIJ"
//
// SKUs are Yoycol's ADS-<spu>-00000-<colour hex>-<size> (all three AOP bases are White).

export type YoycolProduct = {
  /** Yoycol product (SPU) code. */
  spu: string;
  designCode: string;
  /** Base colour hex in the SKU. */
  colorHex: string;
  /** What the dashboard template is called, for John. */
  templateName: string;
};

export const yoycolProducts: Record<string, YoycolProduct> = {
  // Template 13559492 "Clouds In Sky Shirt", tee 3MTXVYM32 (Yoycol API, read 2026-10-11).
  "clouds-in-sky-shirt": {
    spu: "3MTXVYM32",
    designCode: "LRVV1",
    colorHex: "FFFFFF",
    templateName: "Clouds In Sky Shirt",
  },
  // Template 13560173 "Clouds Cotton Shorts", shorts 3MPXZT40.
  "blue-sky-cotton-shorts": {
    spu: "3MPXZT40",
    designCode: "LRWGN",
    colorHex: "FFFFFF",
    templateName: "Clouds Cotton Shorts",
  },
};

/** "a=X, b=Y" -> { a: "X", b: "Y" }. */
export const parseDesignCodes = (raw: string | undefined) =>
  Object.fromEntries(
    (raw ?? "")
      .split(/[,\n]/)
      .map((pair) => pair.split("=").map((s) => s.trim()))
      .filter(([k, v]) => k && v)
  ) as Record<string, string>;

export const yoycolFor = (
  slug: string,
  env: Record<string, string | undefined> = process.env
): YoycolProduct | undefined => {
  const base = yoycolProducts[slug];
  if (!base) return undefined;
  const override = parseDesignCodes(env.YOYCOL_DESIGN_CODES)[slug];
  return override ? { ...base, designCode: override } : base;
};

export const yoycolSku = (p: YoycolProduct, size: string) =>
  `ADS-${p.spu}-00000-${p.colorHex}-${size.toUpperCase()}`;

// --- Multi-colourway Yoycol products (one SPU, one designCode per colour) ---
//
// Unlike the single-colour products above, a colourway here is a different
// all-over print design (the garment itself is always white - the print
// covers it), so the SKU's colour segment stays FFFFFF for every colourway;
// only designCode changes. Override with
//   YOYCOL_DESIGN_CODES="supersize-alpaca-tee:White=NEWCODE"
// (falls back to a plain "<slug>=CODE" override applied to every colour, then
// to the colour's saved code below).

export type YoycolColorProduct = {
  spu: string;
  templateName: string;
  colors: Record<string, { colorHex: string; backs: Record<string, string> }>;
};

export const yoycolColorProducts: Record<string, YoycolColorProduct> = {
  // Templates 17055006 (White/PY8DV), 17054489 (Sky/PY7X7), 17055032
  // (Black/PY8EN), tee 3MTXVYM32 (Yoycol Open API, read 2026-11-07). All
  // three are the same blank (White AOP O-neck tee); the colourway is the
  // print design, so colorHex is FFFFFF for every one.
  //
  // Back (John, 11/08): "Logo" (rabbit + wordmark, the original design above)
  // or "Plain" (no back print), same price. Plain-back design codes read from
  // the Yoycol Open API 2026-11-08: White/PYBUK, Sky/PYBUN, Black/PYBUF.
  "supersize-alpaca-tee": {
    spu: "3MTXVYM32",
    templateName: "Supersize Alpaca",
    colors: {
      White: { colorHex: "FFFFFF", backs: { Logo: "PY8DV", Plain: "PYBUK" } },
      Sky: { colorHex: "FFFFFF", backs: { Logo: "PY7X7", Plain: "PYBUN" } },
      Black: { colorHex: "FFFFFF", backs: { Logo: "PY8EN", Plain: "PYBUF" } },
    },
  },
};

export const yoycolForColor = (
  slug: string,
  color: string | undefined,
  back: string | undefined,
  env: Record<string, string | undefined> = process.env
): YoycolProduct | undefined => {
  const base = yoycolColorProducts[slug];
  const variant = color ? base?.colors[color] : undefined;
  const backKey = back ?? (variant ? Object.keys(variant.backs)[0] : undefined);
  const savedCode = variant && backKey ? variant.backs[backKey] : undefined;
  if (!base || !variant || !savedCode) return undefined;
  const codes = parseDesignCodes(env.YOYCOL_DESIGN_CODES);
  const designCode =
    codes[`${slug}:${color}:${backKey}`] ?? codes[`${slug}:${color}`] ?? codes[slug] ?? savedCode;
  return { spu: base.spu, designCode, colorHex: variant.colorHex, templateName: base.templateName };
};

// --- Customer size -> Yoycol size (ship one size up; John, 2026-11-07) ---
//
// Yoycol's fit for this template runs small, so every order goes out one
// size above what the customer picked (S orders as M, M as L, ... 3XL as
// 4XL). There's no size above 4XL to shift 4XL into, so a 4XL order is NOT
// shifted and is flagged for John to confirm by hand (see the order email's
// neck-label TODO note - same unresolved "no server-side extra step" spot).
export const SUPERSIZE_ALPACA_SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];

export const yoycolSizeShiftUp = (
  size: string,
  order: readonly string[] = SUPERSIZE_ALPACA_SIZE_ORDER
): { size: string; shifted: boolean; atTop: boolean } => {
  const idx = order.indexOf(size.toUpperCase());
  if (idx === -1 || idx === order.length - 1) {
    // Unknown size, or already the top of the chart: nothing to shift into.
    return { size, shifted: false, atTop: idx === order.length - 1 };
  }
  return { size: order[idx + 1], shifted: true, atTop: false };
};
