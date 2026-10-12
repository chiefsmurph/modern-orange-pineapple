// Helpers for the "Out in the wild" home section (components/OutInTheWild.tsx).

/** n items at random (Fisher–Yates on a copy); `random` is injectable for tests. */
export function pickRandom<T>(items: T[], n: number, random: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a.slice(0, n);
}

export const STRIP_COUNT = 5;
export const GRID_COUNT = 9;

/**
 * One shuffle per visit, shared by the home page's two spots: the first 5 go to
 * the strip at the top, the next 9 to the grid at the bottom, so no photo shows twice.
 */
export function splitWild<T>(shuffled: T[]): { strip: T[]; grid: T[] } {
  return {
    strip: shuffled.slice(0, STRIP_COUNT),
    grid: shuffled.slice(STRIP_COUNT, STRIP_COUNT + GRID_COUNT),
  };
}
