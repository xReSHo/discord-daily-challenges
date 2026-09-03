/**
 * Buying a website shop item.
 *
 *   1. Reserve — a `charging` Purchase row, created in a transaction that also
 *      enforces "one live purchase per user per item" and the stock cap.
 *   2. Charge the coins (cash first, then bank). On failure, drop the row.
 *   3. Grant the Discord role directly. On failure, refund and mark `refunded`.
 *   4. On success, `fulfilled` — plus `roleExpiresAt` for a temporary pass, which
 *      the bot's expiry sweep later removes.
 *
 * No polling, no pending state — the rank lands before the buy request returns.
 */

import { prisma } from "@/lib/prisma";
import { spend, refund } from "@/lib/unbelievaboat";
import { grantRole } from "@/lib/discord";
import { logger } from "@/lib/logger";
import { getWebsiteShopItem, isAvailable } from "@/lib/shop/website-items";

/** Purchase rows that count as "this item is spoken for". */
export const LIVE_PURCHASE_STATUSES = ["charging", "fulfilled"];

export type BuyResult =
  | { ok: true; newBalance: number }
  | { ok: false; code: number; error: string };

class BuyError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export async function buyWebsiteItem(
  discordId: string,
  itemId: string,
  opts: { devMode?: boolean } = {},
): Promise<BuyResult> {
  if (opts.devMode) {
    return {
      ok: false,
      code: 400,
      error: "Dev mode is on — purchases are disabled while testing.",
    };
  }

  const item = getWebsiteShopItem(itemId);
  if (!item || !item.effect.roleId || !isAvailable(item)) {
    return { ok: false, code: 404, error: "That item isn't available." };
  }
  const roleId = item.effect.roleId;
  const durationSec = item.effect.durationSec ?? 0;

  // 1. Reserve.
  let rowId: string;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const mine = await tx.purchase.findFirst({
        where: { discordId, itemId, status: { in: LIVE_PURCHASE_STATUSES } },
        select: { id: true },
      });
      if (mine) throw new BuyError(409, "You already own this.");
      if (item.stock != null) {
        const used = await tx.purchase.count({
          where: { itemId, status: { in: LIVE_PURCHASE_STATUSES } },
        });
        if (used >= item.stock) throw new BuyError(409, "This item is sold out.");
      }
      return tx.purchase.create({
        data: {
          discordId,
          itemId,
          itemName: item.name,
          price: item.price,
          roleId,
          durationSec,
          status: "charging",
        },
        select: { id: true },
      });
    });
    rowId = row.id;
  } catch (err) {
    if (err instanceof BuyError) return { ok: false, code: err.code, error: err.message };
    logger.error("shop.reserve_failed", { discordId, itemId, message: String(err) });
    return { ok: false, code: 500, error: "Couldn't start the purchase. Try again." };
  }

  // 2. Charge.
  const charged = await spend(discordId, item.price, `Shop: ${item.name}`);
  if (!charged.ok) {
    await prisma.purchase.delete({ where: { id: rowId } }).catch(() => {});
    if (charged.reason === "insufficient") {
      return { ok: false, code: 402, error: "You don't have enough coins for this." };
    }
    if (charged.reason === "unavailable") {
      return { ok: false, code: 503, error: "The coin service isn't configured." };
    }
    return { ok: false, code: 502, error: "Couldn't reach the coin service. Try again shortly." };
  }
  await prisma.purchase.update({
    where: { id: rowId },
    data: { paidCash: charged.paidCash, paidBank: charged.paidBank },
  });

  // 3. Grant the role.
  const granted = await grantRole(discordId, roleId, `Shop: ${item.name}`);
  if (!granted.ok) {
    let refunded = true;
    try {
      await refund(discordId, charged.paidCash, charged.paidBank, `Shop refund: ${item.name}`);
    } catch (err) {
      refunded = false;
      logger.error("shop.refund_failed", { id: rowId, message: String(err) });
    }
    await prisma.purchase.update({
      where: { id: rowId },
      data: { status: "refunded", error: granted.reason.slice(0, 500) },
    });
    logger.warn("shop.grant_failed", { discordId, itemId, reason: granted.reason, refunded });
    return {
      ok: false,
      code: 502,
      error: refunded
        ? "Couldn't apply the rank — your coins have been refunded."
        : "Couldn't apply the rank, and the refund also failed. Contact an admin.",
    };
  }

  // 4. Done.
  await prisma.purchase.update({
    where: { id: rowId },
    data: {
      status: "fulfilled",
      fulfilledAt: new Date(),
      roleExpiresAt:
        durationSec > 0 ? new Date(Date.now() + durationSec * 1000) : null,
    },
  });
  logger.info("shop.purchase", { discordId, itemId, price: item.price });

  return { ok: true, newBalance: charged.balance.total };
}
