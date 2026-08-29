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
};

export type HitResponse = {
  ok: boolean;
  error?: string;
  hp?: number;
  maxHp?: number;
  dealt?: number;
  slain?: boolean;
  yourDamage?: number;
  applied?: number;
  state?: BossState;
};
