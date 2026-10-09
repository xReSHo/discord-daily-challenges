/**
 * The shop's items. They live in the `ShopItem` table and are edited from
 * /admin/shop — no deploy to add a ware, change a price or pull one off the
 * shelf. Every item is bought on the site with the coins a player has banked:
 * the price is charged immediately and the Discord bot applies the effect
 * (currently: grant a role).
 *
 * `effect.roleId` must be a Discord **role** snowflake — in Discord, right-click
 * the role → Copy ID (Developer Mode on). An item whose roleId is still ""
 * renders as "Coming soon" and can't be bought.
 *
 * `effect.durationSec` 0 → the role is permanent. Set it to a number of
 * seconds for a temporary pass (the bot strips the role when it expires).
 */

import { prisma } from "@/lib/prisma";

export type ShopEffect = {
  type: "grantRole";
  /** Discord role snowflake to grant on purchase. "" = not wired up yet. */
  roleId: string;
  /** Seconds the role lasts before the bot removes it. 0 = permanent. */
  durationSec?: number;
};

export type WebsiteShopItem = {
  /** Stable slug — used as the buy key and in the Purchase row. */
  id: string;
  name: string;
  description: string;
  emoji: string | null;
  price: number;
  /** ISO 8601. Hidden from the shop before this instant. */
  availableFrom?: string;
  /** ISO 8601. Hidden from the shop after this instant. */
  availableUntil?: string;
  /** Total units ever sellable across everyone. Omit for unlimited. */
  stock?: number;
  /** Off = not listed and not buyable. */
  enabled: boolean;
  sortOrder: number;
  effect: ShopEffect;
};

type Row = {
  id: string;
  name: string;
  description: string;
  emoji: string | null;
  price: number;
  roleId: string;
  durationSec: number;
  stock: number | null;
  // A string when the row arrived as JSON (the admin page's single query).
  availableFrom: Date | string | null;
  availableUntil: Date | string | null;
  enabled: boolean;
  sortOrder: number;
};

function iso(v: Date | string | null): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString();
  // Postgres prints `timestamp` columns without a zone; they are stored in UTC.
  return new Date(/[zZ]|[+-]\d\d(:?\d\d)?$/.test(v) ? v : `${v}Z`).toISOString();
}

/** One `ShopItem` row as a shop item — for rows a caller fetched itself. */
export function shopItemFromRow(r: unknown): WebsiteShopItem {
  return toItem(r as Row);
}

function toItem(r: Row): WebsiteShopItem {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    emoji: r.emoji,
    price: r.price,
    availableFrom: iso(r.availableFrom),
    availableUntil: iso(r.availableUntil),
    stock: r.stock ?? undefined,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
    effect: { type: "grantRole", roleId: r.roleId, durationSec: r.durationSec },
  };
}

/** Every item, including switched-off ones — for the admin page. Always read
 *  fresh: prices are money, so the shop never serves a cached one. */
export async function getAllShopItems(): Promise<WebsiteShopItem[]> {
  const rows = await prisma.shopItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toItem);
}

export async function getWebsiteShopItem(id: string): Promise<WebsiteShopItem | undefined> {
  const row = await prisma.shopItem.findUnique({ where: { id } });
  return row ? toItem(row) : undefined;
}

/** Whether `item` is switched on and inside its availability window right now. */
export function isAvailable(item: WebsiteShopItem, now: Date = new Date()): boolean {
  if (!item.enabled) return false;
  if (item.availableFrom && now < new Date(item.availableFrom)) return false;
  if (item.availableUntil && now > new Date(item.availableUntil)) return false;
  return true;
}
