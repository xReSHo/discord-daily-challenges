/**
 * The registry of daily challenge sections.
 *
 * `wordle` (P3), `typing` (P4), `aim` (P5), plus `litany` (sequence-memory) are
 * the live games. Each has its own page (`href`).
 */

export type SectionId = "wordle" | "typing" | "aim" | "litany" | "geodash";

export type SectionConfig = {
  id: SectionId;
  label: string;
  /** Where the "Play" button on the dashboard links to. */
  href: string;
  /** Coins banked via UnbelievaBoat on first completion of the day. */
  reward: number;
};

function rewardFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const SECTIONS: Record<SectionId, SectionConfig> = {
  wordle: {
    id: "wordle",
    label: "Wordle",
    href: "/wordle",
    reward: rewardFromEnv("WORDLE_REWARD_AMOUNT", 250),
  },
  typing: {
    id: "typing",
    label: "Typing Test",
    href: "/typing",
    reward: rewardFromEnv("TYPING_REWARD_AMOUNT", 200),
  },
  aim: {
    id: "aim",
    label: "Aim Trainer",
    href: "/aim",
    reward: rewardFromEnv("AIM_REWARD_AMOUNT", 200),
  },
  litany: {
    id: "litany",
    label: "The Litany",
    href: "/litany",
    reward: rewardFromEnv("LITANY_REWARD_AMOUNT", 200),
  },
  geodash: {
    id: "geodash",
    label: "Geometry Dash",
    href: "/geodash",
    // Nominal only — geodash is a staked game that computes its own payout.
    // This is the base entry cost, shown on the dashboard card.
    reward: rewardFromEnv("GEODASH_ENTRY", 100),
  },
};

export const SECTION_IDS = Object.keys(SECTIONS) as SectionId[];

export function isSectionId(value: string): value is SectionId {
  return value in SECTIONS;
}
