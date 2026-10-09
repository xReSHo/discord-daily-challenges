/**
 * The Silt Cardinal — the weak-point ("lance the sacs") mechanic.
 *
 * Growths surface around the portrait on a deterministic schedule seeded off
 * the boss's spawn instant: a new one every `sacIntervalMs` at a seeded slot.
 * Most are plain silt-sacs; a seeded few are rarer growths worth more and
 * harder to catch ({@link SAC_KINDS}).
 *
 * The client renders them and, about once a second, reports what the fighter
 * did in order — which kinds were lanced, and every swing that found nothing.
 * The server replays that list against what the schedule really offered
 * ({@link offeredByKind}), so a made-up list can't out-damage the real thing:
 *
 *   - a lanced growth deals `dmgPerSac` × its kind × the fighter's combo;
 *   - a swing that finds nothing still grazes for `missDmg`, but ends the combo;
 *   - the combo climbs with every growth lanced in a row ({@link comboMult});
 *   - too many wild swings and the rot stalls the fighter for `stallMs`.
 *
 * No server deps — safe to import from the client arena.
 */

import { hashSeed, mulberry32 } from "./prng";

export type WeakpointConfig = {
  /** Anchor positions sacs can surface at. */
  slots: number;
  sacIntervalMs: number;
  /** How long a plain sac stays up; rarer kinds stay a share of this. */
  sacTtlMs: number;
  dmgPerSac: number;
  /** What a swing that finds nothing still deals. */
  missDmg: number;
  /** Growths lanced in a row for each step of the combo. */
  comboStep: number;
  /** What each step adds to the damage multiplier (0.1 = +10%). */
  comboBonus: number;
  /** The most the combo can multiply damage by. */
  comboMax: number;
  /** Consecutive-miss count that triggers a stall. */
  stallAt: number;
  stallMs: number;
  /** Server ceiling on sacs credited per second. */
  maxSacsPerSec: number;
};

/**
 * What can surface. `share` is how often (they sum to 1), `mult` what a lance
 * is worth, `ttl` how long it stays next to a plain sac, `size` its width as a
 * percentage of the arena. Order is the kind's number on the wire — append,
 * never reorder.
 */
export const SAC_KINDS = [
  { id: "sac", name: "Silt-sac", mult: 1, share: 0.7, ttl: 1, size: 14 },
  { id: "bloat", name: "Bloated sac", mult: 2, share: 0.19, ttl: 0.9, size: 17.5 },
  { id: "heart", name: "Rot-heart", mult: 3, share: 0.08, ttl: 0.75, size: 12.5 },
  { id: "eye", name: "Cardinal's eye", mult: 5, share: 0.03, ttl: 0.62, size: 10 },
] as const;

/** A fighter who stops lancing for this long loses the combo (client clock). */
export const COMBO_IDLE_MS = 4000;

export type Sac = {
  /** schedule index — stable id for a surfaced sac. */
  i: number;
  slot: number;
  /** Index into {@link SAC_KINDS}. */
  kind: number;
  bornMs: number;
  diesMs: number;
};

function intOr(v: unknown, fallback: number, min: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function numOr(v: unknown, fallback: number, min: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function weakpointConfig(params: unknown): WeakpointConfig {
  const p = (params ?? {}) as Record<string, unknown>;
  const dmgPerSac = numOr(p.dmgPerSac, 0.4, 0.0001);
  return {
    slots: intOr(p.slots, 6, 2),
    sacIntervalMs: intOr(p.sacIntervalMs, 700, 120),
    sacTtlMs: intOr(p.sacTtlMs, 1200, 200),
    dmgPerSac,
    // a tenth of a clean lance unless set; never more than one
    missDmg: Math.min(dmgPerSac, numOr(p.missDmg, dmgPerSac / 10, 0)),
    comboStep: intOr(p.comboStep, 10, 1),
    comboBonus: numOr(p.comboBonus, 0.1, 0),
    comboMax: Math.min(5, numOr(p.comboMax, 1.5, 1)),
    stallAt: intOr(p.stallAt, 5, 1),
    stallMs: intOr(p.stallMs, 2000, 0),
    maxSacsPerSec: intOr(p.maxSacsPerSec, 3, 1),
  };
}

/** Which slot sac #i surfaces at. */
export function sacSlot(seed: string, i: number, slots: number): number {
  return hashSeed(`${seed}:sac:${i}`) % slots;
}

/** How much likelier a rare growth is under a Rot Lure (see kit-rules.ts). */
const LURE_RARE = 3;
const RARE_SHARE = SAC_KINDS.slice(1).reduce((n, k) => n + k.share, 0);
/** What the rare kinds' shares are multiplied by under a lure. */
const LURE_SCALE = Math.min(0.95, RARE_SHARE * LURE_RARE) / RARE_SHARE;

/**
 * Which kind sac #i is — an index into {@link SAC_KINDS}. Under a Rot Lure
 * (`lure`) the same roll is read against shares that favour the rare kinds, so
 * the server and the fighter's arena still agree on every growth.
 */
export function sacKind(seed: string, i: number, lure = false): number {
  const roll = mulberry32(hashSeed(`${seed}:kind:${i}`))();
  if (lure) {
    // rare kinds first, each at its lured share; whatever is left is plain
    let edge = 0;
    for (let k = SAC_KINDS.length - 1; k >= 1; k--) {
      edge += SAC_KINDS[k].share * LURE_SCALE;
      if (roll < edge) return k;
    }
    return 0;
  }
  let edge = 0;
  for (let k = 0; k < SAC_KINDS.length; k++) {
    edge += SAC_KINDS[k].share;
    if (roll < edge) return k;
  }
  return 0;
}

/** Tells whether growth #i is under one fighter's Rot Lure. */
export type Lured = (i: number) => boolean;

/** What a combo of `combo` lances in a row multiplies damage by. */
export function comboMult(cfg: WeakpointConfig, combo: number): number {
  const steps = Math.floor(Math.max(0, combo) / cfg.comboStep);
  return Math.min(cfg.comboMax, Math.round((1 + steps * cfg.comboBonus) * 100) / 100);
}

/** Every sac alive at `elapsedMs` (ms since spawn). */
export function liveSacs(
  cfg: WeakpointConfig,
  seed: string,
  elapsedMs: number,
  lure?: Lured,
): Sac[] {
  if (elapsedMs < 0) return [];
  const latest = Math.floor(elapsedMs / cfg.sacIntervalMs);
  const earliest = Math.max(
    0,
    Math.floor((elapsedMs - cfg.sacTtlMs) / cfg.sacIntervalMs),
  );
  const out: Sac[] = [];
  for (let i = earliest; i <= latest; i++) {
    const kind = sacKind(seed, i, lure?.(i));
    const bornMs = i * cfg.sacIntervalMs;
    const diesMs = bornMs + cfg.sacTtlMs * SAC_KINDS[kind].ttl;
    if (elapsedMs >= bornMs && elapsedMs < diesMs) {
      out.push({ i, slot: sacSlot(seed, i, cfg.slots), kind, bornMs, diesMs });
    }
  }
  return out;
}

/**
 * How many sacs of each kind the schedule surfaced in the window
 * `(fromMs, toMs]` (ms since spawn), plus any still up when it opened — the
 * server's ceiling on what a fighter can claim for that flush.
 */
export function offeredByKind(
  cfg: WeakpointConfig,
  seed: string,
  fromMs: number,
  toMs: number,
  lure?: Lured,
): number[] {
  const out = SAC_KINDS.map(() => 0);
  const from = Math.max(0, fromMs);
  if (toMs <= from) return out;
  // from the oldest sac that could still have been up when the window opened
  const first = Math.max(0, Math.floor((from - cfg.sacTtlMs) / cfg.sacIntervalMs) + 1);
  const last = Math.floor(toMs / cfg.sacIntervalMs);
  // a window is a few seconds at most; the cap only guards a broken clock
  for (let i = first; i <= last && i - first < 64; i++) out[sacKind(seed, i, lure?.(i))] += 1;
  return out;
}

/** What a fighter did, in order: a kind's digit for each lance, `m` for each
 *  swing that found nothing. Anything else in the string is dropped. */
export const MAX_SEQ = 64;

export function cleanSeq(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let out = "";
  for (const ch of raw) {
    if (ch === "m" || (ch >= "0" && Number(ch) < SAC_KINDS.length)) out += ch;
    if (out.length >= MAX_SEQ) break;
  }
  return out;
}
