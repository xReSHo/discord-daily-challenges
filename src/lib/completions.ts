/**
 * The heart of Phase 2: "complete a section once per day, get rewarded once".
 *
 * The ordering here is deliberate:
 *
 *   1. Atomically claim today's slot by inserting a Completion row. The
 *      unique constraint on (discordId, section, date) guarantees that
 *      exactly one concurrent request can win -- this is the no-double-reward
 *      guarantee, enforced by the database, not by application logic.
 *   2. Only after the claim succeeds do we call UnbelievaBoat. If the payout
 *      fails, we delete the claim so the user can try again later.
 *
 * Net effect: first completion pays out exactly once, repeat attempts are
 * blocked, and a failed payout never locks the user out.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addCurrency } from "@/lib/unbelievaboat";
import { getChallengeDate } from "@/lib/challenge-date";
import { isDevMode } from "@/lib/dev-mode";
import { SECTIONS, SECTION_IDS, type SectionId } from "@/lib/sections";
import { evaluateAchievements, getActiveBoostPercent } from "@/lib/achievements/engine";
import { getSectionReward } from "@/lib/section-status";
import { ensureDayRequirement } from "@/lib/day-requirement";
import { later } from "@/lib/background";
import { rollTrialDrop } from "@/lib/equipment-drops";
import { fortuneFor } from "@/lib/equipment";
import { getGear } from "@/lib/equipment-effects";

export type CompleteResult =
  | { status: "rewarded"; amount: number; newBalance: number }
  | { status: "already_completed" }
  | { status: "reward_failed"; message: string }
  /** Dev mode was on: the run was not recorded and nothing was paid out. */
  | { status: "dev_mode" };

export async function completeSection(
  discordId: string,
  sectionId: SectionId,
  /** Override the fixed section reward — for games with a variable prize
   *  (typing's fail-drop, litany's continue-bonus). Defaults to the config. */
  rewardAmount?: number,
): Promise<CompleteResult> {
  // Dev mode (admin only): don't touch the DB or the economy, just report it.
  if (await isDevMode(discordId)) return { status: "dev_mode" };

  const section = SECTIONS[sectionId];
  const base =
    rewardAmount != null && Number.isFinite(rewardAmount)
      ? Math.max(0, Math.floor(rewardAmount))
      : await getSectionReward(sectionId);
  // A permanent achievement (e.g. "Unbroken Week") can boost every future
  // daily-trial reward by a fixed percent — never the boss bounty or
  // geodash's staked payout, which pay out through their own paths.
  const date = getChallengeDate();
  let boostPct = base > 0 ? await getActiveBoostPercent(discordId) : 0;
  // The boots add their Fortune on top, the same way: a percent of the trial's
  // own prize. The legendary pair doubles it on the day's first trial.
  if (base > 0) {
    const gear = await getGear(discordId);
    if (gear.fortune > 0) {
      const first =
        gear.perks.includes("boots") &&
        (await prisma.completion.count({ where: { discordId, date, rewarded: true } })) === 0;
      boostPct += fortuneFor(gear, first);
    }
  }
  const reward = boostPct > 0 ? Math.floor(base * (1 + boostPct / 100)) : base;
  const key = {
    discordId_section_date: { discordId, section: sectionId, date },
  };

  // Pin down which games today requires before the first completion lands.
  await ensureDayRequirement();

  // 1. Claim the slot.
  try {
    await prisma.completion.create({
      data: {
        discordId,
        section: sectionId,
        date,
        rewardAmount: reward,
        rewarded: false,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { status: "already_completed" };
    }
    throw err;
  }

  // 2. Pay out, rolling back the claim on failure. A zero prize still counts as
  //    a completion (streak/perfect-day) but moves no coins.
  try {
    let newBalance = 0;
    if (reward > 0) {
      const balance = await addCurrency(
        discordId,
        reward,
        `Daily challenge reward: ${section.label}`,
      );
      newBalance = balance.total;
    }
    await prisma.completion.update({
      where: key,
      data: { rewarded: true },
    });
    later(() => evaluateAchievements(discordId));
    // every finished trial is a chance at a piece of equipment (never throws)
    await rollTrialDrop(discordId, sectionId, date);
    return { status: "rewarded", amount: reward, newBalance };
  } catch (err) {
    await prisma.completion.deleteMany({
      where: { discordId, section: sectionId, date, rewarded: false },
    });
    return {
      status: "reward_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The set of section ids this user has completed (and been rewarded for) today. */
export async function getCompletedSectionsToday(
  discordId: string,
): Promise<Set<SectionId>> {
  // Dev mode (admin only): nothing counts as done, so every game stays open.
  if (await isDevMode(discordId)) return new Set();

  const date = getChallengeDate();
  const rows = await prisma.completion.findMany({
    where: { discordId, date, rewarded: true, section: { in: [...SECTION_IDS] } },
    select: { section: true },
  });
  return new Set(rows.map((r) => r.section as SectionId));
}
