/**
 * Daily streak maths, shared by the dashboard counter, the profile page, and
 * the leaderboard.
 *
 * A "streak" is consecutive challenge-days (see src/lib/challenge-date.ts) on
 * which the player cleared *every* daily trial. `Completion.date` is stored as a
 * `@db.Date` at 00:00 UTC, so day-stepping is plain arithmetic on those anchors
 * — no timezone or DST hazard.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDateString } from "@/lib/challenge-date";
import { SECTION_IDS } from "@/lib/sections";

const DAY_MS = 86_400_000;

/** `Date` (or `@db.Date` value) → `YYYY-MM-DD`. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Current + longest streak from the set of qualifying days.
 *
 * "Current" tolerates today not being done yet: it counts back from today if
 * today is in the set, otherwise from yesterday. So the streak only reads as
 * broken once a whole day has actually been missed.
 */
export function streaksFromDays(days: Iterable<string>): {
  current: number;
  longest: number;
} {
  const set = days instanceof Set ? days : new Set(days);
  if (set.size === 0) return { current: 0, longest: 0 };

  const sorted = [...set].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = Date.parse(`${sorted[i - 1]}T00:00:00.000Z`);
    const cur = Date.parse(`${sorted[i]}T00:00:00.000Z`);
    if (cur - prev === DAY_MS) longest = Math.max(longest, ++run);
    else run = 1;
  }

  const today = getChallengeDateString();
  let cursor = Date.parse(`${today}T00:00:00.000Z`);
  if (!set.has(today)) cursor -= DAY_MS;
  let current = 0;
  while (set.has(dayKey(new Date(cursor)))) {
    current++;
    cursor -= DAY_MS;
  }

  return { current, longest };
}

/**
 * Group completion rows into `day -> set of sections cleared`, then return the
 * days on which *every* trial was cleared. Shared by getUserStreak and the
 * leaderboard.
 */
export function perfectDays(
  rows: { date: Date; section: string }[],
): string[] {
  const bySection = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = dayKey(r.date);
    let set = bySection.get(k);
    if (!set) {
      set = new Set();
      bySection.set(k, set);
    }
    set.add(r.section);
  }
  const need = SECTION_IDS.length;
  return [...bySection.entries()]
    .filter(([, sections]) => sections.size >= need)
    .map(([day]) => day);
}

export type UserStreak = {
  /** consecutive days completing every trial */
  current: number;
  longest: number;
  /** individual game completions ever (within the lookback window) */
  totalTrials: number;
  /** days on which every trial was cleared (within the lookback window) */
  perfectDayCount: number;
  /** distinct days with at least one completion (within the lookback window) */
  activeDays: number;
};

/** How far back streak queries look. A streak longer than this gets clipped —
 *  a fine problem to have, and revisit if anyone ever hits it. */
export const STREAK_LOOKBACK_DAYS = 400;

/** Full streak picture for one player (one indexed query). */
export async function getUserStreak(discordId: string): Promise<UserStreak> {
  const since = new Date(
    Date.parse(`${getChallengeDateString()}T00:00:00.000Z`) -
      STREAK_LOOKBACK_DAYS * DAY_MS,
  );
  const rows = await prisma.completion.findMany({
    where: {
      discordId,
      rewarded: true,
      section: { in: [...SECTION_IDS] },
      date: { gte: since },
    },
    select: { date: true, section: true },
  });

  const perfect = perfectDays(rows);
  const { current, longest } = streaksFromDays(perfect);
  return {
    current,
    longest,
    totalTrials: rows.length,
    perfectDayCount: perfect.length,
    activeDays: new Set(rows.map((r) => dayKey(r.date))).size,
  };
}
