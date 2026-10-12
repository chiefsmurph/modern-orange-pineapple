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
