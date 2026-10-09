/**
 * Everything the /me page shows about one player. Most of it falls straight out
 * of `Completion` rows; personal bests come from `GameScore`, and the Wordle
 * breakdown from `WordleGame`.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getUserStreak, dayKey } from "@/lib/streak";
import { HIGHER_IS_BETTER, type ScoreMetric } from "@/lib/scores";
import { SECTIONS, SECTION_IDS, type SectionId } from "@/lib/sections";
import { getVisibleSectionIds } from "@/lib/section-status";
import { MAX_GUESSES } from "@/lib/wordle/game";
import { getEnabledAchievementDefs } from "@/lib/achievements/store";

const DAY_MS = 86_400_000;
/** 17 weeks — a tidy 7-row heatmap. */
export const HEAT_DAYS = 119;

export type HeatCell = { date: string; count: number };

export type GameStat = {
  id: SectionId;
  label: string;
  plays: number;
  lastPlayed: string | null;
  /** taken off the dashboard by the admin; listed only because of past play */
  hidden: boolean;
  best: { metric: ScoreMetric; value: number } | null;
};

export type Profile = {
  streak: { current: number; longest: number };
  activeDays: number;
  totalTrials: number;
  lifetimeCoins: number;
  perfectDays: number;
  heat: HeatCell[];
  games: GameStat[];
  wordle: { played: number; won: number; distribution: number[] } | null;
  achievementsUnlocked: number;
  achievementsTotal: number;
};

function bestFrom(
  grouped: { section: string; metric: string; _max: { value: number | null }; _min: { value: number | null } }[],
  section: SectionId,
): GameStat["best"] {
  const row = grouped.find((g) => g.section === section);
  if (!row) return null;
  const metric = row.metric as ScoreMetric;
  const value = HIGHER_IS_BETTER[metric] ? row._max.value : row._min.value;
  return value == null ? null : { metric, value };
}

export async function getProfile(discordId: string): Promise<Profile> {
  const today = Date.parse(`${getChallengeDateString()}T00:00:00.000Z`);
  const heatStart = new Date(today - (HEAT_DAYS - 1) * DAY_MS);

  const [streak, coinSum, perGame, heatRows, bestRows, wordleRows, achievementCount, achievementDefs] =
    await Promise.all([
      getUserStreak(discordId),
      prisma.completion.aggregate({
        where: { discordId, rewarded: true },
        _sum: { rewardAmount: true },
      }),
      prisma.completion.groupBy({
        by: ["section"],
        where: { discordId, rewarded: true, section: { in: [...SECTION_IDS] } },
        _count: { _all: true },
        _max: { date: true },
      }),
      prisma.completion.findMany({
        where: {
          discordId,
          rewarded: true,
          section: { in: [...SECTION_IDS] },
          date: { gte: heatStart },
        },
        select: { date: true },
      }),
      prisma.gameScore.groupBy({
        by: ["section", "metric"],
        where: { discordId },
        _max: { value: true },
        _min: { value: true },
      }),
      prisma.wordleGame.findMany({
        where: { discordId, finished: true },
        select: { guesses: true, won: true },
      }),
      prisma.achievement.count({ where: { discordId } }),
      getEnabledAchievementDefs(),
    ]);

  // heatmap
  const perDay = new Map<string, number>();
  for (const r of heatRows) {
    const k = dayKey(r.date);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const heat: HeatCell[] = [];
  for (let i = 0; i < HEAT_DAYS; i++) {
    const key = dayKey(new Date(today - (HEAT_DAYS - 1 - i) * DAY_MS));
    heat.push({ date: key, count: perDay.get(key) ?? 0 });
  }

  // per-game — a game the admin has hidden is listed only for players who
  // actually have history in it
  const visible = new Set(await getVisibleSectionIds());
  const games: GameStat[] = SECTION_IDS.filter(
    (id) => visible.has(id) || perGame.some((p) => p.section === id),
  ).map((id) => {
    const g = perGame.find((p) => p.section === id);
    return {
      id,
      label: SECTIONS[id].label,
      plays: g?._count._all ?? 0,
      lastPlayed: g?._max.date ? dayKey(g._max.date) : null,
      hidden: !visible.has(id),
      best: bestFrom(bestRows, id),
    };
  });

  // wordle breakdown
  let wordle: Profile["wordle"] = null;
  if (wordleRows.length) {
    // The guess limit is admin-set and can exceed the classic six, so size
    // the chart to the longest win actually on record.
    const longestWin = wordleRows.reduce(
      (n, row) => (row.won ? Math.max(n, row.guesses.length) : n),
      0,
    );
    const distribution = new Array(Math.max(MAX_GUESSES, longestWin)).fill(0);
    let won = 0;
    for (const row of wordleRows) {
      if (row.won) {
        won++;
        const n = row.guesses.length;
        if (n >= 1) distribution[n - 1]++;
      }
    }
    wordle = { played: wordleRows.length, won, distribution };
  }

  return {
    streak: { current: streak.current, longest: streak.longest },
    activeDays: streak.activeDays,
    totalTrials: streak.totalTrials,
    lifetimeCoins: coinSum._sum.rewardAmount ?? 0,
    perfectDays: streak.perfectDayCount,
    heat,
    games,
    wordle,
    achievementsUnlocked: achievementCount,
    // A retired achievement someone still holds can push "unlocked" past the
    // live list — never show "6 of 5".
    achievementsTotal: Math.max(achievementDefs.length, achievementCount),
  };
}
