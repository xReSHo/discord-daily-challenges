/**
 * Assembles what `/shop` renders: the website's own items (see
 * src/lib/shop/website-items.ts), bought here with the coins a player has
 * banked. The coins are charged up front and the Discord bot applies the
 * effect (currently: grant a role).
 */

import { prisma } from "@/lib/prisma";
import { getBalance } from "@/lib/unbelievaboat";
import {
  getAllShopItems,
  isAvailable,
  type WebsiteShopItem,
} from "@/lib/shop/website-items";
import { getShopSettings } from "@/lib/site-settings";
import { isAdmin } from "@/lib/admin";
import { GEAR, type Gear } from "@/lib/shop/gear";
import { periodStart } from "@/lib/shop/inventory";

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

/** A piece of gear as the shop shows it to one viewer. */
export type GearUiItem = Gear & {
  /** How many of it this viewer is carrying. */
  carrying: number;
  /** How many are left to buy across everyone. null = no limit. */
  left: number | null;
  /**
   * Why it can't be bought right now, or "buy" when it can:
   *   soon     its effect isn't in the game yet
   *   full     the viewer carries as many as allowed
   *   kitFull  a bundle, and the viewer already carries one of its pieces
   *   soldOut  none left
   *   limit    the viewer has bought their share for today / this week
   *   poor     not enough coins
   */
  state: "buy" | "soon" | "full" | "kitFull" | "soldOut" | "limit" | "poor";
  /** The viewer's coins cover it (whatever else stands in the way). */
  affordable: boolean;
  /** Shown to an admin buying something players can't yet. */
  preview: boolean;
};

export type Shop = {
  balance: { cash: number; bank: number; total: number } | null;
  items: WebsiteShopUiItem[];
  gear: GearUiItem[];
  /** An admin has closed the shop — nothing is listed or buyable. */
  closed: boolean;
  /** Player-facing reason, when closed. */
  closedNote: string | null;
};

/** Purchase state the shop needs: how many of each item are spoken for globally,
 *  and which items this viewer owns / has pending. */
async function purchaseState(discordId: string | undefined): Promise<{
  usedByItem: Map<string, number>;
  ownedByViewer: Set<string>;
  pendingByViewer: Set<string>;
  /** How many of each item this viewer holds — gear can be carried in number. */
  heldByViewer: Map<string, number>;
  /** Weekly-stock gear sold this week, by item. */
  soldThisWeek: Map<string, number>;
  /** When this viewer bought gear this week, by item. */
  boughtByViewer: Map<string, Date[]>;
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
  const week = periodStart("week");
  const weekly = GEAR.filter((g) => g.restock === "weekly").map((g) => g.id);
  const limited = GEAR.filter((g) => g.limit).map((g) => g.id);
  const [used, mine, sold, bought] = await Promise.all([
    prisma.purchase.groupBy({ by: ["itemId"], where: held, _count: { _all: true } }),
    discordId
      ? prisma.purchase.findMany({
          where: { discordId, ...held },
          select: { itemId: true, status: true },
        })
      : Promise.resolve([]),
    prisma.purchase.groupBy({
      by: ["itemId"],
      where: { itemId: { in: weekly }, createdAt: { gte: week } },
      _count: { _all: true },
    }),
    discordId
      ? prisma.purchase.findMany({
          where: { discordId, itemId: { in: limited }, createdAt: { gte: week } },
          select: { itemId: true, createdAt: true },
        })
      : Promise.resolve([]),
  ]);
  const soldThisWeek = new Map(sold.map((r) => [r.itemId, r._count._all]));
  const boughtByViewer = new Map<string, Date[]>();
  for (const row of bought) {
    boughtByViewer.set(row.itemId, [...(boughtByViewer.get(row.itemId) ?? []), row.createdAt]);
  }

  const usedByItem = new Map(used.map((r) => [r.itemId, r._count._all]));
  const ownedByViewer = new Set<string>();
  const pendingByViewer = new Set<string>();
  const heldByViewer = new Map<string, number>();
  for (const row of mine) {
    heldByViewer.set(row.itemId, (heldByViewer.get(row.itemId) ?? 0) + 1);
    if (row.status === "fulfilled") ownedByViewer.add(row.itemId);
    else pendingByViewer.add(row.itemId);
  }
  return { usedByItem, ownedByViewer, pendingByViewer, heldByViewer, soldThisWeek, boughtByViewer };
}

function toGearUi(
  gear: Gear,
  total: number | null,
  state: Awaited<ReturnType<typeof purchaseState>>,
  viewerIsAdmin: boolean,
): GearUiItem {
  const held = state.heldByViewer;
  const out = gear.restock === "weekly" ? state.soldThisWeek : state.usedByItem;
  const carrying = held.get(gear.id) ?? 0;
  const left = gear.stock == null ? null : Math.max(0, gear.stock - (out.get(gear.id) ?? 0));
  const affordable = total != null && total >= gear.price;
  const since = gear.limit ? periodStart(gear.limit.per).getTime() : 0;
  const capped =
    !!gear.limit &&
    (state.boughtByViewer.get(gear.id) ?? []).filter((d) => d.getTime() >= since).length >= gear.limit.n;
  const pieces = gear.contains?.map((id) => GEAR.find((g) => g.id === id)).filter((g): g is Gear => !!g);
  const buyState: GearUiItem["state"] =
    !gear.live && !viewerIsAdmin
      ? "soon"
      : pieces
        ? pieces.some((p) => (held.get(p.id) ?? 0) >= p.carry)
          ? "kitFull"
          : affordable
            ? "buy"
            : "poor"
        : carrying >= gear.carry
          ? "full"
          : left === 0
            ? "soldOut"
            : capped
              ? "limit"
              : affordable
                ? "buy"
                : "poor";
  return { ...gear, carrying, left, state: buyState, affordable, preview: !gear.live && viewerIsAdmin };
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
  const [balance, state, all, settings] = await Promise.all([
    discordId ? getBalance(discordId) : Promise.resolve(null),
    purchaseState(discordId),
    getAllShopItems(),
    getShopSettings(),
  ]);

  const total = balance?.total ?? null;

  const listed = settings.open ? all.filter((i) => isAvailable(i)) : [];
  const items = listed.map((i) =>
    toUiItem(
      i,
      total,
      state.usedByItem.get(i.id) ?? 0,
      state.ownedByViewer.has(i.id),
      state.pendingByViewer.has(i.id),
    ),
  );

  const viewerIsAdmin = isAdmin(discordId);
  const gear = settings.open
    ? GEAR.map((g) => toGearUi(g, total, state, viewerIsAdmin))
    : [];

  return {
    balance: balance
      ? { cash: balance.cash, bank: balance.bank, total: balance.total }
      : null,
    items,
    gear,
    closed: !settings.open,
    closedNote: settings.note,
  };
}
