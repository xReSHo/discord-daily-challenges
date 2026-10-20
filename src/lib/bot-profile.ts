/**
 * One player's record for the Discord bot's /profile card (cogs/profile.py):
 * the streak, totals, achievements, worn equipment and Streak Wards.
 *
 * Read-only on purpose. The /me page settles Streak Wards as it reads the
 * streak (`settleWards` may spend one); a card someone else can pull up for
 * you must never do that, so the streak here counts only wards already spent.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getRequirements } from "@/lib/day-requirement";
import { SECTION_IDS } from "@/lib/sections";
import { charmCount, wardedDays } from "@/lib/shop/charms";
import { keptDays, perfectDays, streaksFromDays, STREAK_LOOKBACK_DAYS } from "@/lib/streak";
import { getEnabledAchievementDefs } from "@/lib/achievements/store";
import { getOwned } from "@/lib/equipment-drops";
import { EQUIPMENT, SLOTS, bestLoadout, gearLines, gearOf, rarityName } from "@/lib/equipment";
import { getStreakLeaderboard } from "@/lib/leaderboard";

const DAY_MS = 86_400_000;

export type BotProfile =
  | { found: false }
  | {
      found: true;
      name: string;
      streak: { current: number; longest: number; clearedToday: boolean };
      /** place on the streak leaderboard, if listed */
      rank: number | null;
      trials: number;
      perfectDays: number;
      /** coins won from trials, all time */
      trialCoins: number;
      achievements: { unlocked: number; total: number };
      wards: number;
      gear: {
        worn: { slot: string; name: string; rarity: string }[];
        owned: number;
        total: number;
        /** what the worn pieces do, in words */
        effects: string[];
      };
    };

export async function getBotProfile(discordId: string): Promise<BotProfile> {
  const user = await prisma.user.findUnique({ where: { discordId }, select: { name: true } });
  if (!user) return { found: false };

  const today = getChallengeDateString();
  const since = new Date(Date.parse(`${today}T00:00:00.000Z`) - STREAK_LOOKBACK_DAYS * DAY_MS);

  const [rows, requirements, warded, coins, unlocked, defs, owned, wards, board] = await Promise.all([
    prisma.completion.findMany({
      where: { discordId, rewarded: true, section: { in: [...SECTION_IDS] }, date: { gte: since } },
      select: { date: true, section: true },
    }),
    getRequirements(since),
    wardedDays(discordId),
    prisma.completion.aggregate({ where: { discordId, rewarded: true }, _sum: { rewardAmount: true } }),
    prisma.achievement.count({ where: { discordId } }),
    getEnabledAchievementDefs(),
    getOwned(discordId),
    charmCount(discordId, "streak-ward"),
    getStreakLeaderboard(discordId),
  ]);

  const kept = keptDays(rows);
  const { current, longest } = streaksFromDays([...kept, ...warded]);
  const worn = bestLoadout(owned);

  return {
    found: true,
    name: user.name?.trim() || "Nameless",
    streak: { current, longest, clearedToday: kept.includes(today) },
    rank: board.find((r) => r.you)?.rank ?? null,
    trials: rows.length,
    perfectDays: perfectDays(rows, requirements).length,
    trialCoins: coins._sum.rewardAmount ?? 0,
    // a retired achievement someone still holds can push "unlocked" past the live list
    achievements: { unlocked, total: Math.max(defs.length, unlocked) },
    wards,
    gear: {
      worn: SLOTS.flatMap((s) => {
        const piece = worn[s.id];
        return piece ? [{ slot: s.name, name: piece.name, rarity: rarityName(piece.rarity) }] : [];
      }),
      owned: [...owned].filter((id) => EQUIPMENT.some((p) => p.id === id)).length,
      total: EQUIPMENT.length,
      effects: gearLines(gearOf(owned)),
    },
  };
}
