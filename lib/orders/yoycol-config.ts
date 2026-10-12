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
