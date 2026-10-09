/**
 * Small keyed settings edited from /admin and applied live (no deploy).
 *
 * Each setting is one JSON row in `SiteSetting`; an absent row means "use the
 * default below". Reads are cached ~15s per server instance and every value is
 * re-validated on the way out, so a hand-edited or stale row can never hand the
 * games a NaN or a negative price.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { BOSS_ODDS, BOSS_ODDS_TOP, DUPLICATE_COINS, TRIAL_ODDS, type Odds, type Rarity } from "@/lib/equipment";
import { CRATE_DEFAULTS, type CrateTerms } from "@/lib/crate";

const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function readRaw(key: string): Promise<unknown> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: unknown = null;
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key } });
    value = row?.value ?? null;
  } catch (err) {
    // fail to the defaults — a settings outage must not take the site down
    logger.error("site_settings.load_failed", { key, message: String(err) });
    return hit?.value ?? null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function writeRaw(key: string, value: unknown): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  });
  cache.delete(key);
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function int(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// --- shop -------------------------------------------------------------------

export type ShopSettings = {
  open: boolean;
  /** Shown to players while the shop is closed. */
  note: string | null;
};

/** Validate a stored `shop` setting value (or null for the defaults). */
export function parseShopSettings(value: unknown): ShopSettings {
  const raw = obj(value);
  return {
    open: raw.open !== false,
    note: typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 300) : null,
  };
}

export async function getShopSettings(): Promise<ShopSettings> {
  return parseShopSettings(await readRaw("shop"));
}

export async function saveShopSettings(input: ShopSettings): Promise<void> {
  await writeRaw("shop", {
    open: input.open,
    note: input.note?.trim().slice(0, 300) || null,
  });
}

// --- geometry dash economy --------------------------------------------------

export type GeodashEconomy = {
  /** Flat entry fee for easy / medium / hard. */
  entry: number;
  /** Profit on top of the returned entry fee, per difficulty. */
  rewards: { easy: number; medium: number; hard: number };
  /** Smallest stake Impossible accepts. */
  impossibleMin: number;
  /** Impossible pays stake x this. */
  impossibleMult: number;
};

export const GEODASH_DEFAULTS: GeodashEconomy = {
  entry: envInt("GEODASH_ENTRY", 100),
  rewards: {
    easy: envInt("GEODASH_EASY_REWARD", 100),
    medium: envInt("GEODASH_MEDIUM_REWARD", 300),
    hard: envInt("GEODASH_HARD_REWARD", 500),
  },
  impossibleMin: envInt("GEODASH_IMPOSSIBLE_MIN", 5000),
  impossibleMult: 5,
};

const COIN_CAP = 10_000_000;

function cleanGeodash(raw: Record<string, unknown>): GeodashEconomy {
  const d = GEODASH_DEFAULTS;
  const r = obj(raw.rewards);
  return {
    entry: int(raw.entry, d.entry, 0, COIN_CAP),
    rewards: {
      easy: int(r.easy, d.rewards.easy, 0, COIN_CAP),
      medium: int(r.medium, d.rewards.medium, 0, COIN_CAP),
      hard: int(r.hard, d.rewards.hard, 0, COIN_CAP),
    },
    impossibleMin: int(raw.impossibleMin, d.impossibleMin, 1, COIN_CAP),
    impossibleMult: int(raw.impossibleMult, d.impossibleMult, 1, 100),
  };
}

/** Validate a stored `geodash` setting value (or null for the defaults). */
export function parseGeodashEconomy(value: unknown): GeodashEconomy {
  return cleanGeodash(obj(value));
}

export async function getGeodashEconomy(): Promise<GeodashEconomy> {
  return parseGeodashEconomy(await readRaw("geodash"));
}

export async function saveGeodashEconomy(input: unknown): Promise<GeodashEconomy> {
  const clean = cleanGeodash(obj(input));
  await writeRaw("geodash", clean);
  return clean;
}

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

// --- the pit (duels) --------------------------------------------------------

export type PitSettings = {
  open: boolean;
  /** Shown to players while the pit is closed. */
  note: string | null;
  /** Duels against the pit's champion (the CPU). */
  cpu: boolean;
  /** Challenges between players. */
  players: boolean;
  /** The share of the pot the pit keeps from a winner, in percent. */
  cut: number;
  minStake: number;
  /** Largest stake of any duel; 0 = no limit. */
  maxStake: number;
  /** Largest stake against the champion; 0 = no limit beyond `maxStake`. */
  cpuMaxStake: number;
  /** Challenges one player may have waiting at a time. */
  maxOpen: number;
};

/** The largest stake the books can hold. */
export const PIT_STAKE_CAP = 1_000_000_000_000;
export const PIT_MAX_CUT = 25;

export const PIT_DEFAULTS: PitSettings = {
  open: true,
  note: null,
  cpu: true,
  players: true,
  cut: 5,
  minStake: 100,
  maxStake: 0,
  cpuMaxStake: 0,
  maxOpen: 3,
};

/** Validate a stored `pit` setting value (or null for the defaults). */
export function parsePitSettings(value: unknown): PitSettings {
  const raw = obj(value);
  const d = PIT_DEFAULTS;
  return {
    open: raw.open !== false,
    note: typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 300) : null,
    cpu: raw.cpu !== false,
    players: raw.players !== false,
    // kept to half a percent
    cut: Math.round(num(raw.cut, d.cut, 0, PIT_MAX_CUT) * 2) / 2,
    minStake: int(raw.minStake, d.minStake, 1, PIT_STAKE_CAP),
    maxStake: int(raw.maxStake, d.maxStake, 0, PIT_STAKE_CAP),
    cpuMaxStake: int(raw.cpuMaxStake, d.cpuMaxStake, 0, PIT_STAKE_CAP),
    maxOpen: int(raw.maxOpen, d.maxOpen, 1, 10),
  };
}

export async function getPitSettings(): Promise<PitSettings> {
  return parsePitSettings(await readRaw("pit"));
}

export async function savePitSettings(input: unknown): Promise<PitSettings> {
  const clean = parsePitSettings(input);
  await writeRaw("pit", clean);
  return clean;
}

/** The largest stake a duel of this kind accepts, or null for no limit. */
export function pitStakeLimit(s: PitSettings, vs: "cpu" | "open"): number | null {
  const limits = [s.maxStake, vs === "cpu" ? s.cpuMaxStake : 0].filter((n) => n > 0);
  return limits.length ? Math.min(...limits) : null;
}

// --- equipment drops --------------------------------------------------------

export type DropSettings = {
  /** Finished trials roll for equipment. */
  trials: boolean;
  /** Slain bosses roll for equipment. */
  bosses: boolean;
  trialOdds: Odds;
  bossOdds: Odds;
  bossTopOdds: Odds;
  /** Coins paid when a piece already owned is found again. */
  duplicateCoins: Record<Rarity, number>;
};

/** The rarities each roll can give — an admin tunes the chances, not the list. */
export const DROP_ROLLS = {
  trialOdds: { label: "Each trial", base: TRIAL_ODDS },
  bossOdds: { label: "Boss: every fighter", base: BOSS_ODDS },
  bossTopOdds: { label: "Boss: the top three", base: BOSS_ODDS_TOP },
} as const;

export type DropRoll = keyof typeof DROP_ROLLS;

/** All the chances of one roll may add up to, leaving room for an amulet's luck. */
export const DROP_ODDS_CAP = 80;

function cleanOdds(raw: unknown, base: Odds): Odds {
  const r = obj(raw);
  const out: Odds = {};
  for (const key of Object.keys(base) as Rarity[]) {
    out[key] = Math.round(num(r[key], base[key] ?? 0, 0, 100) * 100) / 100;
  }
  const total = Object.values(out).reduce((n, v) => n + (v ?? 0), 0);
  // a stored row that breaks the cap is not trusted at all
  return total > DROP_ODDS_CAP ? { ...base } : out;
}

/** Validate a stored `drops` setting value (or null for the defaults). */
export function parseDropSettings(value: unknown): DropSettings {
  const raw = obj(value);
  const coins = obj(raw.duplicateCoins);
  const duplicateCoins = {} as Record<Rarity, number>;
  for (const key of Object.keys(DUPLICATE_COINS) as Rarity[]) {
    duplicateCoins[key] = int(coins[key], DUPLICATE_COINS[key], 0, COIN_CAP);
  }
  return {
    trials: raw.trials !== false,
    bosses: raw.bosses !== false,
    trialOdds: cleanOdds(raw.trialOdds, TRIAL_ODDS),
    bossOdds: cleanOdds(raw.bossOdds, BOSS_ODDS),
    bossTopOdds: cleanOdds(raw.bossTopOdds, BOSS_ODDS_TOP),
    duplicateCoins,
  };
}

export async function getDropSettings(): Promise<DropSettings> {
  return parseDropSettings(await readRaw("drops"));
}

export async function saveDropSettings(input: unknown): Promise<DropSettings> {
  const clean = parseDropSettings(input);
  await writeRaw("drops", clean);
  return clean;
}

// --- the crate --------------------------------------------------------------

export type CrateSettings = CrateTerms & {
  /** On sale in the shop. */
  open: boolean;
};

/** Validate a stored `crate` setting value (or null for the defaults). */
export function parseCrateSettings(value: unknown): CrateSettings {
  const raw = obj(value);
  const d = CRATE_DEFAULTS;
  const rawOdds = obj(raw.odds);
  const rawRefund = obj(raw.refund);
  const odds = {} as Record<Rarity, number>;
  const refund = {} as Record<Rarity, number>;
  for (const key of Object.keys(d.odds) as Rarity[]) {
    odds[key] = Math.round(num(rawOdds[key], d.odds[key], 0, 100) * 100) / 100;
    refund[key] = int(rawRefund[key], d.refund[key], 0, COIN_CAP);
  }
  const total = Object.values(odds).reduce((n, v) => n + v, 0);
  return {
    open: raw.open !== false,
    price: int(raw.price, d.price, 1, COIN_CAP),
    // chances that add up to more than a whole are not trusted at all
    odds: total > 100 ? { ...d.odds } : odds,
    refund,
  };
}

export async function getCrateSettings(): Promise<CrateSettings> {
  return parseCrateSettings(await readRaw("crate"));
}

export async function saveCrateSettings(input: unknown): Promise<CrateSettings> {
  const clean = parseCrateSettings(input);
  await writeRaw("crate", clean);
  return clean;
}
