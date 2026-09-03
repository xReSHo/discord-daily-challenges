/**
 * Personal-score capture. Every scored run (paid or, later, practice) drops one
 * `GameScore` row so the profile page can show a personal best without any extra
 * bookkeeping in the games themselves.
 *
 * Fire-and-forget, exactly like `flagAttempt` — a logging failure must never
 * change what the player sees, so callers do not await it.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";
import { logger } from "@/lib/logger";

export type ScoreMetric = "wpm" | "aimMs" | "litanyRound" | "geoPercent";

/** true when a higher value is better for this metric (wpm, litany round). */
export const HIGHER_IS_BETTER: Record<ScoreMetric, boolean> = {
  wpm: true,
  aimMs: false,
  litanyRound: true,
  geoPercent: true,
};

export function recordScore(
  discordId: string,
  section: string,
  metric: ScoreMetric,
  value: number,
): void {
  if (!Number.isFinite(value)) return;
  prisma.gameScore
    .create({
      data: { discordId, section, metric, value, date: getChallengeDate() },
    })
    .catch((err) =>
      logger.error("score.write_failed", { section, metric, message: String(err) }),
    );
}
