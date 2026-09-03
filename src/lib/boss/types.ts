/** Shared boss types — safe to import from client components (no server deps). */

export type BossLeader = {
  rank: number;
  name: string;
  image: string | null;
  damage: number;
  you: boolean;
};

export type BossState = {
  name: string;
  status: "upcoming" | "active" | "ended";
  maxHp: number;
  hp: number;
  dealt: number;
  slain: boolean;
  slainAt: string | null;
  resolved: boolean;
  spawnsAt: string;
  expiresAt: string;
  nextSpawnsAt: string;
  participants: number;
  top: BossLeader[];
  yourDamage: number;
  yourPayout: number | null;
  cpsCap: number;
  dmgPerClick: number;
  rewardPool: number;
  penaltyEach: number;
  /** Admin-spawned test boss — only admins see or fight it. */
  adminOnly: boolean;
  /** Whether resolving this boss moves real UnbelievaBoat coins. */
  paysOut: boolean;
  source: "weekly" | "manual";
  /** True when the viewer is an admin (they may see an adminOnly boss). */
  viewerIsAdmin: boolean;
  /** Stable per-boss key (the spawn instant) — the Discord bot dedupes on it. */
  bossKey: string;
};

export type HitResponse = {
  ok: boolean;
  error?: string;
  applied?: number;
  /** Full boss state — the hit response doubles as the poll while fighting. */
  state: BossState;
};
