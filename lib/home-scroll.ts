// "← Home" from a product page returns to the same place in the home grid.
//
// - A product card click on the home page remembers { to: href, y: scrollY },
//   in memory (it lives as long as this page's JavaScript, i.e. across
//   client-side navigation, and is gone after a reload or a fresh visit).
// - "← Home" on that same product: the entry before this one in history is the
//   home page, so go BACK, and leave the scroll position in sessionStorage for
//   the home page to restore on mount. That works whatever the browser's own
//   scroll restoration does (iOS Safari included).
// - Anyone who reached the product another way (a shared link, a reload, a
//   typed URL, a new tab) gets a plain link to "/" at the top.
// Pure functions over a Storage, so they can be tested without a browser.

const RESTORE = "mop:home-restore";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CardClick = { to: string; y: number };

let lastCardClick: CardClick | null = null;

/** On a home-page card click: where we were, and which product we're opening. */
export function rememberHomeCard(to: string, y: number) {
  lastCardClick = { to, y: Math.max(0, Math.round(y)) };
}

export const lastHomeCard = () => lastCardClick;

export type ReturnPlan = "back" | "push-top";

/**
 * What "← Home" should do on `pathname`. "back" also leaves the scroll position
 * in storage for the home page to restore.
 */
export function planReturnHome(
  storage: Store,
  pathname: string,
  historyLength: number,
  card: CardClick | null = lastCardClick
): ReturnPlan {
  try {
    storage.removeItem(RESTORE);
  } catch {}
  if (!card || card.to !== pathname || historyLength < 2) return "push-top";
  try {
    storage.setItem(RESTORE, String(card.y));
  } catch {
    // no storage: going back still works; the browser may restore the scroll itself
  }
  return "back";
}

/** On home-page mount: the scroll position to restore (once), or null. */
export function takeHomeRestore(storage: Store): number | null {
  try {
    const raw = storage.getItem(RESTORE);
    storage.removeItem(RESTORE);
    const y = raw == null ? NaN : Number(raw);
    return Number.isFinite(y) && y >= 0 ? y : null;
  } catch {
    return null;
  }
}
