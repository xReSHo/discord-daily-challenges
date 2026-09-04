/**
 * The Silt Cardinal — the weak-point ("lance the sacs") mechanic.
 *
 * Silt-sacs surface around the portrait on a deterministic schedule seeded off
 * the boss's spawn instant: a new sac every `sacIntervalMs` at a seeded slot,
 * each alive for `sacTtlMs`. The client renders them and reports how many it
 * popped (and missed) each ~1s flush; the server re-derives how many the
 * schedule actually offered in that window and credits the smaller number, so
 * a spoofed count can't out-damage the real thing. Too many misses in a row
 * and the rot stalls the fighter for `stallMs`.
 *
 * No server deps — safe to import from the client arena.
 */

import { hashSeed } from "./prng";

export type WeakpointConfig = {
  /** Anchor positions sacs can surface at. */
  slots: number;
  sacIntervalMs: number;
  sacTtlMs: number;
  dmgPerSac: number;
  /** Consecutive-miss count that triggers a stall. */
  stallAt: number;
  stallMs: number;
  /** Server ceiling on sacs credited per second. */
  maxSacsPerSec: number;
};

export type Sac = {
  /** schedule index — stable id for a surfaced sac. */
  i: number;
  slot: number;
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
  return {
    slots: intOr(p.slots, 6, 2),
    sacIntervalMs: intOr(p.sacIntervalMs, 700, 120),
    sacTtlMs: intOr(p.sacTtlMs, 1200, 200),
    dmgPerSac: numOr(p.dmgPerSac, 0.4, 0.0001),
    stallAt: intOr(p.stallAt, 5, 1),
    stallMs: intOr(p.stallMs, 2000, 0),
    maxSacsPerSec: intOr(p.maxSacsPerSec, 3, 1),
  };
}

/** Which slot sac #i surfaces at. */
export function sacSlot(seed: string, i: number, slots: number): number {
  return hashSeed(`${seed}:sac:${i}`) % slots;
}

/** Every sac alive at `elapsedMs` (ms since spawn). */
export function liveSacs(
  cfg: WeakpointConfig,
  seed: string,
  elapsedMs: number,
): Sac[] {
  if (elapsedMs < 0) return [];
  const latest = Math.floor(elapsedMs / cfg.sacIntervalMs);
  const earliest = Math.max(
    0,
    Math.floor((elapsedMs - cfg.sacTtlMs) / cfg.sacIntervalMs),
  );
  const out: Sac[] = [];
  for (let i = earliest; i <= latest; i++) {
    const bornMs = i * cfg.sacIntervalMs;
    const diesMs = bornMs + cfg.sacTtlMs;
    if (elapsedMs >= bornMs && elapsedMs < diesMs) {
      out.push({ i, slot: sacSlot(seed, i, cfg.slots), bornMs, diesMs });
    }
  }
  return out;
}

/**
 * How many sacs the schedule surfaced in the window `(fromMs, toMs]` (ms since
 * spawn) — the server's ceiling on what a fighter can claim for that flush.
 */
export function sacsOffered(
  cfg: WeakpointConfig,
  fromMs: number,
  toMs: number,
): number {
  const from = Math.max(0, fromMs);
  if (toMs <= from) return 0;
  const first = Math.floor(from / cfg.sacIntervalMs) + 1;
  const last = Math.floor(toMs / cfg.sacIntervalMs);
  // + the sac that was already up when the window opened
  return Math.max(0, last - first + 1) + 1;
}
