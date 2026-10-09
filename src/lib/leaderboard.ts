/**
 * The streak leaderboard: every player who has bested a trial in the last 90
 * days, ranked by current streak (consecutive days completing every trial),
 * then longest streak, then trials bested. Each row also carries the short
 * summary of that player anyone may see — counted from the same rows, plus one
 * count of achievements.
 *
 * The whole board is built once and cached in-process for 5 minutes (same idea
 * as the boss `SharedSnapshot` cache), so a page view is usually zero queries.
 */

import { prisma } from "@/lib/prisma";
import { wardedDaysByPlayer } from "@/lib/shop/charms";
import { getChallengeDateString } from "@/lib/challenge-date";
import { streaksFromDays, perfectDays } from "@/lib/streak";
import { SECTION_IDS } from "@/lib/sections";
import { getRequirements } from "@/lib/day-requirement";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;
const CACHE_MS = 5 * 60_000;
const MAX_ROWS = 100;

export type LeaderRow = {
  rank: number;
  discordId: string;
  name: string;
  image: string | null;
  current: number;
  longest: number;
  trials: number;
  /** days on which every required trial was bested */
  perfect: number;
  /** days with at least one trial bested */
  days: number;
  /** trials bested, by game */
  games: Record<string, number>;
  /** achievements unlocked (all time) */
  feats: number;
  you: boolean;
};

type BaseRow = Omit<LeaderRow, "rank" | "you">;

let cache: { at: number; rows: BaseRow[] } | null = null;

async function build(): Promise<BaseRow[]> {
  const since = new Date(
    Date.parse(`${getChallengeDateString()}T00:00:00.000Z`) - WINDOW_DAYS * DAY_MS,
  );

  const [rows, requirements] = await Promise.all([
    prisma.completion.findMany({
      where: {
        rewarded: true,
        section: { in: [...SECTION_IDS] },
        date: { gte: since },
      },
      select: { discordId: true, date: true, section: true },
    }),
    getRequirements(since),
  ]);

  const byUser = new Map<string, { date: Date; section: string }[]>();
  for (const r of rows) {
    const arr = byUser.get(r.discordId) ?? [];
    arr.push({ date: r.date, section: r.section });
    byUser.set(r.discordId, arr);
  }

  const ids = [...byUser.keys()];
  if (ids.length === 0) return [];

  const [users, featRows] = await Promise.all([
    prisma.user.findMany({
      where: { discordId: { in: ids } },
      select: { discordId: true, name: true, image: true },
    }),
    prisma.achievement.groupBy({
      by: ["discordId"],
      where: { discordId: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const byId = new Map(users.map((u) => [u.discordId!, u]));
  const feats = new Map(featRows.map((f) => [f.discordId, f._count._all]));

  // days a Streak Ward has covered hold a streak here as they do on the
  // player's own page (read only: wards are spent when their owner is looked at)
  const warded = await wardedDaysByPlayer().catch(() => new Map<string, string[]>());

  const out: BaseRow[] = [];
  for (const id of ids) {
    const completions = byUser.get(id)!;
    const perfect = perfectDays(completions, requirements);
    const { current, longest } = streaksFromDays([...perfect, ...(warded.get(id) ?? [])]);
    const games: Record<string, number> = {};
    const days = new Set<string>();
    for (const c of completions) {
      games[c.section] = (games[c.section] ?? 0) + 1;
      days.add(c.date.toISOString().slice(0, 10));
    }
    const u = byId.get(id);
    out.push({
      discordId: id,
      name: u?.name?.trim() || "Nameless",
      image: u?.image ?? null,
      current,
      longest,
      trials: completions.length,
      perfect: perfect.length,
      days: days.size,
      games,
      feats: feats.get(id) ?? 0,
    });
  }

  out.sort(
    (a, b) =>
      b.current - a.current || b.longest - a.longest || b.trials - a.trials,
  );
  return out.slice(0, MAX_ROWS);
}

export async function getStreakLeaderboard(
  viewerDiscordId?: string | null,
): Promise<LeaderRow[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), rows: await build() };
  }
  return cache.rows.map((r, i) => ({
    ...r,
    rank: i + 1,
    you: !!viewerDiscordId && r.discordId === viewerDiscordId,
  }));
}
