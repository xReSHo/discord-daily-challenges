/**
 * The achievement catalog — a fixed, code-defined list (like `SECTIONS` in
 * src/lib/sections.ts). `src/lib/achievements/engine.ts` decides *when* each
 * one unlocks; this module only describes *what* it is and *what it pays*.
 *
 * Pure data + icon components — no Prisma, no server-only imports — so it can
 * be imported from both server components (the /achievements page) and client
 * components (the unlock toast), each looking up a key's name/icon/reward
 * locally instead of shipping that over the wire.
 */

import { Crown, Flame, Gem, Sparkles, Swords, type LucideIcon } from "lucide-react";

/**
 * Achievements only count progress from this instant forward — history from
 * before the feature shipped never counts, so nobody (including an admin
 * testing it) is retroactively handed an achievement for things they did
 * before it existed. Every predicate in engine.ts filters on a row's
 * `createdAt >= ACHIEVEMENTS_LAUNCH_AT`.
 */
export const ACHIEVEMENTS_LAUNCH_AT = new Date("2026-09-04T14:09:40.000Z");

export type AchievementReward =
  | { kind: "coins"; amount: number }
  /** Permanent — not a timed buff. Applied in src/lib/completions.ts to every
   *  future daily-trial reward (not the boss bounty or geodash's stake payout). */
  | { kind: "boost"; percent: number }
  /** Granted via the same src/lib/discord.ts `grantRole` the shop uses. The
   *  actual role id lives in env (see ROLE_ENV_VAR in engine.ts) — kept out of
   *  this shared, isomorphic catalog so a client bundle never touches
   *  `process.env`. Undefined here would be meaningless; `label` is all the UI
   *  needs. If the env var is unset the achievement still unlocks and shows in
   *  the UI, the role grant is just skipped (logged). */
  | { kind: "role"; label: string };

export type AchievementDef = {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  reward: AchievementReward;
};

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

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: "first-grace",
    name: "First Grace",
    description: "Best your first daily trial.",
    icon: Sparkles,
    reward: { kind: "coins", amount: 250 },
  },
  {
    key: "unbroken-week",
    name: "Unbroken Week",
    description: "Clear every trial, seven days running.",
    icon: Flame,
    reward: { kind: "boost", percent: 10 },
  },
  {
    key: "flawless-rite",
    name: "Flawless Rite",
    description: "Recite The Litany to round 20 or beyond.",
    icon: Gem,
    reward: { kind: "coins", amount: 750 },
  },
  {
    key: "raid-blooded",
    name: "Raid Blooded",
    description: "Draw blood from a weekly boss that falls.",
    icon: Swords,
    reward: { kind: "coins", amount: 1000 },
  },
  {
    key: "perfect-day",
    name: "Perfect Day",
    description: "Best every trial in a single day.",
    icon: Crown,
    reward: { kind: "role", label: "Devout" },
  },
];

export function getAchievementDef(key: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.key === key);
}
