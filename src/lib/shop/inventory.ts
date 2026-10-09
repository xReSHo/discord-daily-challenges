/**
 * A player's pack, and buying gear into it.
 *
 * A piece of gear in the pack is a `Purchase` row with status `fulfilled` and
 * a gear id — the same ledger the role items use, so every coin spent in the
 * shop is in one place. A bundle is recorded as one `opened` row at its price,
 * plus a `fulfilled` row at 0 for each piece it held.
 *
 *   1. Reserve — `charging` rows, created in a transaction that enforces how
 *      many a player may carry and how many may be out at once.
 *   2. Charge the coins. On failure, drop the rows.
 *   3. Mark them `fulfilled`: they are in the pack.
 */

import { prisma } from "@/lib/prisma";
import { spend } from "@/lib/unbelievaboat";
import { logger } from "@/lib/logger";
import { getShopSettings } from "@/lib/site-settings";
import { GEAR, RESTOCK_WEEKDAY, getGear, type Gear } from "@/lib/shop/gear";
import { challengeDayBoundary, getChallengeDate } from "@/lib/challenge-date";

/** Rows that count as "this piece is in someone's hands". */
const HELD = ["charging", "fulfilled"];

/**
 * When the current day, or the current stock week, began. Days turn at
 * midnight in the challenge timezone; the week turns on restock day.
 */
export function periodStart(per: "day" | "week", at: Date = new Date()): Date {
  const day = getChallengeDate(at); // that calendar day, at 00:00 UTC
  const back = per === "week" ? (day.getUTCDay() - RESTOCK_WEEKDAY + 7) % 7 : 0;
  const iso = new Date(day.getTime() - back * 86_400_000).toISOString().slice(0, 10);
  return challengeDayBoundary(iso) ?? day;
}

/**
 * Which rows count against an item's stock: for a weekly allowance, every one
 * sold this week (used or not); otherwise the ones still in someone's hands.
 */
export function stockWhere(gear: Gear, at: Date = new Date()) {
  return gear.restock === "weekly"
    ? { itemId: gear.id, createdAt: { gte: periodStart("week", at) } }
    : { itemId: gear.id, status: { in: HELD } };
}

export type PackEntry = { gear: Gear; count: number };

/** What a player is carrying, in the catalog's order. */
export async function getPack(discordId: string): Promise<PackEntry[]> {
  const rows = await prisma.purchase.groupBy({
    by: ["itemId"],
    where: { discordId, status: "fulfilled", itemId: { in: GEAR.map((g) => g.id) } },
    _count: { _all: true },
  });
  const count = new Map(rows.map((r) => [r.itemId, r._count._all]));
  return GEAR.filter((g) => count.has(g.id)).map((g) => ({ gear: g, count: count.get(g.id)! }));
}

export type GearBuyResult =
  | { ok: true; newBalance: number; added: string[] }
  | { ok: false; code: number; error: string };

class BuyError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export async function buyGear(
  discordId: string,
  gear: Gear,
  opts: { devMode?: boolean; viewerIsAdmin?: boolean } = {},
): Promise<GearBuyResult> {
  if (opts.devMode) {
    return { ok: false, code: 400, error: "Dev mode is on — purchases are disabled while testing." };
  }
  if (!gear.live && !opts.viewerIsAdmin) {
    return { ok: false, code: 404, error: "That item isn't on sale yet." };
  }
  const settings = await getShopSettings();
  if (!settings.open) {
    return { ok: false, code: 503, error: settings.note || "The shop is closed right now." };
  }

  // what actually lands in the pack: the item itself, or a bundle's pieces
  const pieces = (gear.contains ?? [gear.id]).map((id) => getGear(id)).filter((g): g is Gear => !!g);

  // 1. Reserve.
  let rowIds: string[];
  try {
    rowIds = await prisma.$transaction(async (tx) => {
      const mine = await tx.purchase.groupBy({
        by: ["itemId"],
        where: { discordId, status: { in: HELD }, itemId: { in: pieces.map((p) => p.id) } },
        _count: { _all: true },
      });
      const carrying = new Map(mine.map((r) => [r.itemId, r._count._all]));
      for (const p of pieces) {
        if ((carrying.get(p.id) ?? 0) >= p.carry) {
          throw new BuyError(
            409,
            gear.contains
              ? `You already carry a ${p.name} — the kit would be wasted.`
              : p.carry === 1
                ? "You already carry one. Use it before you buy another."
                : `You can carry ${p.carry} of these at most.`,
          );
        }
      }
      if (gear.limit) {
        const { n, per } = gear.limit;
        const bought = await tx.purchase.count({
          where: { discordId, itemId: gear.id, createdAt: { gte: periodStart(per) } },
        });
        if (bought >= n) {
          throw new BuyError(
            409,
            `The merchant sells you ${n === 1 ? "one" : n} a ${per}. Come back ${per === "day" ? "tomorrow" : "next week"}.`,
          );
        }
      }
      for (const p of [gear, ...pieces.filter((x) => x.id !== gear.id)]) {
        if (p.stock == null) continue;
        const out = await tx.purchase.count({ where: stockWhere(p) });
        if (out >= p.stock) {
          throw new BuyError(
            409,
            p.restock ? `${p.name} is sold out until the merchant restocks.` : `${p.name} is sold out for now.`,
          );
        }
      }

      const ids: string[] = [];
      const make = (item: Gear, price: number) =>
        tx.purchase.create({
          data: { discordId, itemId: item.id, itemName: item.name, price, status: "charging" },
          select: { id: true },
        });
      // the row that carries the price comes first
      ids.push((await make(gear, gear.price)).id);
      if (gear.contains) for (const p of pieces) ids.push((await make(p, 0)).id);
      return ids;
    });
  } catch (err) {
    if (err instanceof BuyError) return { ok: false, code: err.code, error: err.message };
    logger.error("shop.gear_reserve_failed", { discordId, itemId: gear.id, message: String(err) });
    return { ok: false, code: 500, error: "Couldn't start the purchase. Try again." };
  }

  // 2. Charge.
  const charged = await spend(discordId, gear.price, `Shop: ${gear.name}`);
  if (!charged.ok) {
    await prisma.purchase.deleteMany({ where: { id: { in: rowIds } } }).catch(() => {});
    if (charged.reason === "insufficient") {
      return { ok: false, code: 402, error: "You don't have enough coins for this." };
    }
    if (charged.reason === "unavailable") {
      return { ok: false, code: 503, error: "The coin service isn't configured." };
    }
    return { ok: false, code: 502, error: "Couldn't reach the coin service. Try again shortly." };
  }

  // 3. Into the pack. The coins are spent, so this must not be lost: if the
  // write fails the rows stay `charging`, which the admin overview flags.
  const now = new Date();
  const [paidRow, ...pieceRows] = rowIds;
  try {
    await prisma.$transaction([
      prisma.purchase.update({
        where: { id: paidRow },
        data: {
          status: gear.contains ? "opened" : "fulfilled",
          fulfilledAt: now,
          paidCash: charged.paidCash,
          paidBank: charged.paidBank,
        },
      }),
      ...(pieceRows.length
        ? [
            prisma.purchase.updateMany({
              where: { id: { in: pieceRows } },
              data: { status: "fulfilled", fulfilledAt: now },
            }),
          ]
        : []),
    ]);
  } catch (err) {
    logger.error("shop.gear_fulfil_failed", { discordId, itemId: gear.id, rowIds, message: String(err) });
    return {
      ok: false,
      code: 500,
      error: "Your coins were taken but the item didn't land. An admin has been flagged — it will be put right.",
    };
  }

  logger.info("shop.gear_purchase", { discordId, itemId: gear.id, price: gear.price });
  return { ok: true, newBalance: charged.balance.total, added: pieces.map((p) => p.name) };
}
