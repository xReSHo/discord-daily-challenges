/**
 * The shop's items. Defined here in code (no admin UI yet). Every item is
 * bought on the site with the coins a player has banked: the price is charged
 * immediately and the Discord bot applies the effect (currently: grant a role).
 *
 * `effect.roleId` must be a Discord **role** snowflake — in Discord, right-click
 * the role → Copy ID (Developer Mode on). An item whose roleId is still ""
 * renders as "Coming soon" and can't be bought.
 *
 * `effect.durationSec` omitted / 0 → the role is permanent. Set it to a number
 * of seconds for a temporary pass (the bot strips the role when it expires).
 */

export type ShopEffect = {
  type: "grantRole";
  /** Discord role snowflake to grant on purchase. "" = not wired up yet. */
  roleId: string;
  /** Seconds the role lasts before the bot removes it. 0 / omitted = permanent. */
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
  effect: ShopEffect;
};

export const WEBSITE_SHOP_ITEMS: WebsiteShopItem[] = [
  // No wares for sale yet — the shop shows its "coming soon" state while this is
  // empty. Add items here (each needs a real `effect.roleId`) to open it.
  //
  // Example:
  // {
  //   id: "some-rank",
  //   name: "Some Rank",
  //   description: "Grants the rank in Discord.",
  //   emoji: "✨",
  //   price: 5000,
  //   effect: { type: "grantRole", roleId: "<discord role id>" },
  // },
];

export function getWebsiteShopItem(id: string): WebsiteShopItem | undefined {
  return WEBSITE_SHOP_ITEMS.find((i) => i.id === id);
}

/** Whether `item` is inside its availability window right now. */
export function isAvailable(item: WebsiteShopItem, now: Date = new Date()): boolean {
  if (item.availableFrom && now < new Date(item.availableFrom)) return false;
  if (item.availableUntil && now > new Date(item.availableUntil)) return false;
  return true;
}
