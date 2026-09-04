/**
 * Nyrrek, the Second Dusk — the eclipse mechanic.
 *
 * The fight moves through three phases:
 *   - neutral  — a normal hit, no multiplier. Always sits between the extremes.
 *   - dark     — the "black sun" weak-point is open; hits land at `darkMult`.
 *   - light    — the light returns; hits barely land (`lightMult`).
 *
 * The sequence is neutral → (dark | light) → neutral → (dark | light) → …, and
 * both the phase durations and the dark-vs-light choice are drawn from a seeded
 * PRNG keyed off the boss's spawn instant. So it's not periodic — the raid
 * can't just memorise a rhythm — but it IS deterministic: the server computes
 * the authoritative multiplier on every hit and the client walks the exact same
 * sequence to render an identical countdown, with no extra request.
 *
 * No server deps (no node:crypto) — safe to import from the client arena.
 */

import { hashSeed, mulberry32 } from "./prng";

export type EclipseKind = "neutral" | "dark" | "light";

export type EclipseConfig = {
  darkMult: number;
  neutralMult: number;
  lightMult: number;
  /** [min, max] duration in ms for each phase kind. */
  neutralMs: [number, number];
  darkMs: [number, number];
  lightMs: [number, number];
};

export type EclipsePhase = {
  kind: EclipseKind;
  mult: number;
  /** ms until this phase flips. */
  endsInMs: number;
  nextKind: EclipseKind;
};

// --- config parsing --------------------------------------------------

function numOr(v: unknown, fallback: number, min = 0): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min ? v : fallback;
}

function rangeOr(v: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(v) && v.length === 2) {
    const lo = Number(v[0]);
    const hi = Number(v[1]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi >= lo) {
      return [lo, hi];
    }
  }
  return fallback;
}

export function eclipseConfig(params: unknown): EclipseConfig {
  const p = (params ?? {}) as Record<string, unknown>;
  return {
    darkMult: numOr(p.darkMult, 2.5, 0),
    neutralMult: numOr(p.neutralMult, 1, 0),
    lightMult: numOr(p.lightMult, 0.15, 0),
    neutralMs: rangeOr(p.neutralMs, [16_000, 30_000]),
    darkMs: rangeOr(p.darkMs, [20_000, 38_000]),
    lightMs: rangeOr(p.lightMs, [20_000, 38_000]),
  };
}

// --- phase walk ----------------------------------------------------

function rangeFor(cfg: EclipseConfig, k: EclipseKind): [number, number] {
  return k === "dark" ? cfg.darkMs : k === "light" ? cfg.lightMs : cfg.neutralMs;
}

function multFor(cfg: EclipseConfig, k: EclipseKind): number {
  return k === "dark" ? cfg.darkMult : k === "light" ? cfg.lightMult : cfg.neutralMult;
}

const MAX_ITER = 8000; // ~8h at the shortest phase length

/**
 * The active eclipse phase at `now`. `seed` must be identical on client and
 * server — pass the boss's `spawnsAt` ISO string.
 */
export function eclipsePhaseAt(
  cfg: EclipseConfig,
  seed: string,
  spawnsAtMs: number,
  now: number,
): EclipsePhase {
  const rng = mulberry32(hashSeed(seed));
  const elapsed = Math.max(0, now - spawnsAtMs);

  let t = 0;
  let kind: EclipseKind = "neutral"; // always ramp in on a neutral phase

  for (let i = 0; i < MAX_ITER; i++) {
    const [lo, hi] = rangeFor(cfg, kind);
    const dur = Math.round(lo + rng() * (hi - lo));
    const next: EclipseKind =
      kind === "neutral" ? (rng() < 0.5 ? "dark" : "light") : "neutral";

    if (elapsed < t + dur) {
      return { kind, mult: multFor(cfg, kind), endsInMs: t + dur - elapsed, nextKind: next };
    }
    t += dur;
    kind = next;
  }

  return { kind: "neutral", mult: cfg.neutralMult, endsInMs: 5000, nextKind: "dark" };
}
