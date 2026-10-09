/**
 * How each of today's trials stands for one player, with enough detail for the
 * dashboard to say more than "done": what was scored, what was paid and when,
 * or how the trial was lost.
 *
 * A trial is `done` when its completion was paid, and `failed` when the day's
 * tries are spent (`DailyAttempt.failed`) or — Wordle keeps its own record —
 * the board was finished without the word. Anything else is still open and has
 * no entry.
 */

import { prisma } from "@/lib/prisma";
import { challengeDayBoundary, getChallengeDate, getChallengeDateString } from "@/lib/challenge-date";
import { isDevMode } from "@/lib/dev-mode";
import { HIGHER_IS_BETTER, type ScoreMetric } from "@/lib/scores";
import { SECTION_IDS, isSectionId, type SectionId } from "@/lib/sections";

export type TrialOutcome = {
  state: "done" | "failed";
  /** coins paid for the trial (done only) */
  coins?: number;
  /** when it was bested (done only) */
  at?: Date;
  /** losing attempts made today */
  fails?: number;
  /** today's best scored run, for the games that keep a score */
  score?: { metric: ScoreMetric; value: number };
  /** Wordle: how many guesses were made */
  guesses?: number;
};

export async function getTodayOutcomes(discordId: string): Promise<Map<SectionId, TrialOutcome>> {
  const out = new Map<SectionId, TrialOutcome>();
  // Dev mode (admin only): nothing counts, so every trial stays open.
  if (await isDevMode(discordId)) return out;

  const date = getChallengeDate();
  const [completions, attempts, wordle] = await Promise.all([
    prisma.completion.findMany({
      where: { discordId, date, rewarded: true, section: { in: [...SECTION_IDS] } },
      select: { section: true, rewardAmount: true, createdAt: true },
    }),
    prisma.dailyAttempt.findMany({
      where: { discordId, date, section: { in: [...SECTION_IDS] } },
      select: { section: true, fails: true, failed: true },
    }),
    prisma.wordleGame.findUnique({
      where: { discordId_date: { discordId, date } },
      select: { guesses: true, won: true, finished: true },
    }),
  ]);

  for (const a of attempts) {
    if (a.failed && isSectionId(a.section)) out.set(a.section, { state: "failed", fails: a.fails });
  }
  if (wordle?.finished && !wordle.won) {
    out.set("wordle", { state: "failed", guesses: wordle.guesses.length });
  }
  // a paid completion outranks a failure recorded the same day
  for (const c of completions) {
    if (!isSectionId(c.section)) continue;
    const fails = attempts.find((a) => a.section === c.section)?.fails;
    out.set(c.section, { state: "done", coins: c.rewardAmount, at: c.createdAt, fails });
  }
  if (wordle && out.has("wordle")) out.get("wordle")!.guesses = wordle.guesses.length;

  // Scores are only read when a scored game has an outcome to show them on —
  // on a fresh day this costs nothing.
  const scored = [...out.keys()].filter((id) => id !== "wordle");
  if (scored.length > 0) {
    const scores = await prisma.gameScore.findMany({
      where: { discordId, date, section: { in: scored } },
      select: { section: true, metric: true, value: true },
    });
    for (const s of scores) {
      const o = out.get(s.section as SectionId);
      if (!o) continue;
      const metric = s.metric as ScoreMetric;
      const better = HIGHER_IS_BETTER[metric];
      if (!o.score || (better ? s.value > o.score.value : s.value < o.score.value)) {
        o.score = { metric, value: s.value };
      }
    }
  }
  return out;
}

/** "5h 12m" until the challenge day rolls over and the trials return. */
export function timeToReset(): string {
  const end = challengeDayBoundary(getChallengeDateString(), true);
  if (!end) return "midnight";
  const mins = Math.max(1, Math.ceil((end.getTime() - Date.now()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
