/**
 * The achievement unlock engine.
 *
 * Every predicate below is a read of tables that already exist and are only
 * ever written after a game's own anti-cheat has passed (`Completion`,
 * `GameScore`, `BossHit`) — this adds no new anti-cheat surface. Unlocks are
 * permanent ("have you ever...") and idempotent: the `Achievement` unique
 * constraint is the actual guard against a double unlock under a race, the
 * `unlockedKeys` filter here is just to avoid re-checking work that's already
 * settled.
 *
 * `evaluateAchievements` is meant to be called fire-and-forget (it never
 * throws) right after a real reward is paid — see src/lib/completions.ts and
 * the boss settle loop in src/lib/boss/game.ts. It also opportunistically
 * retries delivering the reward for any row still marked `rewardGranted:
 * false` (e.g. a Discord role grant that failed because the bot lacked
 * permission at the time), so a transient failure heals itself on the user's
 * next completion rather than staying broken forever.
 *
 * Every predicate also filters on `createdAt >= ACHIEVEMENTS_LAUNCH_AT` — see
 * the constant's doc comment in catalog.ts. This deliberately does *not* use
 * `getUserStreak` from src/lib/streak.ts (that one is full-history, correct
 * for the real streak shown on the dashboard/profile/leaderboard); it recomputes
 * a launch-day-forward version with the same pure `perfectDays`/`streaksFromDays`
 * helpers instead.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { perfectDays, streaksFromDays } from "@/lib/streak";
import { SECTION_IDS } from "@/lib/sections";
import { addCurrency } from "@/lib/unbelievaboat";
import { grantRole } from "@/lib/discord";
import { logger } from "@/lib/logger";
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_LAUNCH_AT,
  getAchievementDef,
  type AchievementDef,
} from "./catalog";

/** Where each `role`-reward achievement's Discord role id lives in env. Kept
 *  here (server-only) rather than in the shared catalog, which a client
 *  bundle also imports. */
const ROLE_ENV_VAR: Record<string, string> = {
  "perfect-day": "ACHIEVEMENT_DEVOUT_ROLE_ID",
};

type EvalCtx = { perfectDaysSinceLaunch: string[] };

/** Days (since ACHIEVEMENTS_LAUNCH_AT) on which every trial was cleared —
 *  the same grouping `getUserStreak` does, just scoped to rows created after
 *  the cutover instead of the full 400-day lookback. */
async function loadCtx(discordId: string): Promise<EvalCtx> {
  const rows = await prisma.completion.findMany({
    where: {
      discordId,
      rewarded: true,
      section: { in: [...SECTION_IDS] },
      createdAt: { gte: ACHIEVEMENTS_LAUNCH_AT },
    },
    select: { date: true, section: true },
  });
  return { perfectDaysSinceLaunch: perfectDays(rows) };
}

async function checkPredicate(
  discordId: string,
  def: AchievementDef,
  ctx: EvalCtx,
): Promise<boolean> {
  switch (def.key) {
    case "first-grace":
      return (
        (await prisma.completion.count({
          where: { discordId, rewarded: true, createdAt: { gte: ACHIEVEMENTS_LAUNCH_AT } },
        })) > 0
      );
    case "unbroken-week":
      return streaksFromDays(ctx.perfectDaysSinceLaunch).longest >= 7;
    case "flawless-rite":
      return (
        (await prisma.gameScore.findFirst({
          where: {
            discordId,
            section: "litany",
            metric: "litanyRound",
            value: { gte: 20 },
            createdAt: { gte: ACHIEVEMENTS_LAUNCH_AT },
          },
          select: { id: true },
        })) != null
      );
    case "raid-blooded":
      return (
        (await prisma.bossHit.findFirst({
          where: {
            discordId,
            damage: { gt: 0 },
            boss: { slain: true },
            createdAt: { gte: ACHIEVEMENTS_LAUNCH_AT },
          },
          select: { id: true },
        })) != null
      );
    case "perfect-day":
      return ctx.perfectDaysSinceLaunch.length >= 1;
    default:
      return false;
  }
}

async function grantReward(discordId: string, def: AchievementDef): Promise<boolean> {
  switch (def.reward.kind) {
    case "coins":
      try {
        await addCurrency(discordId, def.reward.amount, `Achievement: ${def.name}`);
        return true;
      } catch (err) {
        logger.error("achievements.coin_grant_failed", {
          discordId,
          key: def.key,
          message: String(err),
        });
        return false;
      }
    case "boost":
      // No external effect — the boost is derived live from the unlock
      // itself (see getActiveBoostPercent below). Nothing to retry.
      return true;
    case "role": {
      const roleId = process.env[ROLE_ENV_VAR[def.key] ?? ""];
      if (!roleId) {
        logger.warn("achievements.role_not_configured", { discordId, key: def.key });
        return false;
      }
      const result = await grantRole(discordId, roleId, `Achievement: ${def.name}`);
      if (!result.ok) {
        logger.error("achievements.role_grant_failed", {
          discordId,
          key: def.key,
          reason: result.reason,
        });
        return false;
      }
      return true;
    }
  }
}

/** Check every not-yet-unlocked achievement for `discordId`, create rows for
 *  any that now pass, and (re)attempt reward delivery for anything still
 *  unpaid. Never throws. Returns the achievements newly unlocked this call
 *  (for logging/tests — the popup itself is delivered separately, via the
 *  `seenAt`-gated /api/achievements/unseen poll). */
export async function evaluateAchievements(discordId: string): Promise<AchievementDef[]> {
  try {
    const existing = await prisma.achievement.findMany({ where: { discordId } });
    const unlockedKeys = new Set(existing.map((r) => r.key));
    const locked = ACHIEVEMENTS.filter((a) => !unlockedKeys.has(a.key));

    const newlyUnlocked: AchievementDef[] = [];
    if (locked.length > 0) {
      const ctx = await loadCtx(discordId);
      for (const def of locked) {
        if (!(await checkPredicate(discordId, def, ctx))) continue;
        try {
          await prisma.achievement.create({ data: { discordId, key: def.key } });
          newlyUnlocked.push(def);
        } catch (err) {
          const raced =
            err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
          if (!raced) throw err;
          // Another concurrent call unlocked it first — fine, nothing to do.
        }
      }
    }

    const pending = await prisma.achievement.findMany({
      where: { discordId, rewardGranted: false },
    });
    for (const row of pending) {
      const def = getAchievementDef(row.key);
      if (!def) continue;
      if (await grantReward(discordId, def)) {
        await prisma.achievement
          .update({
            where: { discordId_key: { discordId, key: row.key } },
            data: { rewardGranted: true },
          })
          .catch(() => {});
      }
    }

    return newlyUnlocked;
  } catch (err) {
    logger.error("achievements.evaluate_failed", { discordId, message: String(err) });
    return [];
  }
}

/** The highest permanent coin-boost percent among this user's unlocked
 *  achievements (0 if none). Awaited (not fire-and-forget) since it changes a
 *  real payout number; any failure falls back to 0% rather than blocking the
 *  completion it's computed for. */
export async function getActiveBoostPercent(discordId: string): Promise<number> {
  try {
    const boostKeys = ACHIEVEMENTS.filter((a) => a.reward.kind === "boost").map((a) => a.key);
    if (boostKeys.length === 0) return 0;
    const rows = await prisma.achievement.findMany({
      where: { discordId, key: { in: boostKeys } },
      select: { key: true },
    });
    let max = 0;
    for (const row of rows) {
      const def = getAchievementDef(row.key);
      if (def?.reward.kind === "boost") max = Math.max(max, def.reward.percent);
    }
    return max;
  } catch (err) {
    logger.error("achievements.boost_lookup_failed", { discordId, message: String(err) });
    return 0;
  }
}
