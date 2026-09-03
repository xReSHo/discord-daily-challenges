/**
 * Assembles what `/shop` renders: the website's own items (see
 * src/lib/shop/website-items.ts), bought here with the coins a player has
 * banked. The coins are charged up front and the Discord bot applies the
 * effect (currently: grant a role).
 */

import { prisma } from "@/lib/prisma";
import { getBalance } from "@/lib/unbelievaboat";
import {
  WEBSITE_SHOP_ITEMS,
  isAvailable,
  type WebsiteShopItem,
} from "@/lib/shop/website-items";

/** A website item as the shop UI needs it — price plus every reason it might
 *  not be buyable right now. */
export type WebsiteShopUiItem = {
  id: string;
  name: string;
  description: string;
  emoji: string | null;
  price: number;
  /** ISO end of the availability window, if any. */
  endsAt: string | null;
  temporary: boolean;
  affordable: boolean | null;
  soldOut: boolean;
  /** This viewer already has a fulfilled purchase. */
  owned: boolean;
  /** This viewer has a purchase still being applied. */
  pending: boolean;
  /** The role isn't wired up yet (roleId ""). */
  comingSoon: boolean;
  /** All checks pass — show a live Buy button. */
  buyable: boolean;
};

export type Shop = {
  balance: { cash: number; bank: number; total: number } | null;
  items: WebsiteShopUiItem[];
};

/** Purchase state the shop needs: how many of each item are spoken for globally,
 *  and which items this viewer owns / has pending. */
async function purchaseState(discordId: string | undefined): Promise<{
  usedByItem: Map<string, number>;
  ownedByViewer: Set<string>;
  pendingByViewer: Set<string>;
}> {
  // "held" = charging (sub-second) or fulfilled with the role still active.
  const held = {
    OR: [
      { status: "charging" },
      {
        status: "fulfilled",
        roleRemoved: false,
        OR: [{ roleExpiresAt: null }, { roleExpiresAt: { gt: new Date() } }],
      },
    ],
  };
  const [used, mine] = await Promise.all([
    prisma.purchase.groupBy({ by: ["itemId"], where: held, _count: { _all: true } }),
    discordId
      ? prisma.purchase.findMany({
          where: { discordId, ...held },
          select: { itemId: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  const usedByItem = new Map(used.map((r) => [r.itemId, r._count._all]));
  const ownedByViewer = new Set<string>();
  const pendingByViewer = new Set<string>();
  for (const row of mine) {
    if (row.status === "fulfilled") ownedByViewer.add(row.itemId);
    else pendingByViewer.add(row.itemId);
  }
  return { usedByItem, ownedByViewer, pendingByViewer };
}

function toUiItem(
  item: WebsiteShopItem,
  total: number | null,
  used: number,
  owned: boolean,
  pending: boolean,
): WebsiteShopUiItem {
  const comingSoon = !item.effect.roleId;
  const soldOut = item.stock != null && used >= item.stock;
  const affordable = total == null ? null : total >= item.price;
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    emoji: item.emoji,
    price: item.price,
    endsAt: item.availableUntil ?? null,
    temporary: (item.effect.durationSec ?? 0) > 0,
    affordable,
    soldOut,
    owned,
    pending,
    comingSoon,
    buyable:
      !comingSoon && !soldOut && !owned && !pending && affordable === true,
  };
}

export async function getShop(discordId: string | undefined): Promise<Shop> {
  const [balance, state] = await Promise.all([
    discordId ? getBalance(discordId) : Promise.resolve(null),
    purchaseState(discordId),
  ]);

  const total = balance?.total ?? null;

  const items = WEBSITE_SHOP_ITEMS.filter((i) => isAvailable(i)).map((i) =>
    toUiItem(
      i,
      total,
      state.usedByItem.get(i.id) ?? 0,
      state.ownedByViewer.has(i.id),
      state.pendingByViewer.has(i.id),
    ),
  );

  return {
    balance: balance
      ? { cash: balance.cash, bank: balance.bank, total: balance.total }
      : null,
    items,
  };
}
