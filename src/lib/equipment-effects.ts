/**
 * A player's equipment, as the games use it (see `Gear` in ./equipment for
 * what each number does and where).
 *
 * Read from the pieces they own and kept for a minute per server instance: a
 * raid asks on every batch of strikes, and what a player owns changes a few
 * times a week. A new find clears that player's entry at once (`bustGear`).
 * A failed read is "no equipment" — it must never stop a strike or a payout.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { NO_GEAR, gearOf, type Gear } from "@/lib/equipment";

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; gear: Gear }>();

export async function getGear(discordId: string): Promise<Gear> {
  const hit = cache.get(discordId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.gear;
  try {
    const rows = await prisma.playerEquipment.findMany({ where: { discordId }, select: { pieceId: true } });
    const gear = gearOf(rows.map((r) => r.pieceId));
    cache.set(discordId, { at: Date.now(), gear });
    if (cache.size > 5000) cache.clear();
    return gear;
  } catch (err) {
    logger.error("equipment.gear_read_failed", { discordId, message: String(err) });
    return hit?.gear ?? NO_GEAR;
  }
}

export function bustGear(discordId: string): void {
  cache.delete(discordId);
}
