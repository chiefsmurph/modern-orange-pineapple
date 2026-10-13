// The shopping bag, in the browser (localStorage "mop-bag"). It holds only
// variant ids (the same ids as the feeds and /meta-checkout: feedId) and
// quantities; everything shown is looked up in the catalog, and the checkout
// (POST /api/bag-checkout) prices everything again on the server.
//
// Client-safe: no supplier ids or costs (those are in fulfilment.generated.ts,
// server only).
import { useSyncExternalStore } from "react";
import legacy from "../public/products.ts";
import { shopProducts, type ShopProduct } from "./catalog/index.ts";
import { imageSetFor, imagesFor, optionNames, syncedQuery } from "./catalog/select.ts";
import { valueLabel } from "./catalog/copy.ts";
import { feedId } from "./google-feed.ts";

export const BAG_KEY = "mop-bag";
export const BAG_EVENT = "mop-bag-change";
export const MAX_BAG_LINES = 20;
export const MAX_BAG_QTY = 20;

/** What's stored: the variant id, how many, and the title (only to name it if it goes off sale). */
export type BagLine = { id: string; qty: number; t?: string };

export type BagLineView = BagLine & {
  slug: string;
  title: string;
  /** "Big · Lagoon Blue · M" */
  summary: string;
  /** Dollars, from the catalog. */
  unitPrice: number;
  image: string;
  href: string;
};

type Indexed = { product: ShopProduct; opts: Record<string, string>; price: number };
let index: Map<string, Indexed> | null = null;
const bagIndex = () => {
  if (index) return index;
  index = new Map();
  for (const product of shopProducts)
    for (const v of product.variants) index.set(feedId(product.slug, v.opts), { product, opts: { ...v.opts }, price: v.price });
  return index;
};

/** Retired or coming-back-soon (public/products.ts), as the server's checkoutBlock. */
const offSale = (slug: string) => legacy.products.some((p) => p.id === slug && (p.retired || p.comingSoon));

export const variantSummary = (product: Pick<ShopProduct, "slug" | "options" | "optionLabels">, opts: Record<string, string>) =>
  optionNames(product as ShopProduct)
    .filter((n) => opts[n] && product.options[n].length > 1)
    .map((n) => valueLabel(n, opts[n], product.optionLabels))
    .join(" · ");

/** The variant id for a product + complete selection (what the bag stores). */
export const bagId = (slug: string, opts: Record<string, string>) => feedId(slug, opts);

export function lineView(line: BagLine): BagLineView | null {
  const hit = bagIndex().get(line.id);
  if (!hit || offSale(hit.product.slug)) return null;
  const { product, opts, price } = hit;
  const query = syncedQuery("", optionNames(product), opts);
  return {
    ...line,
    slug: product.slug,
    title: product.title,
    summary: variantSummary(product, opts),
    unitPrice: price,
    image: imageSetFor(product, opts)?.checkout ?? imagesFor(product, opts)[0],
    href: `/${product.slug}${query ? `?${query}` : ""}`,
  };
}

/** Whatever is stored -> clean lines (merged, quantities 1–20, at most 20 lines) and what was dropped. */
export function validateBag(raw: unknown): { lines: BagLine[]; dropped: string[] } {
  const list = Array.isArray((raw as { lines?: unknown })?.lines) ? (raw as { lines: unknown[] }).lines : [];
  const byId = new Map<string, BagLine>();
  const dropped: string[] = [];
  for (const l of list) {
    const id = typeof (l as BagLine)?.id === "string" ? (l as BagLine).id : "";
    const qty = Math.floor(Number((l as BagLine)?.qty));
    const t = typeof (l as BagLine)?.t === "string" ? (l as BagLine).t!.slice(0, 80) : undefined;
    if (!id) continue;
    if (!lineView({ id, qty: 1 })) {
      dropped.push(t ?? "An item");
      continue;
    }
    if (!(qty >= 1)) continue;
    const prev = byId.get(id);
    if (!prev && byId.size >= MAX_BAG_LINES) continue;
    const title = t ?? prev?.t;
    byId.set(id, { id, qty: Math.min(MAX_BAG_QTY, (prev?.qty ?? 0) + qty), ...(title ? { t: title } : {}) });
  }
  return { lines: Array.from(byId.values()), dropped };
}

export function addLine(lines: BagLine[], id: string, title?: string, qty = 1): { lines: BagLine[]; ok: boolean } {
  const i = lines.findIndex((l) => l.id === id);
  if (i >= 0) {
    if (lines[i].qty >= MAX_BAG_QTY) return { lines, ok: false };
    return { lines: lines.map((l, j) => (j === i ? { ...l, qty: Math.min(MAX_BAG_QTY, l.qty + qty) } : l)), ok: true };
  }
  if (lines.length >= MAX_BAG_LINES) return { lines, ok: false };
  return { lines: [...lines, { id, qty: Math.min(MAX_BAG_QTY, qty), ...(title ? { t: title } : {}) }], ok: true };
}

export const setQty = (lines: BagLine[], id: string, qty: number): BagLine[] =>
  lines.map((l) => (l.id === id ? { ...l, qty: Math.max(1, Math.min(MAX_BAG_QTY, Math.floor(qty) || 1)) } : l));

export const removeLine = (lines: BagLine[], id: string): BagLine[] => lines.filter((l) => l.id !== id);

export const bagCount = (lines: BagLine[]) => lines.reduce((n, l) => n + l.qty, 0);

// --- localStorage (never throws: private windows, blocked storage) -------------

type Snapshot = { lines: BagLine[]; dropped: string[] };
const EMPTY: Snapshot = { lines: [], dropped: [] };
let lastRaw: string | null | undefined;
let lastSnap: Snapshot = EMPTY;
let memory: string | null = null; // when storage is unavailable, the bag lives for this page view

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(BAG_KEY);
  } catch {
    return memory;
  }
}

export function readBag(): Snapshot {
  if (typeof window === "undefined") return EMPTY;
  const raw = readRaw();
  if (raw === lastRaw) return lastSnap;
  lastRaw = raw;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  lastSnap = validateBag(parsed);
  return lastSnap;
}

export function writeBag(lines: BagLine[]) {
  const raw = lines.length ? JSON.stringify({ v: 1, lines }) : null;
  try {
    if (raw) window.localStorage.setItem(BAG_KEY, raw);
    else window.localStorage.removeItem(BAG_KEY);
  } catch {
    memory = raw;
  }
  try {
    window.dispatchEvent(new Event(BAG_EVENT));
  } catch {
    // no window events: nothing to update
  }
}

export const clearBag = () => writeBag([]);

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === BAG_KEY) onChange();
  };
  window.addEventListener(BAG_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(BAG_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The bag (validated against the catalog), live across components and tabs. Empty on the server. */
export function useBag(): Snapshot {
  return useSyncExternalStore(subscribe, readBag, () => EMPTY);
}
