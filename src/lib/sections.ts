/**
 * The registry of daily challenge sections.
 *
 * `wordle` (P3), `typing` (P4) and `aim` (P5) are the live games. Each has
 * its own page (`href`).
 */

export type SectionId = "wordle" | "typing" | "aim";

export type SectionConfig = {
  id: SectionId;
  label: string;
  /** Where the "Play" button on the dashboard links to. */
  href: string;
  /** Cash paid out by UnbelievaBoat on first completion of the day. */
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
};

export const SECTION_IDS = Object.keys(SECTIONS) as SectionId[];

export function isSectionId(value: string): value is SectionId {
  return value in SECTIONS;
}
