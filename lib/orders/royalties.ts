// Artist royalties per item sold (one royalties.jsonl row per royalty-bearing item).
//
// Rules come from catalog.json (lib/catalog/fulfilment.generated.ts) for the
// Printful line-up, plus legacyRoyalties below for older products. A rule's
// `when` must match the item's options (e.g. { style: "beanie" }).
//
// Rates can be overridden without a code change (e.g. Sunshine's, still to be
// confirmed): MOP_ROYALTY_RATES="sunshine=1.50,austin=1.50". A key matches an
// artist exactly or by its first word ("sunshine" matches "sunshine-austina").
import { catalogFulfilment } from "../catalog/fulfilment.generated.ts";
import type { RoyaltyRule } from "../catalog/types.ts";
import { matchesWhen } from "../catalog/select.ts";
import type { OrderRecord, RoyaltyRow } from "./types.ts";

/** Older (public/products.ts) products that carry a royalty. */
export const legacyRoyalties: Record<string, RoyaltyRule[]> = {
  // The $27 "Pelican With Beanie" tee is the Grind Beanie pelican (credited to
  // Janette in lib/artists.ts), so it pays the same as the new Beanie style.
  "pelican-beanie-t-shirt": [{ artist: "janette", perItem: 1.5 }],
};

export const parseRates = (raw: string | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const pair of (raw ?? "").split(/[,\n]/)) {
    const [k, v] = pair.split("=").map((s) => s.trim());
    const n = Number(v);
    if (k && v && Number.isFinite(n) && n >= 0) out[k.toLowerCase()] = n;
  }
  return out;
};

const rateFor = (artist: string, rates: Record<string, number>) => {
  const a = artist.toLowerCase();
  if (a in rates) return rates[a];
  const first = a.split(/[-_ ]/)[0];
  return first in rates ? rates[first] : undefined;
};

export const rulesFor = (slug: string): RoyaltyRule[] =>
  catalogFulfilment[slug]?.royalties ?? legacyRoyalties[slug] ?? [];

const round2 = (n: number) => Math.round(n * 100) / 100;

export function royaltyRows(
  record: OrderRecord,
  at: string,
  env: Record<string, string | undefined> = process.env,
  rules: (slug: string) => RoyaltyRule[] = rulesFor
): RoyaltyRow[] {
  const rates = parseRates(env.MOP_ROYALTY_RATES);
  const rows: RoyaltyRow[] = [];
  for (const item of record.items) {
    for (const rule of rules(item.slug)) {
      if (!matchesWhen(rule.when, item.opts)) continue;
      const perItem = rateFor(rule.artist, rates) ?? rule.perItem;
      if (!(perItem > 0)) continue;
      rows.push({
        at,
        session_id: record.session_id,
        order_ref: record.order_ref,
        artist: rule.artist,
        per_item: perItem,
        qty: item.qty,
        amount: round2(perItem * item.qty),
        product: item.title,
        slug: item.slug,
        options: item.opts,
        livemode: record.livemode,
      });
    }
  }
  return rows;
}
