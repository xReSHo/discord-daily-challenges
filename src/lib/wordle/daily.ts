/**
 * The daily word. Two guarantees:
 *   1. Deterministic - derived from the challenge date (in CHALLENGE_TZ) via a
 *      hash, so every user gets the same word on the same day with no
 *      coordination.
 *   2. Stable - once any user has played on a given day, the word is frozen in
 *      the DailyContent table, so it can never change even if ANSWERS is later
 *      edited.
 *
 * The word is only ever read on the server. It is never sent to the client
 * until that user's game is finished.
 */

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getChallengeDate, getChallengeDateString } from "@/lib/challenge-date";
import { ANSWERS } from "./answers";

const SECTION = "wordle";
const SEED = process.env.WORDLE_SEED ?? "daily-challenges";

/** Pure date -> word mapping. Exported for tests / verification scripts. */
export function deriveDailyWord(dateStr: string): string {
  const digest = createHash("sha256").update(`${SEED}:${dateStr}`).digest();
  // First 6 bytes as an unsigned int is plenty of range for a ~2.3k list.
  const n = digest.readUIntBE(0, 6);
  return ANSWERS[n % ANSWERS.length];
}

type WordPayload = { word: string };

/**
 * In-process cache. The word for a given day never changes, so once this
 * server has resolved it there is no reason to touch the DB again for it.
 * Cleared on restart/redeploy; a handful of entries at most.
 */
const wordCache = new Map<string, string>();

/** Today's word, reading through / writing to DailyContent for stability. */
export async function getDailyWord(): Promise<string> {
  const dateStr = getChallengeDateString();

  const cached = wordCache.get(dateStr);
  if (cached) return cached;

  const word = await resolveDailyWord(dateStr);
  wordCache.set(dateStr, word);
  return word;
}

async function resolveDailyWord(dateStr: string): Promise<string> {
  const date = getChallengeDate();
  const where = { date_section: { date, section: SECTION } };

  const existing = await prisma.dailyContent.findUnique({ where });
  if (existing) return (existing.payload as WordPayload).word;

  const word = deriveDailyWord(dateStr);
  try {
    await prisma.dailyContent.create({
      data: { date, section: SECTION, payload: { word } satisfies WordPayload },
    });
    return word;
  } catch (err) {
    // Another request created the row first - read it back.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const row = await prisma.dailyContent.findUniqueOrThrow({ where });
      return (row.payload as WordPayload).word;
    }
    throw err;
  }
}
