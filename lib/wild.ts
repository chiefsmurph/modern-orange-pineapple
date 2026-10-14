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

/** Columns of the grid at the bottom (components/OutInTheWild.module.css: 3×3). */
export const GRID_COLS = 3;

type HasPeople = { people: string[] };
const shareSomeone = (a: HasPeople | undefined, b: HasPeople | undefined) =>
  !!a && !!b && a.people.some((x) => b.people.includes(x));

/** Grid positions side by side (left/right or above/below) that show the same person. */
export function adjacentRepeats<T extends HasPeople>(grid: T[], cols = GRID_COLS): number {
  let n = 0;
  grid.forEach((p, i) => {
    if (i % cols !== 0 && shareSomeone(p, grid[i - 1])) n++;
    if (i >= cols && shareSomeone(p, grid[i - cols])) n++;
  });
  return n;
}

/**
 * Fill the grid in order. Each place takes the first photo (in the shuffled order)
 * that doesn't repeat a neighbour's person, preferring people not shown yet (in
 * the grid, then in the strip) so one person with many photos doesn't fill it.
 */
function arrange<T extends HasPeople>(pool: T[], count: number, cols: number, strip: T[]): T[] {
  const left = pool.slice();
  const grid: T[] = [];
  const inStrip = new Set(strip.flatMap((p) => p.people));
  while (grid.length < count && left.length) {
    const i = grid.length;
    const inGrid = new Set(grid.flatMap((p) => p.people));
    const ok = (p: T) => !(i % cols !== 0 && shareSomeone(p, grid[i - 1])) && !(i >= cols && shareSomeone(p, grid[i - cols]));
    const fresh = (p: T) => !p.people.some((x) => inGrid.has(x));
    const tiers = [(p: T) => ok(p) && fresh(p) && !p.people.some((x) => inStrip.has(x)), (p: T) => ok(p) && fresh(p), ok];
    let k = -1;
    for (const t of tiers) if ((k = left.findIndex(t)) >= 0) break;
    grid.push(left.splice(Math.max(0, k), 1)[0]); // nobody fits: the next one anyway
  }
  return grid;
}

/**
 * One mix per visit for the home page's two spots (John, 10/13):
 *   strip  5 photos, each of a different person (a photo with two people counts both);
 *   grid   9 of the others (never a photo from the strip), the same person never side by side,
 *          and as many different people as the photos allow.
 * Both in a fresh random order every time. `random` is injectable for tests.
 */
export function mixWild<T extends HasPeople>(photos: T[], random: () => number = Math.random): { strip: T[]; grid: T[] } {
  const shuffled = pickRandom(photos, photos.length, random);
  const strip: T[] = [];
  const seen = new Set<string>();
  for (const p of shuffled) {
    if (strip.length === STRIP_COUNT) break;
    if (p.people.some((x) => seen.has(x))) continue;
    strip.push(p);
    p.people.forEach((x) => seen.add(x));
  }
  // fewer different people than strip places: fill up (only if the gallery ever gets that small)
  for (const p of shuffled) if (strip.length < STRIP_COUNT && !strip.includes(p)) strip.push(p);

  const rest = shuffled.filter((p) => !strip.includes(p));
  let grid = arrange(rest, GRID_COUNT, GRID_COLS, strip);
  // the greedy fill can corner itself; a few fresh orders of the rest almost always fix it
  for (let tries = 0; tries < 20 && adjacentRepeats(grid) > 0; tries++) grid = arrange(pickRandom(rest, rest.length, random), GRID_COUNT, GRID_COLS, strip);
  return { strip, grid };
}
