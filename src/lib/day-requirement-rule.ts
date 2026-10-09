/**
 * The pure "perfect day" rule — no database, so it can be checked offline
 * (scripts/verify-perfect-days.mts). The rows it works from are loaded in
 * src/lib/day-requirement.ts.
 *
 * A day is perfect when every game *required that day* was cleared. A day with
 * no recorded requirement predates the admin game switches and required the
 * original five.
 */

/** `YYYY-MM-DD -> games required that day`. */
export type Requirements = Map<string, Set<string>>;

/** Fixed: a game added to the registry later must not reach back and unmake
 *  the perfect days already earned. */
const LEGACY = new Set<string>(["wordle", "typing", "aim", "litany", "geodash"]);

/** The games `day` required — its recorded row, else the original five. */
export function requiredFor(day: string, requirements?: Requirements): Set<string> {
  return requirements?.get(day) ?? LEGACY;
}

/**
 * Group completion rows into `day -> games cleared`, then return the days on
 * which every required game was cleared. A day that required nothing (every
 * game switched off) is never perfect.
 */
export function perfectDaysOf(
  rows: { date: Date; section: string }[],
  requirements?: Requirements,
): string[] {
  const cleared = new Map<string, Set<string>>();
  for (const r of rows) {
    const day = r.date.toISOString().slice(0, 10);
    let set = cleared.get(day);
    if (!set) {
      set = new Set();
      cleared.set(day, set);
    }
    set.add(r.section);
  }
  return [...cleared.entries()]
    .filter(([day, sections]) => {
      const need = requiredFor(day, requirements);
      if (need.size === 0) return false;
      for (const s of need) if (!sections.has(s)) return false;
      return true;
    })
    .map(([day]) => day);
}
