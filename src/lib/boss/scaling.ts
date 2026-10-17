/**
 * Weekly boss health, scaled to how many people are playing.
 *
 * A fixed health is either a walkover in a busy week or out of reach in a quiet
 * one, and a boss that gets away charges every player around. So each weekly spawn
 * counts the players active in the days before it and gives the boss the
 * health set in /admin/boss times (active ÷ base players). The reward pool
 * follows part of the way (`rewardShare`), so a quiet week pays each fighter a
 * little more and a busy one a little less; the penalty never scales (it is
 * each player's own risk). The
 * settings live in `SiteSetting` "raid.scaling" (see src/lib/site-settings.ts).
 *
 * "Active" means signed in and either cleared a daily trial or struck a boss
 * in the window. The count and the health it gave are kept on the boss's
 * `params` (`scaledFor`, `baseHp`, `baseReward`) so the arena and the bot can
 * say so.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getRaidScaling, type RaidScaling } from "@/lib/site-settings";

const DAY_MS = 86_400_000;

/** Signed-in players who cleared a trial or hit a boss in the `days` before `at`. */
export async function countActivePlayers(at: Date, days: number): Promise<number> {
  const since = new Date(at.getTime() - days * DAY_MS);
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT c."discordId" FROM "Completion" c
        WHERE c.rewarded AND c."createdAt" >= ${since} AND c."createdAt" < ${at}
      UNION
      SELECT h."discordId" FROM "BossHit" h
        WHERE h.damage > 0 AND h."lastHitAt" >= ${since} AND h."lastHitAt" < ${at}
    ) active
    JOIN "User" u ON u."discordId" = active."discordId"`;
  return rows[0]?.n ?? 0;
}

/** A figure rounded to a tidy one: the nearest 500, or 50 below 5,000. Never
 *  below one step, unless it was nothing to begin with. */
function tidy(n: number): number {
  if (n <= 0) return 0;
  const step = n >= 5000 ? 500 : 50;
  return Math.max(step, Math.round(n / step) * step);
}

/** How far the health moves with `active` players: 1 at the base count. */
function factor(active: number, s: RaidScaling): number {
  const players = Math.max(s.minPlayers, Math.min(s.maxPlayers, active));
  return players / s.basePlayers;
}

/** The health a boss set at `base` gets with `active` players. */
export function scaledHp(base: number, active: number, s: RaidScaling): number {
  if (!s.enabled) return base;
  return tidy(base * factor(active, s));
}

/** The bounty a boss set at `base` pays with `active` players: it moves
 *  `rewardShare` percent as far as the health does. */
export function scaledReward(base: number, active: number, s: RaidScaling): number {
  if (!s.enabled) return base;
  return tidy(base * (1 + (s.rewardShare / 100) * (factor(active, s) - 1)));
}

/**
 * The health and reward pool for a weekly boss spawning at `spawnsAt`, and the
 * player count they were scaled for (null when scaling is off or the count
 * failed, in which case the boss keeps what was set).
 */
export async function weeklyScale(
  baseHp: number,
  baseReward: number,
  spawnsAt: Date,
): Promise<{ maxHp: number; rewardPool: number; scaledFor: number | null }> {
  const asSet = { maxHp: baseHp, rewardPool: baseReward, scaledFor: null };
  const s = await getRaidScaling();
  if (!s.enabled) return asSet;
  try {
    const active = await countActivePlayers(spawnsAt, s.windowDays);
    const players = Math.max(s.minPlayers, Math.min(s.maxPlayers, active));
    return {
      maxHp: scaledHp(baseHp, active, s),
      rewardPool: scaledReward(baseReward, active, s),
      scaledFor: players,
    };
  } catch (err) {
    // the raid must still spawn: fall back to the numbers as set
    logger.error("boss.scaling_failed", { message: String(err) });
    return asSet;
  }
}

/** The player count a boss was scaled for, from its `params`, or null. */
export function scaledForOf(params: unknown): number | null {
  const n = (params as { scaledFor?: unknown } | null)?.scaledFor;
  return typeof n === "number" && n > 0 ? n : null;
}
