/**
 * The pure Streak Ward rule — no database, so it can be checked offline
 * (scripts/verify-raid-gear.mts). The rows it works from are loaded in
 * src/lib/shop/charms.ts.
 *
 * Wards are spent when the days just gone were missed, the day before them was
 * kept, and the player carried a ward for each before that day ended. A ward
 * bought after the miss mends nothing, and wards never cover part of a gap:
 * all of it, or none.
 */

const DAY_MS = 86_400_000;

/** The most missed days in a row the wards will cover: what can be carried. */
export const MAX_WARDED_GAP = 2;

/**
 * Which ward to spend on which day. `held` is every day already kept or
 * warded, `pack` the unspent wards with when each was bought, `endOf` the last
 * instant of a challenge day. Empty when nothing is to be spent.
 */
export function planWards(
  today: string,
  held: ReadonlySet<string>,
  pack: readonly { id: string; boughtAt: Date }[],
  endOf: (day: string) => Date | null,
): { id: string; day: string }[] {
  if (pack.length === 0) return [];

  // the missed days that end at yesterday, newest first
  const gap: string[] = [];
  let cursor = Date.parse(`${today}T00:00:00.000Z`) - DAY_MS;
  for (;;) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    if (held.has(day)) break;
    gap.push(day);
    if (gap.length > MAX_WARDED_GAP) return []; // too long: the streak is gone
    cursor -= DAY_MS;
  }
  if (gap.length === 0) return [];

  // oldest missed day first, each needing a ward carried before it ended
  const free = [...pack];
  const plan: { id: string; day: string }[] = [];
  for (const day of gap.reverse()) {
    const end = endOf(day);
    const i = end ? free.findIndex((w) => w.boughtAt <= end) : -1;
    if (i < 0) return []; // not covered: nothing is spent
    plan.push({ id: free[i].id, day });
    free.splice(i, 1);
  }
  return plan;
}
