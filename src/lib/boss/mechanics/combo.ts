/**
 * Each boss rewards a different habit with more damage. One rule set per boss,
 * shared by the server (which decides the damage) and the arena (which shows
 * the fighter where they stand without waiting on a request).
 *
 *   streak    The Silt Cardinal   lance growths in a row without a miss
 *                                 (lives with its mechanic, in weakpoint.ts)
 *   momentum  Veyrath             keep striking fast; it fades as you slow
 *   breath    Grieveth            stop, draw breath, then land heavy blows
 *   corona    Nyrrek              strike in each dark; never in the light
 *   threads   The Unraveled Saint never the same trial as your last two
 *
 * All of them top out around ×1.5 for sustained good play, the heavy blows of
 * `breath` aside, which are few.
 *
 * No server deps — safe to import from the client arenas.
 */

export type ComboKind = "streak" | "momentum" | "breath" | "corona" | "threads";

/** What the server tells a fighter about their own combo. */
export type ComboState =
  | { kind: "streak" }
  /** 0..1 — how hard they have been pressing. */
  | { kind: "momentum"; value: number }
  /** Heavy blows still in hand, and what each is worth. */
  | { kind: "breath"; blows: number; mult: number }
  /** Coronas held; and, for the dark phase `phase`, strikes landed in it. */
  | { kind: "corona"; stacks: number; phase: number; strikes: number }
  /** Trials chained, and the last two played (oldest first). */
  | { kind: "threads"; chain: number; recent: string[] };

/**
 * Which habit a boss rewards. The click-race bosses share one mechanic, so
 * they are told apart by `params.combo`, or failing that by which boss it is.
 */
export function comboKindFor(
  mechanic: string,
  templateKey: string | null | undefined,
  params: unknown,
): ComboKind {
  if (mechanic === "weakpoint") return "streak";
  if (mechanic === "eclipse") return "corona";
  if (mechanic === "miniarena") return "threads";
  const set = (params as { combo?: unknown } | null)?.combo;
  if (set === "momentum" || set === "breath") return set;
  return templateKey === "grieveth" ? "breath" : "momentum";
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

// --- momentum (Veyrath) ------------------------------------------------------

export const MOMENTUM = {
  /** Share of the click cap at which the gauge starts to rise… */
  floor: 0.4,
  /** …and the share at which it is full. */
  ceil: 0.9,
  /** Seconds for the gauge to close ~63% of the gap to where the pace puts it. */
  settleSec: 9,
  /** What a full gauge adds: ×1.5. */
  maxBonus: 0.5,
  tiers: ["Stirring", "Roused", "Wrathful", "Onslaught"],
} as const;

/** The gauge after `dtSec` at `rate` clicks a second, against a cap of `maxCps`. */
export function momentumStep(value: number, rate: number, maxCps: number, dtSec: number): number {
  const pace = Math.min(1, Math.max(0, rate) / Math.max(1, maxCps));
  const target = clamp01((pace - MOMENTUM.floor) / (MOMENTUM.ceil - MOMENTUM.floor));
  const k = 1 - Math.exp(-Math.max(0, dtSec) / MOMENTUM.settleSec);
  return clamp01(value + (target - value) * k);
}

export function momentumMult(value: number): number {
  return round2(1 + MOMENTUM.maxBonus * clamp01(value));
}

export function momentumTier(value: number): number {
  return value >= 0.98 ? 3 : value >= 0.6 ? 2 : value >= 0.25 ? 1 : 0;
}

// --- breath (Grieveth) -------------------------------------------------------

export const BREATH = {
  /** A rest shorter than this is no breath at all. */
  minMs: 1000,
  /** A rest this long is a full breath. */
  fullMs: 4000,
  /** Heavy blows a full breath buys. */
  blows: 20,
  /** What a full breath adds to each of them: ×3. */
  maxBonus: 2,
} as const;

/** The heavy blows a rest of `restMs` buys, or null if it was too short. */
export function breathFrom(restMs: number): { blows: number; mult: number } | null {
  if (!(restMs >= BREATH.minMs)) return null;
  const b = clamp01(restMs / BREATH.fullMs);
  return { blows: Math.round(BREATH.blows * b), mult: round2(1 + BREATH.maxBonus * b) };
}

/** A new breath replaces the blows in hand unless those are worth more. */
export function betterBreath(
  held: { blows: number; mult: number },
  drawn: { blows: number; mult: number } | null,
): { blows: number; mult: number } {
  if (!drawn) return held;
  return held.blows > 0 && held.mult > drawn.mult ? held : drawn;
}

// --- corona (Nyrrek) ---------------------------------------------------------

export const CORONA = {
  max: 5,
  /** What each corona adds: five make ×1.5. */
  perStack: 0.1,
  /** Strikes inside one dark phase to earn its corona. */
  strikes: 25,
  /** How far into the light a strike still counts as a late one from before.
   *  Strikes are sent in batches, so the server allows for one. */
  lightGraceMs: 3500,
} as const;

export function coronaMult(stacks: number): number {
  return round2(1 + CORONA.perStack * Math.max(0, Math.min(CORONA.max, stacks)));
}

// --- threads (The Unraveled Saint) -------------------------------------------

export const THREADS = {
  max: 4,
  /** What each thread adds: four make ×1.5. */
  perThread: 0.125,
} as const;

export function threadsMult(chain: number): number {
  return round2(1 + THREADS.perThread * Math.max(0, Math.min(THREADS.max, chain)));
}

/** A trial keeps the thread if it is neither of the last two played. */
export function keepsThread(recent: readonly string[], game: string): boolean {
  return !recent.slice(-2).includes(game);
}
