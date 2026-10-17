/**
 * What the Discord bot needs for its daily posts (cogs/daily_nudges.py): the
 * morning "today's trials are open" post with yesterday's recap, and the
 * evening reminder to players whose streak ends at midnight.
 *
 * One read of the last 90 days of completions, the same window as the streak
 * leaderboard (a longer streak is clipped to 90 here, which only matters for
 * the number shown).
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getRequirements } from "@/lib/day-requirement";
import { getActiveSectionIds, getSectionRewards } from "@/lib/section-status";
import { SECTIONS, SECTION_IDS } from "@/lib/sections";
import { wardedDaysByPlayer } from "@/lib/shop/charms";
import { keptDays, perfectDays, streaksFromDays } from "@/lib/streak";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;

export type BotDigest = {
  /** today's challenge day, YYYY-MM-DD */
  date: string;
  /** the games open today, with their prize */
  trials: { id: string; label: string; reward: number }[];
  yesterday: { players: number; clears: number; perfect: number };
  /** the longest streaks still alive, best first */
  streaks: { name: string; current: number }[];
  /** streaks of a day or more with no trial cleared yet today */
  atRisk: { discordId: string; name: string; current: number }[];
};

export async function getBotDigest(): Promise<BotDigest> {
  const today = getChallengeDateString();
  const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - DAY_MS)
    .toISOString()
    .slice(0, 10);
  const since = new Date(Date.parse(`${today}T00:00:00.000Z`) - WINDOW_DAYS * DAY_MS);

  const [rows, requirements, active, rewards, warded] = await Promise.all([
    prisma.completion.findMany({
      where: { rewarded: true, section: { in: [...SECTION_IDS] }, date: { gte: since } },
      select: { discordId: true, date: true, section: true },
    }),
    getRequirements(since),
    getActiveSectionIds(),
    getSectionRewards(),
    wardedDaysByPlayer().catch(() => new Map<string, string[]>()),
  ]);

  const byUser = new Map<string, { date: Date; section: string }[]>();
  for (const r of rows) byUser.set(r.discordId, [...(byUser.get(r.discordId) ?? []), r]);

  const names = new Map(
    (
      await prisma.user.findMany({
        where: { discordId: { in: [...byUser.keys()] } },
        select: { discordId: true, name: true },
      })
    ).map((u) => [u.discordId!, u.name?.trim() || "Nameless"]),
  );

  let yPlayers = 0;
  let yClears = 0;
  let yPerfect = 0;
  const alive: BotDigest["atRisk"] = [];
  const atRisk: BotDigest["atRisk"] = [];
  for (const [discordId, list] of byUser) {
    const kept = keptDays(list);
    const yRows = list.filter((r) => r.date.toISOString().startsWith(yesterday));
    if (yRows.length > 0) {
      yPlayers += 1;
      yClears += yRows.length;
      if (perfectDays(yRows, requirements).length > 0) yPerfect += 1;
    }
    const { current } = streaksFromDays([...kept, ...(warded.get(discordId) ?? [])]);
    if (current <= 0) continue;
    const entry = { discordId, name: names.get(discordId) ?? "Nameless", current };
    alive.push(entry);
    if (!kept.includes(today)) atRisk.push(entry);
  }

  return {
    date: today,
    trials: active.map((id) => ({ id, label: SECTIONS[id].label, reward: rewards[id] })),
    yesterday: { players: yPlayers, clears: yClears, perfect: yPerfect },
    streaks: alive
      .sort((a, b) => b.current - a.current)
      .slice(0, 3)
      .map(({ name, current }) => ({ name, current })),
    atRisk: atRisk.sort((a, b) => b.current - a.current),
  };
}
