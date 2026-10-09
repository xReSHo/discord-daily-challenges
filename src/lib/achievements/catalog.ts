/**
 * Achievement vocabulary — the shapes an achievement can take, shared by the
 * server (engine, admin) and the client (the unlock toast).
 *
 * The list of achievements itself lives in the `AchievementDef` table and is
 * edited from /admin/achievements (see ./store.ts). This module only describes
 * *what an achievement can be*: which triggers exist, which rewards exist, and
 * how to validate and describe them. `DEFAULT_ACHIEVEMENTS` seeds the table the
 * first time it is read.
 *
 * Pure data + icon components — no Prisma, no server-only imports.
 */

import { createElement, type ReactElement } from "react";
import {
  Award,
  Coins,
  Crosshair,
  Crown,
  Eye,
  Flame,
  Gem,
  Heart,
  Keyboard,
  Medal,
  Shield,
  Skull,
  Sparkles,
  Star,
  Swords,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Achievements only count progress from this instant forward — history from
 * before the feature shipped never counts, so nobody is retroactively handed an
 * achievement for things they did before it existed.
 */
export const ACHIEVEMENTS_LAUNCH_AT = new Date("2026-09-04T14:09:40.000Z");

// --- icons ------------------------------------------------------------------

export const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  flame: Flame,
  gem: Gem,
  swords: Swords,
  crown: Crown,
  trophy: Trophy,
  star: Star,
  shield: Shield,
  coins: Coins,
  crosshair: Crosshair,
  skull: Skull,
  zap: Zap,
  medal: Medal,
  keyboard: Keyboard,
  award: Award,
  heart: Heart,
  eye: Eye,
};

export const ACHIEVEMENT_ICON_NAMES = Object.keys(ACHIEVEMENT_ICONS);

/** Render an achievement's icon by its stored name (unknown names fall back
 *  to the sparkle). */
export function AchievementIcon({
  name,
  size,
  strokeWidth,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
}): ReactElement {
  return createElement(ACHIEVEMENT_ICONS[name] ?? Sparkles, { size, strokeWidth });
}

// --- triggers ---------------------------------------------------------------

/** A score threshold an achievement can ask for. `op` is the direction that
 *  counts as "better" for that metric. */
export const SCORE_KINDS = {
  wpm: { section: "typing", metric: "wpm", op: "gte", label: "Typing speed (WPM) of at least" },
  aimMs: { section: "aim", metric: "aimMs", op: "lte", label: "Aim Trainer time (ms) of at most" },
  litanyRound: { section: "litany", metric: "litanyRound", op: "gte", label: "Litany round of at least" },
  geoPercent: { section: "geodash", metric: "geoPercent", op: "gte", label: "Geometry Dash distance (%) of at least" },
  brazierTouches: { section: "braziers", metric: "brazierTouches", op: "lte", label: "Braziers lit in touches of at most" },
} as const;

export type ScoreKind = keyof typeof SCORE_KINDS;

export const GAME_IDS = ["wordle", "typing", "aim", "litany", "geodash", "braziers"] as const;
export const GEO_DIFFICULTIES = ["easy", "medium", "hard", "impossible"] as const;

export type AchievementTrigger =
  /** Clear `count` daily trials (optionally only of one game). */
  | { type: "trials_total"; count: number; section?: string }
  /** Have `count` perfect days (every live game cleared). */
  | { type: "perfect_days"; count: number }
  /** A run of `days` perfect days in a row. */
  | { type: "perfect_streak"; days: number }
  /** Reach a score threshold in one game. */
  | { type: "score"; kind: ScoreKind; value: number }
  /** Solve a day's Wordle in at most `max` guesses. */
  | { type: "wordle_guesses"; max: number }
  /** Deal damage to `count` weekly bosses that were slain. */
  | { type: "boss_slain"; count: number }
  /** Clear Geometry Dash `count` times (optionally on one difficulty). */
  | { type: "geodash_wins"; count: number; difficulty?: string }
  /** Buy `count` items from the shop. */
  | { type: "purchases"; count: number }
  /** Win `count` duels in the pit, against players or its champion. */
  | { type: "duel_wins"; count: number }
  /** Reach a standing (MMR) of at least `value` in the pit. */
  | { type: "duel_mmr"; count: number };

export const TRIGGER_TYPES: { type: AchievementTrigger["type"]; label: string }[] = [
  { type: "trials_total", label: "Clear a number of trials" },
  { type: "perfect_days", label: "Perfect days (total)" },
  { type: "perfect_streak", label: "Perfect days in a row" },
  { type: "score", label: "Reach a score" },
  { type: "wordle_guesses", label: "Solve Wordle in few guesses" },
  { type: "boss_slain", label: "Fight in bosses that fall" },
  { type: "geodash_wins", label: "Clear Geometry Dash" },
  { type: "purchases", label: "Buy from the shop" },
  { type: "duel_wins", label: "Win duels in the pit" },
  { type: "duel_mmr", label: "Reach a pit standing (MMR)" },
];

function posInt(v: unknown, max = 1_000_000): number | null {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= max ? n : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Validate an untrusted trigger (a form post, or a row read back from the
 *  database). Returns null if it isn't a trigger the engine understands. */
export function parseTrigger(raw: unknown): AchievementTrigger | null {
  const t = obj(raw);
  switch (t.type) {
    case "trials_total": {
      const count = posInt(t.count);
      if (!count) return null;
      const section = (GAME_IDS as readonly string[]).includes(String(t.section))
        ? String(t.section)
        : undefined;
      return section ? { type: "trials_total", count, section } : { type: "trials_total", count };
    }
    case "perfect_days": {
      const count = posInt(t.count);
      return count ? { type: "perfect_days", count } : null;
    }
    case "perfect_streak": {
      const days = posInt(t.days, 3650);
      return days ? { type: "perfect_streak", days } : null;
    }
    case "score": {
      const kind = String(t.kind);
      const value = Number(t.value);
      if (!(kind in SCORE_KINDS) || !Number.isFinite(value) || value < 0) return null;
      return { type: "score", kind: kind as ScoreKind, value };
    }
    case "wordle_guesses": {
      const max = posInt(t.max, 10);
      return max ? { type: "wordle_guesses", max } : null;
    }
    case "boss_slain": {
      const count = posInt(t.count);
      return count ? { type: "boss_slain", count } : null;
    }
    case "geodash_wins": {
      const count = posInt(t.count);
      if (!count) return null;
      const difficulty = (GEO_DIFFICULTIES as readonly string[]).includes(String(t.difficulty))
        ? String(t.difficulty)
        : undefined;
      return difficulty
        ? { type: "geodash_wins", count, difficulty }
        : { type: "geodash_wins", count };
    }
    case "purchases": {
      const count = posInt(t.count);
      return count ? { type: "purchases", count } : null;
    }
    case "duel_wins": {
      const count = posInt(t.count);
      return count ? { type: "duel_wins", count } : null;
    }
    case "duel_mmr": {
      const count = posInt(t.count, 10_000);
      return count ? { type: "duel_mmr", count } : null;
    }
    default:
      return null;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** One line describing when a trigger fires — for the admin list. */
export function triggerLine(t: AchievementTrigger): string {
  switch (t.type) {
    case "trials_total":
      return `Clear ${plural(t.count, "trial")}${t.section ? ` of ${t.section}` : ""}`;
    case "perfect_days":
      return `${plural(t.count, "perfect day")}`;
    case "perfect_streak":
      return `${plural(t.days, "perfect day")} in a row`;
    case "score":
      return `${SCORE_KINDS[t.kind].label} ${t.value.toLocaleString()}`;
    case "wordle_guesses":
      return `Solve Wordle in ${plural(t.max, "guess", "guesses")} or fewer`;
    case "boss_slain":
      return `Damage ${plural(t.count, "boss", "bosses")} that fall`;
    case "geodash_wins":
      return `Clear Geometry Dash ${plural(t.count, "time")}${t.difficulty ? ` on ${t.difficulty}` : ""}`;
    case "purchases":
      return `Buy ${plural(t.count, "shop item")}`;
    case "duel_wins":
      return `Win ${plural(t.count, "duel")}`;
    case "duel_mmr":
      return `Reach ${t.count.toLocaleString()} standing in the pit`;
  }
}

// --- rewards ----------------------------------------------------------------

export type AchievementReward =
  | { kind: "coins"; amount: number }
  /** Permanent — not a timed buff. Applied in src/lib/completions.ts to every
   *  future daily-trial reward (not the boss bounty or geodash's stake payout). */
  | { kind: "boost"; percent: number }
  /** A Discord role, granted via src/lib/discord.ts `grantRole`. If `roleId` is
   *  empty the achievement still unlocks; the grant is skipped (and retried on
   *  the player's next completion once an id is filled in). */
  | { kind: "role"; label: string; roleId: string };

export const MAX_COIN_REWARD = 1_000_000;
export const MAX_BOOST_PERCENT = 100;

export function parseReward(raw: unknown): AchievementReward | null {
  const r = obj(raw);
  switch (r.kind) {
    case "coins": {
      const amount = posInt(r.amount, MAX_COIN_REWARD);
      return amount ? { kind: "coins", amount } : null;
    }
    case "boost": {
      const percent = posInt(r.percent, MAX_BOOST_PERCENT);
      return percent ? { kind: "boost", percent } : null;
    }
    case "role": {
      const label = String(r.label ?? "").trim().slice(0, 40);
      const roleId = String(r.roleId ?? "").trim();
      if (!label || (roleId && !/^\d{15,22}$/.test(roleId))) return null;
      return { kind: "role", label, roleId };
    }
    default:
      return null;
  }
}

/** One line of player-facing text describing the reward, for the toast and
 *  the /achievements card. */
export function rewardLine(reward: AchievementReward): string {
  switch (reward.kind) {
    case "coins":
      return `+${reward.amount.toLocaleString()} coins`;
    case "boost":
      return `+${reward.percent}% coins on every trial, permanently`;
    case "role":
      return `Unlocks the "${reward.label}" role`;
  }
}

// --- definitions ------------------------------------------------------------

export type AchievementDef = {
  key: string;
  name: string;
  description: string;
  /** A key of {@link ACHIEVEMENT_ICONS}. */
  icon: string;
  trigger: AchievementTrigger;
  reward: AchievementReward;
  enabled: boolean;
  sortOrder: number;
};

/** What the unlock toast needs — sent by /api/achievements/unseen. */
export type AchievementToast = {
  key: string;
  name: string;
  icon: string;
  rewardText: string;
};

/** Seeded into `AchievementDef` the first time the table is read while empty. */
export const DEFAULT_ACHIEVEMENTS: AchievementDef[] = [
  {
    key: "first-grace",
    name: "First Grace",
    description: "Best your first daily trial.",
    icon: "sparkles",
    trigger: { type: "trials_total", count: 1 },
    reward: { kind: "coins", amount: 500 },
    enabled: true,
    sortOrder: 10,
  },
  {
    key: "perfect-day",
    name: "Perfect Day",
    description: "Best every trial in a single day.",
    icon: "crown",
    trigger: { type: "perfect_days", count: 1 },
    // roleId is filled from ACHIEVEMENT_DEVOUT_ROLE_ID when the table is seeded.
    reward: { kind: "role", label: "Devout", roleId: "" },
    enabled: true,
    sortOrder: 20,
  },
  {
    key: "pilgrim",
    name: "Pilgrim",
    description: "Clear 10 daily trials.",
    icon: "star",
    trigger: { type: "trials_total", count: 10 },
    reward: { kind: "coins", amount: 2000 },
    enabled: true,
    sortOrder: 30,
  },
  {
    key: "faithful",
    name: "Faithful",
    description: "Clear 50 daily trials.",
    icon: "medal",
    trigger: { type: "trials_total", count: 50 },
    reward: { kind: "coins", amount: 16700 },
    enabled: true,
    sortOrder: 40,
  },
  {
    key: "zealot",
    name: "Zealot",
    description: "Clear 150 daily trials.",
    icon: "trophy",
    trigger: { type: "trials_total", count: 150 },
    reward: { kind: "coins", amount: 50000 },
    enabled: true,
    sortOrder: 50,
  },
  {
    key: "steadfast",
    name: "Steadfast",
    description: "Ten perfect days.",
    icon: "shield",
    trigger: { type: "perfect_days", count: 10 },
    reward: { kind: "coins", amount: 8000 },
    enabled: true,
    sortOrder: 60,
  },
  {
    key: "unwavering",
    name: "Unwavering",
    description: "Fifty perfect days.",
    icon: "award",
    trigger: { type: "perfect_days", count: 50 },
    reward: { kind: "coins", amount: 80000 },
    enabled: true,
    sortOrder: 70,
  },
  {
    key: "kindled",
    name: "Kindled",
    description: "Clear every trial, three days running.",
    icon: "zap",
    trigger: { type: "perfect_streak", days: 3 },
    reward: { kind: "coins", amount: 3000 },
    enabled: true,
    sortOrder: 80,
  },
  {
    key: "unbroken-week",
    name: "Unbroken Week",
    description: "Clear every trial, seven days running.",
    icon: "flame",
    trigger: { type: "perfect_streak", days: 7 },
    reward: { kind: "boost", percent: 5 },
    enabled: true,
    sortOrder: 90,
  },
  {
    key: "unbroken-month",
    name: "Unbroken Month",
    description: "Clear every trial, thirty days running.",
    icon: "flame",
    trigger: { type: "perfect_streak", days: 30 },
    reward: { kind: "boost", percent: 10 },
    enabled: true,
    sortOrder: 100,
  },
  {
    key: "hundredfold",
    name: "Hundredfold",
    description: "Clear every trial, one hundred days running.",
    icon: "crown",
    trigger: { type: "perfect_streak", days: 100 },
    reward: { kind: "boost", percent: 20 },
    enabled: true,
    sortOrder: 110,
  },
  {
    key: "sharp-eye",
    name: "Sharp Eye",
    description: "Finish the Aim Trainer averaging 600 ms or better.",
    icon: "crosshair",
    trigger: { type: "score", kind: "aimMs", value: 600 },
    reward: { kind: "coins", amount: 2500 },
    enabled: true,
    sortOrder: 120,
  },
  {
    key: "deadeye",
    name: "Deadeye",
    description: "Finish the Aim Trainer averaging 500 ms or better.",
    icon: "eye",
    trigger: { type: "score", kind: "aimMs", value: 500 },
    reward: { kind: "coins", amount: 5000 },
    enabled: true,
    sortOrder: 130,
  },
  {
    key: "keen-mind",
    name: "Keen Mind",
    description: "Solve the Wordle in three guesses or fewer.",
    icon: "star",
    trigger: { type: "wordle_guesses", max: 3 },
    reward: { kind: "coins", amount: 5000 },
    enabled: true,
    sortOrder: 140,
  },
  {
    key: "oracle",
    name: "Oracle",
    description: "Solve the Wordle in two guesses or fewer.",
    icon: "eye",
    trigger: { type: "wordle_guesses", max: 2 },
    reward: { kind: "coins", amount: 12000 },
    enabled: true,
    sortOrder: 150,
  },
  {
    key: "raid-blooded",
    name: "Raid Blooded",
    description: "Draw blood from a weekly boss that falls.",
    icon: "swords",
    trigger: { type: "boss_slain", count: 1 },
    reward: { kind: "coins", amount: 5000 },
    enabled: true,
    sortOrder: 160,
  },
  {
    key: "slayer",
    name: "Slayer",
    description: "Draw blood from five weekly bosses that fall.",
    icon: "skull",
    trigger: { type: "boss_slain", count: 5 },
    reward: { kind: "coins", amount: 15000 },
    enabled: true,
    sortOrder: 170,
  },
  {
    key: "godslayer",
    name: "GoodSlayer",
    description: "Draw blood from ten weekly bosses that fall.",
    icon: "crown",
    trigger: { type: "boss_slain", count: 10 },
    reward: { kind: "coins", amount: 30000 },
    enabled: true,
    sortOrder: 180,
  },
  {
    key: "flawless-rite",
    name: "Flawless Rite",
    description: "Recite The Litany to round 20 or beyond.",
    icon: "gem",
    trigger: { type: "score", kind: "litanyRound", value: 20 },
    reward: { kind: "coins", amount: 1500 },
    enabled: false,
    sortOrder: 190,
  },
  ...duelAchievements(),
];

/**
 * The pit's achievements. Added after the table was first seeded, so the
 * store tops an existing table up with them once (see ./store.ts).
 */
export function duelAchievements(): AchievementDef[] {
  return [
    {
      key: "first-blood",
      name: "First Blood",
      description: "Win your first duel in the pit.",
      icon: "swords",
      trigger: { type: "duel_wins", count: 1 },
      reward: { kind: "coins", amount: 1000 },
      enabled: true,
      sortOrder: 200,
    },
    {
      key: "pit-veteran",
      name: "Pit Veteran",
      description: "Win ten duels in the pit.",
      icon: "shield",
      trigger: { type: "duel_wins", count: 10 },
      reward: { kind: "coins", amount: 5000 },
      enabled: true,
      sortOrder: 210,
    },
    {
      key: "blood-on-the-sand",
      name: "Blood on the Sand",
      description: "Win fifty duels in the pit.",
      icon: "skull",
      trigger: { type: "duel_wins", count: 50 },
      reward: { kind: "coins", amount: 20000 },
      enabled: true,
      sortOrder: 220,
    },
    {
      key: "duelist",
      name: "Duelist",
      description: "Rise to the rank of Duelist against other players.",
      icon: "medal",
      trigger: { type: "duel_mmr", count: 1100 },
      reward: { kind: "coins", amount: 5000 },
      enabled: true,
      sortOrder: 230,
    },
    {
      key: "pit-lord",
      name: "Pit Lord",
      description: "Rise to the rank of Pit Lord against other players.",
      icon: "crown",
      trigger: { type: "duel_mmr", count: 1300 },
      reward: { kind: "coins", amount: 25000 },
      enabled: true,
      sortOrder: 240,
    },
  ];
}
