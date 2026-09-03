/**
 * Per-day attempt tracking for the games that limit retries (typing, aim,
 * litany). A `DailyAttempt` row is created lazily on the first failed run;
 * `fails` counts losing attempts and `failed` locks the day's challenge (out of
 * tries, or a litany gamble lost).
 *
 * Same discipline as src/lib/completions.ts: challenge-day dates, and dev mode
 * (admin replay) bypasses everything.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";
import { isDevMode } from "@/lib/dev-mode";
import { logger } from "@/lib/logger";
import { SECTION_IDS, type SectionId } from "@/lib/sections";

export type AttemptState = { fails: number; failed: boolean };

const CLEAR: AttemptState = { fails: 0, failed: false };

/** Today's fail count + lockout for one section. Dev mode → always clear. */
export async function getAttempt(
  discordId: string,
  section: SectionId,
): Promise<AttemptState> {
  if (await isDevMode(discordId)) return CLEAR;
  const row = await prisma.dailyAttempt.findUnique({
    where: {
      discordId_section_date: { discordId, section, date: getChallengeDate() },
    },
    select: { fails: true, failed: true },
  });
  return row ?? CLEAR;
}

/**
 * Record a losing attempt. When `lockAt` is given and the new fail count reaches
 * it, the day's challenge is also locked. Dev mode → no-op, returns clear.
 */
export async function recordFail(
  discordId: string,
  section: SectionId,
  opts: { lockAt?: number } = {},
): Promise<AttemptState> {
  if (await isDevMode(discordId)) return CLEAR;
  const date = getChallengeDate();

  const row = await prisma.dailyAttempt.upsert({
    where: { discordId_section_date: { discordId, section, date } },
    create: { discordId, section, date, fails: 1 },
    update: { fails: { increment: 1 } },
    select: { fails: true, failed: true },
  });

  if (opts.lockAt != null && !row.failed && row.fails >= opts.lockAt) {
    await prisma.dailyAttempt.update({
      where: { discordId_section_date: { discordId, section, date } },
      data: { failed: true },
    });
    logger.warn("challenge.failed", { discordId, section, fails: row.fails, via: "attempts" });
    return { fails: row.fails, failed: true };
  }
  return row;
}

/** Lock the day's challenge regardless of fail count (litany post-seal slip). */
export async function lockNow(
  discordId: string,
  section: SectionId,
): Promise<void> {
  if (await isDevMode(discordId)) return;
  const date = getChallengeDate();

  // Skip the write (and the log) when it's already locked — `getGameView` calls
  // this on every reload of a lost board.
  const existing = await prisma.dailyAttempt.findUnique({
    where: { discordId_section_date: { discordId, section, date } },
    select: { failed: true },
  });
  if (existing?.failed) return;

  await prisma.dailyAttempt.upsert({
    where: { discordId_section_date: { discordId, section, date } },
    create: { discordId, section, date, fails: 1, failed: true },
    update: { failed: true },
  });
  logger.warn("challenge.failed", { discordId, section, via: "lock" });
}

/** Sections this user has failed (locked) today — for the dashboard. */
export async function getFailedSectionsToday(
  discordId: string,
): Promise<Set<SectionId>> {
  if (await isDevMode(discordId)) return new Set();
  const rows = await prisma.dailyAttempt.findMany({
    where: {
      discordId,
      date: getChallengeDate(),
      failed: true,
      section: { in: [...SECTION_IDS] },
    },
    select: { section: true },
  });
  return new Set(rows.map((r) => r.section as SectionId));
}
