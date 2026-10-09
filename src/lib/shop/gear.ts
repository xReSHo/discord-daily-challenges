/**
 * Gear: the shop's items that are carried, not worn in Discord. Bought with
 * coins, kept in the player's pack, and used up in a raid or a trial.
 *
 * What an item *is* — its picture, what it does, how many can be carried —
 * lives here, in code, because each one is wired into the game. A piece of
 * gear is one fulfilled `Purchase` row; the pack is simply the rows not yet
 * used (see inventory.ts).
 *
 * No server deps — safe to import from client components.
 */

export type GearCategory = "raid" | "boss" | "consumable" | "trial";

export type Gear = {
  /** Stable slug — the buy key, the Purchase.itemId, and the art's file name. */
  id: string;
  name: string;
  category: GearCategory;
  /** The effect in a few characters, shown large: "+25% damage". */
  stat: string;
  /** The effect in a sentence. */
  effect: string;
  /** How long it lasts once used. */
  lasts: string;
  price: number;
  /** How many one player may carry at a time. */
  carry: number;
  /**
   * How many there are for all players together. null = no limit. Without
   * `restock` it is how many may be out at once; with it, how many are sold
   * each week.
   */
  stock: number | null;
  /** The stock is a weekly allowance: it refills when the week turns. */
  restock?: "weekly";
  /** How many one player may buy in a day or a week, whatever they carry. */
  limit?: { n: number; per: "day" | "week" };
  /** Only does anything against this boss. */
  boss?: string;
  /** A bundle: buying it puts these in the pack instead of itself. */
  contains?: string[];
  /**
   * Whether the effect is wired into the game yet. Until it is, only admins
   * can buy the item (to try the shop out); players see "Coming soon".
   */
  live: boolean;
};

export const GEAR_CATEGORIES: Record<GearCategory, { title: string; short: string; blurb: string }> = {
  raid: {
    title: "Raid gear",
    short: "Raid gear",
    blurb:
      "Bought before a raid and carried in your pack. Each piece is used up by the next raid you fight in.",
  },
  boss: {
    title: "Boss-bane gear",
    short: "Boss-bane",
    blurb: "Made against one boss each. It waits in your pack until that boss rises, then lasts the raid.",
  },
  consumable: {
    title: "Consumables",
    short: "Consumables",
    blurb:
      "Fired in the middle of a fight, when you choose. Three to a raid, a minute apart. The merchant restocks every Saturday.",
  },
  trial: {
    title: "Trial charms",
    short: "Trials",
    blurb: "For the daily trials rather than the raid.",
  },
};

/** The order the shelves stand in. */
export const GEAR_ORDER: GearCategory[] = ["raid", "boss", "consumable", "trial"];

/** The day the weekly stock refills (0 = Sunday … 6 = Saturday): raid day. */
export const RESTOCK_WEEKDAY = 6;

const RAID = { category: "raid", lasts: "One raid", carry: 1, live: false } as const;

export const GEAR: Gear[] = [
  {
    ...RAID,
    id: "whetstone",
    name: "Whetstone",
    stat: "+25% damage",
    effect: "Every blow you land in the raid deals a quarter more.",
    price: 4000,
    stock: null,
  },
  {
    ...RAID,
    id: "swift-gauntlets",
    name: "Swift Gauntlets",
    stat: "+2 clicks a second",
    effect: "Raises how fast you may strike the click-race bosses.",
    price: 5000,
    stock: null,
  },
  {
    ...RAID,
    id: "steady-hand",
    name: "Steady Hand",
    stat: "3 slips forgiven",
    effect: "The first three times your combo would break in the raid, it holds.",
    price: 3000,
    stock: null,
  },
  {
    ...RAID,
    id: "executioners-mark",
    name: "Executioner's Mark",
    stat: "+50% to finish",
    effect: "Your blows deal half again as much once the boss is under a quarter health.",
    price: 3000,
    stock: null,
  },
  {
    ...RAID,
    id: "warding-charm",
    name: "Warding Charm",
    stat: "No penalty",
    effect: "If the boss survives, you lose nothing.",
    price: 2000,
    stock: null,
  },
  {
    ...RAID,
    id: "war-horn",
    name: "War Horn",
    stat: "+10% for everyone",
    effect: "Sound it and every fighter in the raid deals a tenth more.",
    lasts: "30 min",
    price: 15000,
    stock: 3,
  },
  {
    ...RAID,
    id: "raiders-kit",
    name: "Raider's Kit",
    stat: "Three in one",
    effect: "A Whetstone, a Warding Charm and a Steady Hand, for less than they cost apart.",
    price: 7500,
    stock: null,
    contains: ["whetstone", "warding-charm", "steady-hand"],
  },
];

const BANE = { category: "boss", lasts: "One raid", carry: 1, stock: null, live: false } as const;
const USE = { category: "consumable", restock: "weekly", live: false } as const;
const TRIAL = { category: "trial", stock: null, live: false } as const;

GEAR.push(
  {
    ...BANE,
    id: "kindling",
    name: "Kindling",
    boss: "Veyrath",
    stat: "Momentum holds at half",
    effect: "Your momentum never falls below half, however long you stop to rest.",
    price: 3500,
  },
  {
    ...BANE,
    id: "deep-lungs",
    name: "Deep Lungs",
    boss: "Grieveth",
    stat: "Full breath in 3 s",
    effect: "Three seconds of rest fills your breath to the top.",
    price: 3500,
  },
  {
    ...BANE,
    id: "eclipse-shard",
    name: "Eclipse Shard",
    boss: "Nyrrek",
    stat: "Strike through the light",
    effect: "Your blows in the light land at full strength instead of being turned aside.",
    price: 4500,
  },
  {
    ...BANE,
    id: "lancers-eye",
    name: "Lancer's Eye",
    boss: "Silt Cardinal",
    stat: "Targets linger +25%",
    effect: "Every growth stays open a quarter longer before it closes.",
    price: 3500,
  },
  {
    ...BANE,
    id: "saints-hourglass",
    name: "Saint's Hourglass",
    boss: "Unraveled Saint",
    stat: "Half the wait",
    effect: "The wait between your trials against the Saint is halved.",
    price: 4500,
  },
  {
    ...USE,
    id: "flask-of-fury",
    name: "Flask of Fury",
    stat: "×2 damage",
    effect: "Drink it and every blow you land deals double.",
    lasts: "30 seconds",
    price: 2500,
    stock: 30,
    carry: 3,
  },
  {
    ...USE,
    id: "berserkers-draught",
    name: "Berserker's Draught",
    stat: "×3 damage",
    effect: "Triple damage for ten seconds, then five seconds in which you cannot strike.",
    lasts: "10 seconds",
    price: 2000,
    stock: 20,
    carry: 2,
  },
  {
    ...USE,
    id: "firebomb",
    name: "Firebomb",
    stat: "0.25% of its health",
    effect: "Thrown once: burns away a four-hundredth of the boss's full health in one blow.",
    lasts: "Instant",
    price: 2500,
    stock: 20,
    carry: 2,
  },
  {
    ...USE,
    id: "stopped-hour",
    name: "Stopped Hour",
    stat: "Combo cannot drop",
    effect: "For a minute nothing breaks your combo: not a miss, not a pause.",
    lasts: "60 seconds",
    price: 2000,
    stock: 25,
    carry: 2,
  },
  {
    ...USE,
    id: "smelling-salts",
    name: "Smelling Salts",
    stat: "Ends a stall",
    effect: "Clears a stall or a cooldown on the spot, so you can strike again at once.",
    lasts: "Instant",
    price: 1200,
    stock: 40,
    carry: 3,
  },
  {
    ...USE,
    id: "second-breath",
    name: "Second Breath",
    stat: "Full combo",
    effect: "Fills your combo to the top in an instant, whichever boss you face.",
    lasts: "Instant",
    price: 3500,
    stock: 15,
    carry: 1,
  },
  {
    ...USE,
    id: "rot-lure",
    name: "Rot Lure",
    boss: "Silt Cardinal",
    stat: "Rare targets ×3",
    effect: "Your next ten growths are three times as likely to be a rare one.",
    lasts: "10 targets",
    price: 2500,
    stock: 15,
    carry: 2,
  },
  {
    ...USE,
    id: "blood-pact",
    name: "Blood Pact",
    stat: "×2 damage, at a price",
    effect: "Double damage for two minutes. If the boss survives, your penalty is doubled too.",
    lasts: "2 minutes",
    price: 1500,
    stock: 20,
    carry: 1,
  },
  {
    ...TRIAL,
    id: "second-chance",
    name: "Second Chance",
    stat: "One more attempt",
    effect: "A second attempt at one of today's trials.",
    lasts: "One trial",
    price: 1500,
    carry: 1,
    limit: { n: 1, per: "day" },
  },
  {
    ...TRIAL,
    id: "wordle-insight",
    name: "Wordle Insight",
    stat: "Reveals a letter",
    effect: "Shows one correct letter of today's word, in its place.",
    lasts: "One puzzle",
    price: 300,
    carry: 1,
    limit: { n: 1, per: "day" },
  },
  {
    ...TRIAL,
    id: "streak-ward",
    name: "Streak Ward",
    stat: "Saves your streak",
    effect: "Miss a day and your streak holds. It is spent on its own when you need it.",
    lasts: "One missed day",
    price: 3000,
    carry: 2,
    limit: { n: 1, per: "week" },
  },
);

const BY_ID = new Map(GEAR.map((g) => [g.id, g]));

export function getGear(id: string): Gear | undefined {
  return BY_ID.get(id);
}

/** Where an item's picture lives: `${art}-160.webp` and `${art}-512.webp`. */
export function gearArt(id: string): { src: string; srcSet: string } {
  const base = `/art/items/${id}-v1`;
  return { src: `${base}-512.webp`, srcSet: `${base}-160.webp 160w, ${base}-512.webp 512w` };
}

/** What a bundle's pieces cost bought one by one. */
export function apartPrice(gear: Gear): number | null {
  if (!gear.contains) return null;
  return gear.contains.reduce((n, id) => n + (BY_ID.get(id)?.price ?? 0), 0);
}
