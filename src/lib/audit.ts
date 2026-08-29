/**
 * Anti-cheat audit log.
 *
 * `flagAttempt` records one row per implausible submission the game logic
 * rejected (impossible speed, pasted input, robotic timing, missed clicks…).
 * Benign failures — expired session, "didn't finish", wrong day, just too
 * slow — are NOT flagged.
 *
 * It is fire-and-forget: a logging failure must never change what the player
 * sees, so the promise is intentionally not awaited by callers.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";
import { logger } from "@/lib/logger";

export function flagAttempt(
  discordId: string,
  section: string,
  reason: string,
  detail: Record<string, unknown> = {},
): void {
  logger.warn("suspicious_attempt", { discordId, section, reason, ...detail });

  prisma.suspiciousAttempt
    .create({
      data: {
        discordId,
        section,
        reason,
        detail: detail as Prisma.InputJsonValue,
        date: getChallengeDate(),
      },
    })
    .catch((err) => logger.error("audit.write_failed", { message: String(err) }));
}
