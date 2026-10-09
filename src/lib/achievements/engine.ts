/**
 * The achievement unlock engine.
 *
 * The achievements themselves are data (`AchievementDef`, edited from
 * /admin/achievements); this module turns each one's `trigger` into a query.
 * Every trigger is a read of tables that already exist and are only ever
 * written after a game's own anti-cheat has passed (`Completion`, `GameScore`,
 * `BossHit`, `GeoRun`, `Purchase`) — this adds no new anti-cheat surface. Unlocks are
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
 * Every trigger also filters on `createdAt >= ACHIEVEMENTS_LAUNCH_AT` — see
 * the constant's doc comment in catalog.ts. This deliberately does *not* use
 * `getUserStreak` from src/lib/streak.ts (that one is full-history, correct
 * for the real streak shown on the dashboard/profile/leaderboard); it recomputes
 * a launch-day-forward version with the same pure `perfectDays`/`streaksFromDays`
 * helpers instead.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { perfectDays, streaksFromDays } from "@/lib/streak";
import { getRequirements } from "@/lib/day-requirement";
import { SECTION_IDS } from "@/lib/sections";
import { addCurrency } from "@/lib/unbelievaboat";
import { grantRole } from "@/lib/discord";
import { logger } from "@/lib/logger";
import {
  ACHIEVEMENTS_LAUNCH_AT,
  SCORE_KINDS,
  type AchievementDef,
  type AchievementTrigger,
} from "./catalog";
import { getAllAchievementDefs, getEnabledAchievementDefs } from "./store";

const SINCE = { gte: ACHIEVEMENTS_LAUNCH_AT };

/** Per-evaluation memo, so several streak achievements share one query. */
type EvalCtx = { perfect?: Promise<string[]> };

/** Days (since ACHIEVEMENTS_LAUNCH_AT) on which every required trial was
 *  cleared — the same grouping `getUserStreak` does, just scoped to rows
 *  created after the cutover instead of the full 400-day lookback. */
function perfectDaysSinceLaunch(discordId: string, ctx: EvalCtx): Promise<string[]> {
  ctx.perfect ??= (async () => {
    const [rows, requirements] = await Promise.all([
      prisma.completion.findMany({
        where: {
          discordId,
          rewarded: true,
          section: { in: [...SECTION_IDS] },
          createdAt: SINCE,
        },
        select: { date: true, section: true },
      }),
      getRequirements(),
    ]);
    return perfectDays(rows, requirements);
  })();
  return ctx.perfect;
}

async function checkTrigger(
  discordId: string,
  t: AchievementTrigger,
  ctx: EvalCtx,
): Promise<boolean> {
  switch (t.type) {
    case "trials_total":
      return (
        (await prisma.completion.count({
          where: {
            discordId,
            rewarded: true,
            createdAt: SINCE,
            ...(t.section ? { section: t.section } : {}),
          },
        })) >= t.count
      );
    case "perfect_days":
      return (await perfectDaysSinceLaunch(discordId, ctx)).length >= t.count;
    case "perfect_streak":
      return streaksFromDays(await perfectDaysSinceLaunch(discordId, ctx)).longest >= t.days;
    case "score": {
      const kind = SCORE_KINDS[t.kind];
      return (
        (await prisma.gameScore.findFirst({
          where: {
            discordId,
            section: kind.section,
            metric: kind.metric,
            value: kind.op === "gte" ? { gte: t.value } : { lte: t.value, gt: 0 },
            createdAt: SINCE,
          },
          select: { id: true },
        })) != null
      );
    }
    case "wordle_guesses": {
      // A won board with few enough guesses, on a day whose Wordle was really
      // paid — so a dev-mode or unpaid board can never unlock it.
      const rows = await prisma.$queryRaw<{ ok: number }[]>`
        SELECT 1 AS ok FROM "WordleGame" g
        JOIN "Completion" c
          ON c."discordId" = g."discordId" AND c.date = g.date
          AND c.section = 'wordle' AND c.rewarded
        WHERE g."discordId" = ${discordId} AND g.won AND g.finished
          AND g."createdAt" >= ${ACHIEVEMENTS_LAUNCH_AT}
          AND cardinality(g.guesses) BETWEEN 1 AND ${t.max}
        LIMIT 1`;
      return rows.length > 0;
    }
    case "boss_slain":
      return (
        (await prisma.bossHit.count({
          where: {
            discordId,
            damage: { gt: 0 },
            boss: { slain: true },
            createdAt: SINCE,
          },
        })) >= t.count
      );
    case "geodash_wins":
      return (
        (await prisma.geoRun.count({
          where: {
            discordId,
            status: "won",
            createdAt: SINCE,
            ...(t.difficulty ? { difficulty: t.difficulty } : {}),
          },
        })) >= t.count
      );
    case "purchases":
      return (
        (await prisma.purchase.count({
          where: { discordId, status: "fulfilled", createdAt: SINCE },
        })) >= t.count
      );
    case "duel_wins":
      return (
        (await prisma.duel.count({
          where: {
            status: "done",
            OR: [
              { challengerId: discordId, winner: "challenger" },
              { opponentId: discordId, winner: "opponent" },
            ],
          },
        })) >= t.count
      );
    case "duel_mmr":
      return (
        (await prisma.duelRating.count({ where: { discordId, peak: { gte: t.count } } })) > 0
      );
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
      const roleId = def.reward.roleId;
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
    const locked = (await getEnabledAchievementDefs()).filter(
      (a) => !unlockedKeys.has(a.key),
    );

    const newlyUnlocked: AchievementDef[] = [];
    if (locked.length > 0) {
      const ctx: EvalCtx = {};
      for (const def of locked) {
        if (!(await checkTrigger(discordId, def.trigger, ctx))) continue;
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
    // Rewards are still owed for an achievement that has since been disabled.
    const allDefs = new Map((await getAllAchievementDefs()).map((d) => [d.key, d]));
    for (const row of pending) {
      const def = allDefs.get(row.key);
      if (!def) continue;
      // Claim the reward before paying it, so two checks running at once (a
      // finished trial and a page load, say) can never both pay it.
      const claim = await prisma.achievement.updateMany({
        where: { discordId, key: row.key, rewardGranted: false },
        data: { rewardGranted: true },
      });
      if (claim.count === 0) continue;
      if (!(await grantReward(discordId, def))) {
        // not delivered: hand the claim back, to be tried again next time
        await prisma.achievement
          .update({
            where: { discordId_key: { discordId, key: row.key } },
            data: { rewardGranted: false },
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

/** How long one server instance waits before checking the same player again
 *  on a page load. */
const CATCH_UP_EVERY_MS = 6 * 60 * 60 * 1000;
const caughtUp = new Map<string, number>();

/**
 * The same check, run when a signed-in player loads a page: anything they
 * earned but were never given — an unlock that was missed, a role or coins
 * that failed to arrive — is put right without them having to finish another
 * trial. Called from /api/achievements/unseen, which every page asks on load,
 * so what it unlocks is announced by that same reply. Never throws.
 */
export async function catchUpAchievements(discordId: string): Promise<void> {
  const now = Date.now();
  if (now - (caughtUp.get(discordId) ?? 0) < CATCH_UP_EVERY_MS) return;
  if (caughtUp.size > 5000) caughtUp.clear();
  caughtUp.set(discordId, now);
  await evaluateAchievements(discordId);
}

/** The highest permanent coin-boost percent among this user's unlocked
 *  achievements (0 if none). Awaited (not fire-and-forget) since it changes a
 *  real payout number; any failure falls back to 0% rather than blocking the
 *  completion it's computed for. */
export async function getActiveBoostPercent(discordId: string): Promise<number> {
  try {
    // A disabled achievement keeps paying its boost to those who earned it.
    const boosts = new Map<string, number>();
    for (const d of await getAllAchievementDefs()) {
      if (d.reward.kind === "boost") boosts.set(d.key, d.reward.percent);
    }
    if (boosts.size === 0) return 0;
    const rows = await prisma.achievement.findMany({
      where: { discordId, key: { in: [...boosts.keys()] } },
      select: { key: true },
    });
    let max = 0;
    for (const row of rows) max = Math.max(max, boosts.get(row.key) ?? 0);
    return max;
  } catch (err) {
    logger.error("achievements.boost_lookup_failed", { discordId, message: String(err) });
    return 0;
  }
}
