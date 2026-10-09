/**
 * The Reliquary: the one crate the shop sells. Opening it is a single roll
 * for a piece of equipment of any rarity — or for nothing at all.
 *
 * It is priced as a coin sink, not a slot machine. A piece the player already
 * owns pays coins back instead (`refund`), and those are set against the
 * price on purpose: a common or uncommon repeat returns less than the crate
 * cost, a rare one about the price, and only an epic or legendary repeat
 * returns more. With the odds below, four crates in ten are empty, and a
 * player who owns everything gets back under a third of what they spend, so opening crates over and over can never
 * turn a profit.
 *
 * These are the defaults; the live figures are set in /admin/equipment. An
 * amulet's luck does not apply here — the price buys exactly these odds.
 *
 * No server deps — safe to import from client components.
 */

import type { Rarity } from "@/lib/equipment";

export const CRATE_ID = "crate";
export const CRATE_NAME = "The Reliquary";

export type CrateTerms = {
  price: number;
  /** The chance of each rarity, in percent. What is left over is an empty crate. */
  odds: Record<Rarity, number>;
  /** Coins paid back when the piece inside is one already owned. */
  refund: Record<Rarity, number>;
};

export const CRATE_DEFAULTS: CrateTerms = {
  price: 5000,
  odds: { common: 34, uncommon: 17, rare: 7, epic: 1.8, legendary: 0.2 },
  refund: { common: 1000, uncommon: 2500, rare: 5500, epic: 10000, legendary: 50000 },
};

/** The chance, in percent, that a crate holds nothing. */
export function emptyChance(odds: Record<Rarity, number>): number {
  const any = Object.values(odds).reduce((n, v) => n + v, 0);
  return Math.max(0, Math.round((100 - any) * 100) / 100);
}

/**
 * What a crate pays back on average, in coins, to a player who already owns
 * every piece — the number that must stay below the price.
 */
export function repeatReturn(terms: CrateTerms): number {
  return (Object.keys(terms.odds) as Rarity[]).reduce(
    (sum, r) => sum + (terms.odds[r] / 100) * terms.refund[r],
    0,
  );
}

/** What one opening came to, as the page shows it. */
export type CrateResult = {
  outcome: "empty" | "new" | "repeat";
  /** The piece inside; unset for an empty crate. */
  piece?: { id: string; name: string; rarity: Rarity; slot: string };
  /** Coins paid back for a repeat. */
  coins: number;
  price: number;
  /** Dev mode: nothing was charged, kept or recorded. */
  practice?: boolean;
};
