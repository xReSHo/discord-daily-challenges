/**
 * Read-through helper for the DailyContent table, shared by the skill games.
 *
 * Guarantees, per (section, day):
 *   - deterministic: the payload is derived from the date, so it's identical
 *     for every user without coordination
 *   - stable: the first request freezes it in the DB; later content-list edits
 *     don't change past days
 *   - cheap: served from an in-process cache after the first resolution
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getChallengeDate, getChallengeDateString } from "@/lib/challenge-date";

const cache = new Map<string, unknown>();

export async function getOrCreateDailyContent<T>(
  section: string,
  derive: (dateStr: string) => T,
): Promise<T> {
  const dateStr = getChallengeDateString();
  const cacheKey = `${section}:${dateStr}`;

  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached as T;

  const date = getChallengeDate();
  const where = { date_section: { date, section } };

  const existing = await prisma.dailyContent.findUnique({ where });
  if (existing) {
    cache.set(cacheKey, existing.payload);
    return existing.payload as T;
  }

  const payload = derive(dateStr);
  try {
    await prisma.dailyContent.create({
      data: {
        date,
        section,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const row = await prisma.dailyContent.findUniqueOrThrow({ where });
      cache.set(cacheKey, row.payload);
      return row.payload as T;
    }
    throw err;
  }

  cache.set(cacheKey, payload);
  return payload;
}
