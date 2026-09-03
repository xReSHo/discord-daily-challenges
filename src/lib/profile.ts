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
import { MAX_GUESSES } from "@/lib/wordle/game";

const DAY_MS = 86_400_000;
/** 17 weeks — a tidy 7-row heatmap. */
export const HEAT_DAYS = 119;

export type HeatCell = { date: string; count: number };

export type GameStat = {
  id: SectionId;
  label: string;
  plays: number;
  lastPlayed: string | null;
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

  const [streak, coinSum, perGame, heatRows, bestRows, wordleRows] =
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

  // per-game
  const games: GameStat[] = SECTION_IDS.map((id) => {
    const g = perGame.find((p) => p.section === id);
    return {
      id,
      label: SECTIONS[id].label,
      plays: g?._count._all ?? 0,
      lastPlayed: g?._max.date ? dayKey(g._max.date) : null,
      best: bestFrom(bestRows, id),
    };
  });

  // wordle breakdown
  let wordle: Profile["wordle"] = null;
  if (wordleRows.length) {
    const distribution = new Array(MAX_GUESSES).fill(0);
    let won = 0;
    for (const row of wordleRows) {
      if (row.won) {
        won++;
        const n = Math.min(row.guesses.length, MAX_GUESSES);
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
  };
}
