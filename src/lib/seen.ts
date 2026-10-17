/**
 * When each player last opened the site (`User.lastSeenAt`). A raid boss that
 * gets away charges the players who were around that week — those seen on the
 * site or who cleared a trial — so a visit has to be on record.
 *
 * Written from /api/achievements/unseen, which every page asks on load, at
 * most every half hour per player per server instance. Never throws.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const EVERY_MS = 30 * 60_000;
const marked = new Map<string, number>();

export async function markSeen(discordId: string): Promise<void> {
  const now = Date.now();
  if (now - (marked.get(discordId) ?? 0) < EVERY_MS) return;
  if (marked.size > 5000) marked.clear();
  marked.set(discordId, now);
  try {
    await prisma.user.updateMany({
      where: {
        discordId,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now - EVERY_MS) } }],
      },
      data: { lastSeenAt: new Date(now) },
    });
  } catch (err) {
    logger.error("seen.mark_failed", { discordId, message: String(err) });
  }
}
