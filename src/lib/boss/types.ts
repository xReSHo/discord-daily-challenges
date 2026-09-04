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
  /** How this boss is fought. */
  mechanic: "clicker" | "eclipse" | "weakpoint" | "miniarena";
  /** Eclipse phase config (mechanic === "eclipse" only). The client walks the
   *  same seeded sequence from `spawnsAt` to render the live phase + countdown;
   *  the server applies the authoritative multiplier on each hit. */
  phase?: {
    darkMult: number;
    neutralMult: number;
    lightMult: number;
    neutralMs: [number, number];
    darkMs: [number, number];
    lightMs: [number, number];
  };
  /** Weak-point sac schedule (mechanic === "weakpoint" only). The client
   *  derives the live sacs from this + `spawnsAt` + `bossKey`. */
  weakpoint?: {
    slots: number;
    sacIntervalMs: number;
    sacTtlMs: number;
    dmgPerSac: number;
    stallMs: number;
  };
  /** Mini-arena trials on offer (mechanic === "miniarena" only). */
  mini?: { games: string[] };
  /** Epoch ms this fighter's cooldown lifts (weak-point stall / mini-run
   *  cooldown), or null. */
  yourCooldownUntil?: number | null;
  /** One-line "how to fight" copy for the arena + the bot spawn embed. */
  blurb: string;
  /** Portrait asset base path — `${image}.webp` / `${image}.png`. */
  image: string;
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
