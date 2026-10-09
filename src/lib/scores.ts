/**
 * Personal-score capture. Every scored run (paid or, later, practice) drops one
 * `GameScore` row so the profile page can show a personal best without any extra
 * bookkeeping in the games themselves.
 *
 * It never throws — a logging failure must never change what the player
 * sees. A winning run awaits it *before* completing the trial, so the
 * achievement check that follows the completion can see the score.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";
import { logger } from "@/lib/logger";

export type ScoreMetric = "wpm" | "aimMs" | "litanyRound" | "geoPercent" | "brazierTouches";

/** true when a higher value is better for this metric (wpm, litany round). */
export const HIGHER_IS_BETTER: Record<ScoreMetric, boolean> = {
  wpm: true,
  aimMs: false,
  litanyRound: true,
  geoPercent: true,
  brazierTouches: false,
};

export function recordScore(
  discordId: string,
  section: string,
  metric: ScoreMetric,
  value: number,
): Promise<void> {
  if (!Number.isFinite(value)) return Promise.resolve();
  return prisma.gameScore
    .create({
      data: { discordId, section, metric, value, date: getChallengeDate() },
    })
    .then(
      () => undefined,
      (err) => logger.error("score.write_failed", { section, metric, message: String(err) }),
    );
}
