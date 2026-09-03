/**
 * Boss params + weekly spawn window.
 *
 * The source of truth is the `BossConfig` singleton row, edited from
 * /admin/boss. When that row doesn't exist yet, the env vars below are the
 * defaults — so a fresh install behaves exactly as before, and the first
 * "Save" on /admin/boss writes the row.
 */

import { prisma } from "@/lib/prisma";

function num(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export type BossConfig = {
  name: string;
  maxHp: number;
  rewardPool: number;
  penalty: number;
  dmgPerClick: number;
  maxCps: number;
  /** 0 = Sunday .. 6 = Saturday. */
  spawnDow: number;
  spawnHour: number;
  despawnHour: number;
  despawnMin: number;
  weeklyEnabled: boolean;
};

/** Env-derived defaults — used until the BossConfig row is written, and to
 *  seed the /admin/boss form. */
export const BOSS_DEFAULTS: BossConfig = {
  name: process.env.BOSS_NAME || "Veyrath, The Hollow Sovereign",
  maxHp: Math.floor(num("BOSS_MAX_HP", 5000, 1)),
  rewardPool: Math.floor(num("BOSS_SLAY_REWARD", 10000, 0)),
  penalty: Math.floor(num("BOSS_FAIL_PENALTY", 2000, 0)),
  dmgPerClick: num("BOSS_DMG_PER_CLICK", 0.1, 0.0001),
  maxCps: Math.floor(num("BOSS_MAX_CPS", 10, 1)),
  spawnDow: intEnv("BOSS_SPAWN_DOW", 6, 0, 6),
  spawnHour: intEnv("BOSS_SPAWN_HOUR", 16, 0, 23),
  despawnHour: intEnv("BOSS_DESPAWN_HOUR", 23, 0, 23),
  despawnMin: intEnv("BOSS_DESPAWN_MIN", 59, 0, 59),
  weeklyEnabled: true,
};

let cache: { at: number; cfg: BossConfig } | null = null;
const CACHE_MS = 30_000;

/** Merge the DB row (if any) over the env defaults. Cached ~30s; call
 *  {@link bustBossConfigCache} after a write. */
export async function getBossConfig(): Promise<BossConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.cfg;

  let cfg = BOSS_DEFAULTS;
  try {
    const row = await prisma.bossConfig.findUnique({ where: { id: "singleton" } });
    if (row) {
      cfg = {
        name: row.name,
        maxHp: row.maxHp,
        rewardPool: row.rewardPool,
        penalty: row.penalty,
        dmgPerClick: row.dmgPerClick,
        maxCps: row.maxCps,
        spawnDow: row.spawnDow,
        spawnHour: row.spawnHour,
        despawnHour: row.despawnHour,
        despawnMin: row.despawnMin,
        weeklyEnabled: row.weeklyEnabled,
      };
    }
  } catch {
    // DB unreachable — the defaults are a fine fallback.
  }

  cache = { at: Date.now(), cfg };
  return cfg;
}

export function bustBossConfigCache(): void {
  cache = null;
}

/** Bearer token the Discord bot presents to POST /api/boss/resolve. */
export const BOSS_RESOLVE_SECRET = process.env.BOSS_RESOLVE_SECRET || "";
