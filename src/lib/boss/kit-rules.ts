/**
 * What the shop's gear does in a raid — the rules, shared by the server (which
 * decides the damage) and the arenas (which show a fighter what they carry and
 * what is working for them without waiting on a request).
 *
 *   Raid gear and boss-bane gear are *armed* by a fighter's first strike and
 *   last that raid. Consumables and the War Horn are *used* when the fighter
 *   chooses, from the arena.
 *
 * No server deps — safe to import from the client arenas.
 */

import type { ComboKind } from "./mechanics/combo";

/** Gear that works by being carried into the fight. */
export const PASSIVE_IDS = [
  "whetstone",
  "swift-gauntlets",
  "steady-hand",
  "executioners-mark",
  "warding-charm",
  "kindling",
  "deep-lungs",
  "eclipse-shard",
  "lancers-eye",
  "saints-hourglass",
] as const;

/**
 * Carried, but never armed by a strike: it stays in the pack through the raid
 * and is used up only if the boss survives, when the raid is settled. Whoever
 * holds one is covered, whether they fought or not.
 */
export const WARDING_CHARM = "warding-charm";

/** Gear that is used from the arena, when the fighter chooses. */
export const USABLE_IDS = [
  "flask-of-fury",
  "berserkers-draught",
  "blood-pact",
  "firebomb",
  "stopped-hour",
  "smelling-salts",
  "second-breath",
  "rot-lure",
  "war-horn",
] as const;

/** The draughts: more damage for a while. Only one works at a time. */
export const DRAUGHTS: Record<string, { mult: number; ms: number }> = {
  "flask-of-fury": { mult: 2, ms: 30_000 },
  "berserkers-draught": { mult: 3, ms: 10_000 },
  "blood-pact": { mult: 2, ms: 120_000 },
};

export const WHETSTONE_MULT = 1.25;
export const EXECUTE_MULT = 1.5;
/** The Executioner's Mark works under this share of the boss's health. */
export const EXECUTE_BELOW = 0.25;
export const HORN_MULT = 1.1;
export const HORN_MS = 30 * 60_000;
export const SWIFT_CPS = 2;
export const STEADY_SLIPS = 3;
export const KINDLING_FLOOR = 0.5;
export const DEEP_LUNGS_FULL_MS = 3000;
export const LANCERS_EYE_TTL = 1.25;
export const HOURGLASS_SHARE = 0.5;
/** After the Berserker's Draught, this long in which no blow lands. */
export const BERSERK_REST_MS = 5000;
export const STOPPED_HOUR_MS = 60_000;
/** The Firebomb burns this share of the boss's full health. */
export const FIREBOMB_SHARE = 0.0025;
/** Growths a Rot Lure works on, and how much likelier a rare one is. */
export const LURE_SACS = 10;
export const LURE_RARE = 3;
/** Consumables to a raid, and the wait between two. */
export const USES_PER_RAID = 3;
export const USE_GAP_MS = 60_000;
/** Strikes are sent in batches: one that left just before a draught ran out
 *  still counts, and one from just before a rest began is not thrown away. */
export const BATCH_GRACE_MS = 1500;

/** A fighter's gear in one raid. Times are epoch ms; 0 means "not in effect". */
export type Kit = {
  /** Goes up with everything used, so a stale copy can be told from a fresh one. */
  v: number;
  /** Carried gear at work in this raid. */
  on: string[];
  /** What is in the pack and can be used against this boss. */
  carry: { id: string; count: number }[];
  /** Consumables used this raid, and when the next may be. */
  used: number;
  nextUseAt: number;
  /** The draught in effect: what it multiplies damage by, and until when. */
  draughtMult: number;
  draughtUntil: number;
  /** No blow lands until this (the Berserker's Draught wearing off). */
  restUntil: number;
  /** Nothing breaks the combo until this (the Stopped Hour). */
  hourUntil: number;
  /** A Blood Pact was sworn this raid: the penalty is doubled. */
  pact: boolean;
  /** When each Rot Lure was thrown. */
  lures: number[];
  /** When Smelling Salts / a Second Breath were last used. */
  saltsAt: number;
  fillAt: number;
  /** Slips the Steady Hand will still forgive. */
  slipsLeft: number;
};

export const NO_KIT: Kit = {
  v: 0,
  on: [],
  carry: [],
  used: 0,
  nextUseAt: 0,
  draughtMult: 1,
  draughtUntil: 0,
  restUntil: 0,
  hourUntil: 0,
  pact: false,
  lures: [],
  saltsAt: 0,
  fillAt: 0,
  slipsLeft: 0,
};

/** Whether a piece of gear does anything against a boss fought this way. */
export function gearApplies(id: string, mechanic: string, combo: ComboKind): boolean {
  switch (id) {
    case "swift-gauntlets":
      return mechanic === "clicker" || mechanic === "eclipse";
    case "steady-hand":
      return combo === "streak" || combo === "corona" || combo === "threads";
    case "kindling":
      return combo === "momentum";
    case "deep-lungs":
      return combo === "breath";
    case "eclipse-shard":
      return combo === "corona";
    case "lancers-eye":
    case "rot-lure":
      return combo === "streak";
    case "saints-hourglass":
      return combo === "threads";
    case "stopped-hour":
      return combo !== "breath";
    default:
      return true;
  }
}

/** What a fighter's gear multiplies a blow by, right now. */
export function kitMult(
  kit: Kit,
  o: { hpShare: number; hornUntil: number; now: number },
): number {
  let m = 1;
  if (kit.on.includes("whetstone")) m *= WHETSTONE_MULT;
  if (kit.on.includes("executioners-mark") && o.hpShare < EXECUTE_BELOW) m *= EXECUTE_MULT;
  if (o.hornUntil > o.now) m *= HORN_MULT;
  if (kit.draughtUntil + BATCH_GRACE_MS > o.now) m *= kit.draughtMult;
  return m;
}

/** True while the fighter cannot strike (the draught wearing off). */
export function resting(kit: Kit, now: number): boolean {
  return kit.restUntil > now && now > kit.restUntil - BERSERK_REST_MS + BATCH_GRACE_MS;
}

/** True while nothing can break the fighter's combo. */
export function hourHolds(kit: Kit, now: number): boolean {
  return kit.hourUntil + BATCH_GRACE_MS > now;
}

/**
 * Whether growth #i is under a Rot Lure: each lure covers the ten growths that
 * surface after it was thrown.
 */
export function lured(lures: readonly number[], spawnMs: number, intervalMs: number, i: number): boolean {
  for (const at of lures) {
    const from = Math.floor((at - spawnMs) / intervalMs) + 1;
    if (i >= from && i < from + LURE_SACS) return true;
  }
  return false;
}
