/**
 * Equipment: what a player wears. Six slots, and each slot owns one stat, so
 * no two pieces ever compete for the same bonus. Unlike the gear in the pack,
 * equipment is kept — it is found, not used up.
 *
 * How strong a piece is depends only on its slot and its rarity (BONUS below),
 * so there is never a choice to make: a player wears the best piece they own
 * for each slot. Pieces are found, by chance, at the end of a daily trial and
 * when a boss they fought falls (see the odds below, and equipment-drops.ts).
 * Nobody owns the same piece twice: finding one again pays coins instead.
 *
 * No server deps — safe to import from client components.
 */

export type SlotId = "sword" | "helm" | "chest" | "gauntlets" | "boots" | "amulet";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type Slot = {
  id: SlotId;
  name: string;
  /** The one stat this slot gives. */
  stat: string;
  /** What that stat does, after the number: "+6% raid damage". */
  does: string;
};

export const SLOTS: Slot[] = [
  { id: "helm", name: "Helm", stat: "Focus", does: "combo bonus in raids" },
  { id: "amulet", name: "Amulet", stat: "Luck", does: "better drop odds" },
  { id: "sword", name: "Sword", stat: "Power", does: "raid damage" },
  { id: "chest", name: "Chestplate", stat: "Ward", does: "smaller raid penalty" },
  { id: "gauntlets", name: "Gauntlets", stat: "Haste", does: "shorter stalls and waits" },
  { id: "boots", name: "Boots", stat: "Fortune", does: "coins from trials" },
];

export const RARITIES: { id: Rarity; name: string; from: string }[] = [
  { id: "common", name: "Common", from: "Daily trials" },
  { id: "uncommon", name: "Uncommon", from: "Daily trials" },
  { id: "rare", name: "Rare", from: "Slain bosses, seldom trials" },
  { id: "epic", name: "Epic", from: "Slain bosses, very seldom trials" },
  { id: "legendary", name: "Legendary", from: "Slain bosses, or a crate at long odds" },
];

const RANK: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

/** Coins paid when a piece the player already owns is found again. */
export const DUPLICATE_COINS: Record<Rarity, number> = {
  common: 1000,
  uncommon: 2500,
  rare: 5000,
  epic: 10000,
  legendary: 50000,
};

/**
 * The chance, in percent, of each rarity from one roll. What is left over is
 * the chance of finding nothing.
 */
export type Odds = Partial<Record<Rarity, number>>;

/** One roll for every daily trial completed. */
export const TRIAL_ODDS: Odds = { common: 21, uncommon: 11, rare: 3, epic: 0.75 };

/** One roll for every fighter who took part when a boss is slain. */
export const BOSS_ODDS: Odds = { rare: 45, epic: 18, legendary: 2 };

/** The three who dealt the most have twice the chance of the best two. */
export const BOSS_ODDS_TOP: Odds = { rare: 30, epic: 36, legendary: 4 };

/** Share of the boss's health a fighter must have dealt to count as taking part. */
export const BOSS_DROP_MIN_SHARE = 0.01;

/** The bonus, in percent, a piece gives: by slot, then by rarity. */
export const BONUS: Record<SlotId, Record<Rarity, number>> = {
  sword: { common: 2, uncommon: 4, rare: 6, epic: 9, legendary: 12 },
  helm: { common: 3, uncommon: 6, rare: 9, epic: 13, legendary: 18 },
  chest: { common: 4, uncommon: 8, rare: 12, epic: 18, legendary: 25 },
  gauntlets: { common: 3, uncommon: 6, rare: 9, epic: 13, legendary: 18 },
  boots: { common: 2, uncommon: 4, rare: 6, epic: 9, legendary: 12 },
  amulet: { common: 3, uncommon: 6, rare: 9, epic: 13, legendary: 18 },
};

export type Piece = {
  /** Stable slug — also the art's file name under /art/equipment. */
  id: string;
  name: string;
  slot: SlotId;
  rarity: Rarity;
  /** A legendary's own extra, in a sentence. */
  perk?: string;
  /** The BossTemplate key of the only boss that drops it. Unset = any boss. */
  boss?: string;
};

const p = (rarity: Rarity, slot: SlotId, id: string, name: string, more: Partial<Piece> = {}): Piece => ({
  id,
  name,
  slot,
  rarity,
  ...more,
});

/** Every piece that exists: one to a slot for each rarity. */
export const EQUIPMENT: Piece[] = [
  p("common", "sword", "rusted-shortsword", "Rusted Shortsword"),
  p("common", "helm", "dented-kettle-helm", "Dented Kettle Helm"),
  p("common", "chest", "patched-gambeson", "Patched Gambeson"),
  p("common", "gauntlets", "frayed-wraps", "Frayed Wraps"),
  p("common", "boots", "worn-sandals", "Worn Sandals"),
  p("common", "amulet", "bone-charm", "Bone Charm"),

  p("uncommon", "sword", "soldiers-longsword", "Soldier's Longsword"),
  p("uncommon", "helm", "watchmans-sallet", "Watchman's Sallet"),
  p("uncommon", "chest", "riveted-hauberk", "Riveted Hauberk"),
  p("uncommon", "gauntlets", "leather-bracers", "Leather Bracers"),
  p("uncommon", "boots", "pilgrims-boots", "Pilgrim's Boots"),
  p("uncommon", "amulet", "copper-reliquary", "Copper Reliquary"),

  p("rare", "sword", "oathkeepers-blade", "Oathkeeper's Blade"),
  p("rare", "helm", "scholars-circlet", "Scholar's Circlet"),
  p("rare", "chest", "penitents-cuirass", "Penitent's Cuirass"),
  p("rare", "gauntlets", "quickfinger-gloves", "Quickfinger Gloves"),
  p("rare", "boots", "wayfarers-greaves", "Wayfarer's Greaves"),
  p("rare", "amulet", "gamblers-knucklebone", "Gambler's Knucklebone"),

  p("epic", "sword", "raidbreaker", "Raidbreaker"),
  p("epic", "helm", "wardens-great-helm", "Warden's Great Helm"),
  p("epic", "chest", "bulwark-of-the-faithful", "Bulwark of the Faithful"),
  p("epic", "gauntlets", "stormgrip-gauntlets", "Stormgrip Gauntlets"),
  p("epic", "boots", "gilded-sabatons", "Gilded Sabatons"),
  p("epic", "amulet", "seers-phylactery", "Seer's Phylactery"),

  p("legendary", "sword", "veyraths-fang", "Veyrath's Fang", {
    boss: "veyrath",
    perk: "Your first 15 seconds in every raid deal a tenth more.",
  }),
  p("legendary", "helm", "crown-of-the-black-sun", "Crown of the Black Sun", {
    boss: "nyrrek",
    perk: "Your combo waits two seconds longer before it drops (the Cardinal's streak, Nyrrek's coronas).",
  }),
  p("legendary", "chest", "grieveths-ribcage", "Grieveth's Ribcage", {
    boss: "grieveth",
    perk: "No penalty at all if the boss survives under a tenth of its health.",
  }),
  p("legendary", "gauntlets", "cardinals-lancing-hand", "The Cardinal's Lancing Hand", {
    boss: "silt-cardinal",
    perk: "The first stall of each raid is skipped.",
  }),
  p("legendary", "boots", "saints-unraveled-steps", "The Saint's Unraveled Steps", {
    boss: "unraveled-saint",
    perk: "Your first trial each day pays double the Fortune bonus.",
  }),
  p("legendary", "amulet", "reliquary-of-the-faithful", "Reliquary of the Faithful", {
    perk: "A piece you already own is rolled once more before it turns to coin.",
  }),
];

const BY_ID = new Map(EQUIPMENT.map((x) => [x.id, x]));

export function getPiece(id: string): Piece | undefined {
  return BY_ID.get(id);
}

/** Where a piece's picture lives. */
export function pieceArt(id: string): { src: string; srcSet: string } {
  const base = `/art/equipment/${id}-v1`;
  return { src: `${base}-160.webp`, srcSet: `${base}-160.webp 160w, ${base}-512.webp 512w` };
}

/** What a player wears: of the pieces they own, the best for each slot. */
export function bestLoadout(owned: Iterable<string>): Loadout {
  const out: Loadout = {};
  for (const id of owned) {
    const piece = BY_ID.get(id);
    if (!piece) continue;
    const worn = out[piece.slot];
    if (!worn || RANK[piece.rarity] > RANK[worn.rarity]) out[piece.slot] = piece;
  }
  return out;
}

/**
 * Which rarity a roll lands on, or null for nothing. `roll` is a number in
 * [0, 100). Luck (a percent) stretches every chance by that much, taking the
 * room from "nothing". The best rarity is checked first.
 */
export function rarityFor(odds: Odds, roll: number, luck = 0): Rarity | null {
  const order: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
  let edge = 0;
  for (const r of order) {
    edge += (odds[r] ?? 0) * (1 + luck / 100);
    if (roll < edge) return r;
  }
  return null;
}

/** The pieces of one rarity that a source can give. `boss` is its template key. */
export function dropPool(rarity: Rarity, boss?: string | null): Piece[] {
  return EQUIPMENT.filter((x) => x.rarity === rarity && (!x.boss || x.boss === boss));
}

/** What a player has on: at most one piece to a slot. */
export type Loadout = Partial<Record<SlotId, Piece>>;

export function pieceBonus(piece: Piece): number {
  return BONUS[piece.slot][piece.rarity];
}

export function rarityName(r: Rarity): string {
  return RARITIES.find((x) => x.id === r)!.name;
}

// --- what the equipment does -------------------------------------------------

/**
 * Everything a player's equipment adds, worked out from the pieces they own:
 * the best piece of each slot counts, and a legendary brings its own extra
 * (`perks` lists the slots whose legendary is worn).
 *
 * The numbers are percentages. Where each one bites:
 *   power    sword      more damage in every raid
 *   focus    helm       a bigger combo bonus in every raid
 *   ward     chest      a smaller penalty when a boss escapes
 *   haste    gauntlets  shorter stalls, and shorter waits between a raid's trials
 *   fortune  boots      more coins from every daily trial
 *   luck     amulet     better odds on every trial and raid drop
 */
export type Gear = {
  power: number;
  focus: number;
  ward: number;
  haste: number;
  fortune: number;
  luck: number;
  perks: SlotId[];
};

export const NO_GEAR: Gear = { power: 0, focus: 0, ward: 0, haste: 0, fortune: 0, luck: 0, perks: [] };

const STAT_OF: Record<SlotId, Exclude<keyof Gear, "perks">> = {
  sword: "power",
  helm: "focus",
  chest: "ward",
  gauntlets: "haste",
  boots: "fortune",
  amulet: "luck",
};

export function gearOf(owned: Iterable<string>): Gear {
  const gear: Gear = { ...NO_GEAR, perks: [] };
  const worn = bestLoadout(owned);
  for (const slot of Object.keys(worn) as SlotId[]) {
    const piece = worn[slot]!;
    gear[STAT_OF[slot]] = BONUS[slot][piece.rarity];
    if (piece.rarity === "legendary") gear.perks.push(slot);
  }
  return gear;
}

const has = (gear: Gear, slot: SlotId) => gear.perks.includes(slot);

/** Veyrath's Fang: how long into a raid its extra tenth lasts. */
export const FANG_MS = 15_000;
/** Crown of the Black Sun: how much longer a combo waits before it drops. */
export const CROWN_GRACE_MS = 2000;
/** Grieveth's Ribcage: under this share of the boss's health left, no penalty. */
export const RIBCAGE_SHARE = 0.1;

/**
 * Raid damage after the sword. `sinceFirstMs` is how long ago this fighter
 * first struck this boss.
 */
export function withPower(dmg: number, gear: Gear, sinceFirstMs: number): number {
  const fang = has(gear, "sword") && sinceFirstMs < FANG_MS ? 1.1 : 1;
  return dmg * (1 + gear.power / 100) * fang;
}

/** A combo multiplier after the helm: the part above ×1 grows by Focus. */
export function withFocus(mult: number, gear: Gear): number {
  return mult <= 1 ? mult : 1 + (mult - 1) * (1 + gear.focus / 100);
}

/** Extra time a combo is held before it drops (the legendary helm). */
export function comboGrace(gear: Gear): number {
  return has(gear, "helm") ? CROWN_GRACE_MS : 0;
}

/** A stall or a wait, in ms, after the gauntlets. */
export function withHaste(ms: number, gear: Gear): number {
  return Math.round(ms * (1 - gear.haste / 100));
}

/** The legendary gauntlets skip the first stall of a raid. */
export function skipsFirstStall(gear: Gear): boolean {
  return has(gear, "gauntlets");
}

/**
 * The penalty for a boss that escaped, after the chestplate. `hpLeftShare` is
 * the share of its health the boss still had (0..1).
 */
export function withWard(penalty: number, gear: Gear, hpLeftShare: number): number {
  if (has(gear, "chest") && hpLeftShare < RIBCAGE_SHARE) return 0;
  return Math.round(penalty * (1 - gear.ward / 100));
}

/**
 * The percent Fortune adds to a daily trial's coins. The legendary boots
 * double it on the day's first trial.
 */
export function fortuneFor(gear: Gear, firstTrialToday: boolean): number {
  return gear.fortune * (has(gear, "boots") && firstTrialToday ? 2 : 1);
}

/** The legendary amulet draws once more when the piece found is already owned. */
export function rerollsRepeats(gear: Gear): boolean {
  return has(gear, "amulet");
}

/** A player's active effects in words, for the page: "+6% raid damage". */
export function gearLines(gear: Gear): string[] {
  const lines: string[] = [];
  if (gear.power) lines.push(`+${gear.power}% raid damage`);
  if (gear.focus) lines.push(`+${gear.focus}% combo bonus`);
  if (gear.ward) lines.push(`−${gear.ward}% raid penalty`);
  if (gear.haste) lines.push(`−${gear.haste}% stall and wait time`);
  if (gear.fortune) lines.push(`+${gear.fortune}% coins from trials`);
  if (gear.luck) lines.push(`+${gear.luck}% drop chances`);
  for (const slot of gear.perks) {
    const perk = EQUIPMENT.find((x) => x.slot === slot && x.rarity === "legendary")?.perk;
    if (perk) lines.push(perk);
  }
  return lines;
}
