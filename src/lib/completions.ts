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
import { SECTIONS, type SectionId } from "@/lib/sections";

export type CompleteResult =
  | { status: "rewarded"; amount: number; newBalance: number }
  | { status: "already_completed" }
  | { status: "reward_failed"; message: string };

export async function completeSection(
  discordId: string,
  sectionId: SectionId,
): Promise<CompleteResult> {
  const section = SECTIONS[sectionId];
  const date = getChallengeDate();
  const key = {
    discordId_section_date: { discordId, section: sectionId, date },
  };

  // 1. Claim the slot.
  try {
    await prisma.completion.create({
      data: {
        discordId,
        section: sectionId,
        date,
        rewardAmount: section.reward,
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

  // 2. Pay out, rolling back the claim on failure.
  try {
    const balance = await addCurrency(
      discordId,
      section.reward,
      `Daily challenge reward: ${section.label}`,
    );
    await prisma.completion.update({
      where: key,
      data: { rewarded: true },
    });
    return {
      status: "rewarded",
      amount: section.reward,
      newBalance: balance.total,
    };
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
  const date = getChallengeDate();
  const rows = await prisma.completion.findMany({
    where: { discordId, date, rewarded: true },
    select: { section: true },
  });
  return new Set(rows.map((r) => r.section as SectionId));
}
