/**
 * Which games a "perfect day" needs.
 *
 * Games can be switched off from /admin, so "cleared every trial" can't be a
 * fixed list any more. Each day gets a `DayRequirement` row — the games that
 * were live that day:
 *
 *   - written the first time anyone completes a game on that day;
 *   - narrowed if an admin closes or hides a game mid-day (so nobody loses a
 *     streak to a game they could no longer play);
 *   - never widened mid-day — a game switched on at 6pm starts counting
 *     tomorrow.
 *
 * A day with no row predates this table and required the original five games.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getChallengeDate } from "@/lib/challenge-date";
import type { SectionId } from "@/lib/sections";
import type { Requirements } from "@/lib/day-requirement-rule";
import { getActiveSectionIds } from "@/lib/section-status";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Days this server instance already knows have a row. */
const ensured = new Set<string>();

/** Make sure today has a requirement row. Cheap after the first call of the
 *  day; never throws (a failure only means the day falls back to "all five"). */
export async function ensureDayRequirement(): Promise<void> {
  const date = getChallengeDate();
  const key = dayKey(date);
  if (ensured.has(key)) return;
  // A local copy of the site shares the live database but may list games the
  // live site does not have yet — it must never be the one to say what today
  // requires of everyone.
  if (process.env.NODE_ENV !== "production") return;
  try {
    const sections = await getActiveSectionIds();
    await prisma.dayRequirement.upsert({
      where: { date },
      create: { date, sections },
      update: {},
    });
    ensured.add(key);
  } catch (err) {
    logger.error("day_requirement.ensure_failed", { message: String(err) });
  }
}

/** A game was just closed or hidden — stop requiring it for today. */
export async function dropFromToday(section: SectionId): Promise<void> {
  const date = getChallengeDate();
  try {
    const row = await prisma.dayRequirement.findUnique({ where: { date } });
    if (!row) {
      // No row yet: it will be created from the live set (already without
      // this game) at the first completion.
      return;
    }
    if (!row.sections.includes(section)) return;
    await prisma.dayRequirement.update({
      where: { date },
      data: { sections: row.sections.filter((s) => s !== section) },
    });
  } catch (err) {
    logger.error("day_requirement.drop_failed", { section, message: String(err) });
  }
}

/** `YYYY-MM-DD -> required games` for every recorded day on or after `since`. */
export async function getRequirements(since?: Date): Promise<Requirements> {
  const rows = await prisma.dayRequirement.findMany({
    where: since ? { date: { gte: since } } : undefined,
  });
  return new Map(rows.map((r) => [dayKey(r.date), new Set(r.sections)]));
}
