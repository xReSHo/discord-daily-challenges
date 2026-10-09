/**
 * Finding equipment: the roll at the end of a daily trial and when a boss
 * falls, and the record of what each player owns.
 *
 * Two tables:
 *   - `PlayerEquipment` — one row per piece a player owns. Unique on
 *     (discordId, pieceId), so the database itself guarantees nobody owns a
 *     piece twice.
 *   - `EquipmentDrop` — one row per find, unique on (discordId, source), so a
 *     trial or a raid can only ever pay out one find. A find of a piece
 *     already owned is marked `duplicate` and pays coins instead.
 *
 * Callers roll only after they have already claimed their own once-only slot
 * (the Completion row, the settled BossHit), and never let a failure here
 * undo the reward it rides on.
 */

import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addCurrency } from "@/lib/unbelievaboat";
import { logger } from "@/lib/logger";
import { getDropSettings } from "@/lib/site-settings";
import { bustGear } from "@/lib/equipment-effects";
import {
  gearOf,
  rerollsRepeats,
  dropPool,
  getPiece,
  rarityFor,
  type Odds,
  type Piece,
  type Rarity,
} from "@/lib/equipment";

export type Found = { piece: Piece; duplicate: boolean; coins: number };

/** What the "you found something" popup needs. */
export type DropToast = {
  id: string;
  pieceId: string;
  name: string;
  rarity: Rarity;
  duplicate: boolean;
  coins: number;
};

const isTaken = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** The ids of every piece a player owns. */
export async function getOwned(discordId: string): Promise<Set<string>> {
  const rows = await prisma.playerEquipment.findMany({
    where: { discordId },
    select: { pieceId: true },
  });
  return new Set(rows.map((r) => r.pieceId));
}

/** Pay the coins for a duplicate, exactly once. */
async function payDuplicate(dropId: string, discordId: string, coins: number, name: string) {
  const claim = await prisma.equipmentDrop.updateMany({
    where: { id: dropId, coinsPaid: false },
    data: { coinsPaid: true },
  });
  if (claim.count === 0) return;
  try {
    await addCurrency(discordId, coins, `Found again: ${name}`);
  } catch (err) {
    await prisma.equipmentDrop
      .updateMany({ where: { id: dropId }, data: { coinsPaid: false } })
      .catch(() => {});
    logger.error("equipment.duplicate_pay_failed", { discordId, dropId, message: String(err) });
  }
}

/**
 * One roll. `source` names what is paying out and makes the roll once-only.
 * Returns what was found, or null for nothing.
 */
async function roll(
  discordId: string,
  source: string,
  odds: Odds,
  /** Coins paid for a piece already owned, by rarity. */
  again: Record<Rarity, number>,
  boss?: string | null,
): Promise<Found | null> {
  const [owned, owed] = await Promise.all([
    getOwned(discordId),
    // coins for an earlier duplicate that failed to land: try again now
    prisma.equipmentDrop.findMany({
      where: { discordId, duplicate: true, coinsPaid: false },
      select: { id: true, coins: true, pieceId: true },
      take: 3,
    }),
  ]);
  for (const o of owed) {
    await payDuplicate(o.id, discordId, o.coins, getPiece(o.pieceId)?.name ?? "equipment");
  }

  // the amulet: its Luck stretches every chance
  const gear = gearOf(owned);
  // hundredths of a percent, from the system's secure source
  const rarity = rarityFor(odds, randomInt(10_000) / 100, gear.luck);
  if (!rarity) return null;
  const pool = dropPool(rarity, boss);
  if (pool.length === 0) return null;
  let piece = pool[randomInt(pool.length)];
  // the legendary amulet: a piece already owned is drawn once more
  if (owned.has(piece.id) && rerollsRepeats(gear)) piece = pool[randomInt(pool.length)];
  return give(discordId, source, piece, again[rarity], owned);
}

/**
 * Hand `piece` to a player from `source`, once: the piece itself if they do
 * not own it, else `againCoins`. Returns null when this source has already
 * paid out. `seen` marks the find as already shown, for a source (the crate)
 * that shows it itself instead of leaving it to the popup.
 */
export async function give(
  discordId: string,
  source: string,
  piece: Piece,
  againCoins: number,
  owned: Set<string>,
  opts: { seen?: boolean } = {},
): Promise<Found | null> {
  const rarity = piece.rarity;
  const seenAt = opts.seen ? new Date() : null;
  let duplicate = owned.has(piece.id);
  let drop: { id: string };
  try {
    drop = await prisma.equipmentDrop.create({
      data: {
        discordId,
        source,
        pieceId: piece.id,
        duplicate,
        coins: duplicate ? againCoins : 0,
        seenAt,
      },
      select: { id: true },
    });
  } catch (err) {
    if (isTaken(err)) return null; // this source has already rolled
    throw err;
  }

  if (!duplicate) {
    try {
      await prisma.playerEquipment.create({ data: { discordId, pieceId: piece.id, source } });
      bustGear(discordId); // what they wear may just have changed
    } catch (err) {
      if (!isTaken(err)) throw err;
      // found the same piece twice at the same moment: the second one is coin
      duplicate = true;
      await prisma.equipmentDrop.update({
        where: { id: drop.id },
        data: { duplicate: true, coins: againCoins },
      });
    }
  }
  const coins = duplicate ? againCoins : 0;
  if (duplicate) await payDuplicate(drop.id, discordId, coins, piece.name);

  logger.info("equipment.found", { discordId, source, pieceId: piece.id, rarity, duplicate });
  return { piece, duplicate, coins };
}

/** Pay again every repeat find whose coins never landed (up to `limit`). For the admin. */
export async function payOwedDuplicates(limit = 40): Promise<{ tried: number; left: number }> {
  const where = { duplicate: true, coinsPaid: false, coins: { gt: 0 } };
  const owed = await prisma.equipmentDrop.findMany({
    where,
    select: { id: true, discordId: true, coins: true, pieceId: true },
    take: limit,
  });
  for (const o of owed) {
    await payDuplicate(o.id, o.discordId, o.coins, getPiece(o.pieceId)?.name ?? "equipment");
  }
  return { tried: owed.length, left: await prisma.equipmentDrop.count({ where }) };
}

/** Never let a failed roll take down the reward it rides on. */
async function safely(discordId: string, source: string, run: () => Promise<Found | null>) {
  try {
    return await run();
  } catch (err) {
    logger.error("equipment.roll_failed", { discordId, source, message: String(err) });
    return null;
  }
}

/** The roll for finishing a daily trial. Call once the completion is paid. */
export function rollTrialDrop(discordId: string, section: string, date: Date): Promise<Found | null> {
  const source = `trial:${section}:${date.toISOString().slice(0, 10)}`;
  return safely(discordId, source, async () => {
    const drops = await getDropSettings();
    if (!drops.trials) return null;
    return roll(discordId, source, drops.trialOdds, drops.duplicateCoins);
  });
}

/** The roll for a fighter who took part in slaying a boss. */
export function rollBossDrop(
  discordId: string,
  boss: { id: string; templateKey: string | null },
  top: boolean,
): Promise<Found | null> {
  const source = `boss:${boss.id}`;
  return safely(discordId, source, async () => {
    const drops = await getDropSettings();
    if (!drops.bosses) return null;
    return roll(
      discordId,
      source,
      top ? drops.bossTopOdds : drops.bossOdds,
      drops.duplicateCoins,
      boss.templateKey,
    );
  });
}

/** Finds the popup has not shown yet, oldest first. */
export async function unseenDrops(discordId: string): Promise<DropToast[]> {
  const rows = await prisma.equipmentDrop.findMany({
    where: { discordId, seenAt: null },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true, pieceId: true, duplicate: true, coins: true },
  });
  const out: DropToast[] = [];
  for (const r of rows) {
    const piece = getPiece(r.pieceId);
    if (piece) out.push({ ...r, name: piece.name, rarity: piece.rarity });
  }
  return out;
}

export async function markDropsSeen(discordId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.equipmentDrop.updateMany({
    where: { discordId, id: { in: ids.slice(0, 20) }, seenAt: null },
    data: { seenAt: new Date() },
  });
}
