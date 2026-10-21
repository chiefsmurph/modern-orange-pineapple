// Options added to a product that was already on sale. The value it sold as
// before is that option's FIRST value, so the page default doesn't change.
//
// John 2026-10-21: the Original Star Tee gets a second design, the Bolt
// ("design": star | bolt), on the same page. Everything made before the option
// existed has no `design`: bags in browsers, Meta Shop carts, the feed ids
// Google and Meta already list, likes. So:
//   - a selection without the option means the old value (checkout, see build-items.ts);
//   - ids built from a selection (feedId, the like key) leave the option out at
//     the old value, so every id that existed before stays exactly the same and
//     only the new value's variants get new ids.
// Pure (no imports): the browser bundle (bag, like button) uses it too.

export const addedOptions: Record<string, Record<string, string>> = {
  "original-star-tee": { design: "star" },
};

/** The value a selection without `name` means, for an option added later (else undefined). */
export const addedDefault = (slug: string, name: string): string | undefined => addedOptions[slug]?.[name];

/** `opts` without the added options that are at their old value (same key order otherwise). */
export function withoutAddedDefaults<T extends Record<string, string | undefined>>(slug: string, opts: T): T {
  const added = addedOptions[slug];
  if (!added) return opts;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (k in added && v !== undefined && v.toLowerCase() === added[k].toLowerCase()) continue;
    out[k] = v;
  }
  return out as T;
}
