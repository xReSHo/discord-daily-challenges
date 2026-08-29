/**
 * Tunables for the weekly boss. Every knob is an env var so the fight can be
 * rebalanced without a redeploy.
 */

function num(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** Boss health. Default ≈83 min for one clicker at the CPS cap. */
export const BOSS_MAX_HP = Math.floor(num("BOSS_MAX_HP", 5000, 1));

/** Damage per click. */
export const BOSS_DMG_PER_CLICK = num("BOSS_DMG_PER_CLICK", 0.1, 0.0001);

/** Server-enforced click-rate ceiling per fighter (anti-autoclicker). */
export const BOSS_MAX_CPS = Math.floor(num("BOSS_MAX_CPS", 10, 1));

/** Total bounty pool paid out on a slay, split by damage dealt. */
export const BOSS_SLAY_REWARD = Math.floor(num("BOSS_SLAY_REWARD", 10000, 0));

/** Coins each fighter loses when Veyrath survives. */
export const BOSS_FAIL_PENALTY = Math.floor(num("BOSS_FAIL_PENALTY", 2000, 0));

export const BOSS_NAME =
  process.env.BOSS_NAME || "Veyrath, The Hollow Sovereign";

/** Bearer token the bot presents to POST /api/boss/resolve. */
export const BOSS_RESOLVE_SECRET = process.env.BOSS_RESOLVE_SECRET || "";
