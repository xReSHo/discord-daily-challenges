/**
 * Opening the crate (see ./crate for what it is and why it is priced as it is).
 *
 * One opening, in order:
 *   1. a `Purchase` row is written (`charging`) — the record of the sale, and
 *      what the admin's shop log and "purchases stuck" alert read;
 *   2. the price is charged;
 *   3. the roll is made, with the system's secure random source;
 *   4. a piece is handed over through the same once-only path as a trial or
 *      raid find (`give`), keyed on this purchase — so one purchase can never
 *      hand over two pieces, and a piece already owned pays its coins instead;
 *   5. the row is marked `fulfilled`.
 *
 * If anything fails after the charge and before a piece is recorded, the price
 * is returned and the row marked `refunded`. An empty crate is a fulfilled
 * sale: that is the gamble.
 */

import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { refund, spend } from "@/lib/unbelievaboat";
import { logger } from "@/lib/logger";
import { EQUIPMENT, type Piece, type Rarity } from "@/lib/equipment";
import { getOwned, give } from "@/lib/equipment-drops";
import { getCrateSettings, getShopSettings } from "@/lib/site-settings";
import { CRATE_ID, CRATE_NAME, type CrateResult } from "@/lib/crate";

export type CrateFail = { ok: false; code: number; error: string };
const fail = (code: number, error: string): CrateFail => ({ ok: false, code, error });

/** The best rarity is checked first, so a rounding edge never favours the worst. */
const ORDER: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];

/** Which rarity a roll in [0, 100) lands on, or null for an empty crate. */
export function crateRarity(odds: Record<Rarity, number>, roll: number): Rarity | null {
  let edge = 0;
  for (const r of ORDER) {
    edge += odds[r] ?? 0;
    if (roll < edge) return r;
  }
  return null;
}

/** One roll: the piece inside, or null. Any piece of the rarity, whoever guards it. */
function draw(odds: Record<Rarity, number>): Piece | null {
  // thousandths of a percent, so a 0.2% chance is exactly that
  const rarity = crateRarity(odds, randomInt(100_000) / 1000);
  if (!rarity) return null;
  const pool = EQUIPMENT.filter((p) => p.rarity === rarity);
  return pool.length ? pool[randomInt(pool.length)] : null;
}

const shown = (piece: Piece) => ({ id: piece.id, name: piece.name, rarity: piece.rarity, slot: piece.slot });

export async function openCrate(
  discordId: string,
  opts: { devMode?: boolean } = {},
): Promise<{ ok: true; result: CrateResult } | CrateFail> {
  const [crate, shop] = await Promise.all([getCrateSettings(), getShopSettings()]);
  if (!shop.open) return fail(503, shop.note ?? "The shop is closed for now.");
  if (!crate.open) return fail(503, "The crate is not for sale right now.");
  const price = crate.price;

  // Dev mode (admin only): a practice opening. Nothing is charged, kept or recorded.
  if (opts.devMode) {
    const piece = draw(crate.odds);
    if (!piece) return { ok: true, result: { outcome: "empty", coins: 0, price, practice: true } };
    const owned = await getOwned(discordId);
    const repeat = owned.has(piece.id);
    return {
      ok: true,
      result: {
        outcome: repeat ? "repeat" : "new",
        piece: shown(piece),
        coins: repeat ? crate.refund[piece.rarity] : 0,
        price,
        practice: true,
      },
    };
  }

  const sale = await prisma.purchase.create({
    data: { discordId, itemId: CRATE_ID, itemName: CRATE_NAME, price, status: "charging" },
    select: { id: true },
  });
  const close = (status: string, error?: string) =>
    prisma.purchase
      .update({
        where: { id: sale.id },
        data: { status, error: error ?? null, fulfilledAt: status === "fulfilled" ? new Date() : null },
      })
      .catch((err) => logger.error("crate.close_failed", { id: sale.id, status, message: String(err) }));

  const charged = await spend(discordId, price, `Shop: ${CRATE_NAME}`);
  if (!charged.ok) {
    await close("failed", charged.reason);
    return charged.reason === "insufficient"
      ? fail(402, "You don't have enough coins for the crate.")
      : charged.reason === "unavailable"
        ? fail(503, "The coin service isn't configured.")
        : fail(502, "Couldn't reach the coin service. Try again shortly.");
  }
  await prisma.purchase
    .update({ where: { id: sale.id }, data: { paidCash: charged.paidCash, paidBank: charged.paidBank } })
    .catch(() => {});

  const source = `crate:${sale.id}`;
  try {
    const piece = draw(crate.odds);
    if (!piece) {
      await close("fulfilled");
      logger.info("crate.opened", { discordId, price, outcome: "empty" });
      return { ok: true, result: { outcome: "empty", coins: 0, price } };
    }
    const found = await give(discordId, source, piece, crate.refund[piece.rarity], await getOwned(discordId), {
      seen: true,
    });
    if (!found) throw new Error("this crate has already been opened");
    await close("fulfilled");
    logger.info("crate.opened", {
      discordId,
      price,
      outcome: found.duplicate ? "repeat" : "new",
      pieceId: piece.id,
      rarity: piece.rarity,
    });
    return {
      ok: true,
      result: { outcome: found.duplicate ? "repeat" : "new", piece: shown(piece), coins: found.coins, price },
    };
  } catch (err) {
    logger.error("crate.open_failed", { discordId, id: sale.id, message: String(err) });
    // Give the price back — unless a piece was recorded after all, in which
    // case the crate was opened and the sale stands.
    const recorded = await prisma.equipmentDrop
      .findUnique({ where: { discordId_source: { discordId, source } }, select: { id: true } })
      .catch(() => null);
    if (recorded) {
      await close("fulfilled");
      return fail(500, "The crate opened but couldn't be shown. Look in your equipment.");
    }
    try {
      await refund(discordId, charged.paidCash, charged.paidBank, `Shop: ${CRATE_NAME} (not opened, price returned)`);
      await close("refunded", String(err).slice(0, 200));
      return fail(500, "The crate couldn't be opened. Your coins are returned.");
    } catch (refundErr) {
      // stays `charging`, so it shows on the admin's "purchases stuck" alert
      logger.error("crate.refund_failed", { discordId, id: sale.id, message: String(refundErr) });
      return fail(500, "The crate couldn't be opened and the refund didn't go through. An admin has been flagged.");
    }
  }
}
