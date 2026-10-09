/**
 * The trial charms: the shop's gear for the daily trials rather than the raid.
 *
 *   Second Chance   one more try at a trial lost today
 *   Wordle Insight  one letter of today's word, in its place
 *   Streak Ward     a missed day that does not break the streak
 *
 * Like the raid gear (see boss/kit.ts), a charm in the pack is a `fulfilled`
 * Purchase row; using it turns the row to `used` and writes what it was used
 * for into `roleId`, a column gear rows otherwise leave empty:
 *
 *   chance:<day>:<section>   insight:<day>:<position>   ward:<day>
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { challengeDayBoundary, getChallengeDate, getChallengeDateString } from "@/lib/challenge-date";
import { isDevMode } from "@/lib/dev-mode";
import { getSectionTries } from "@/lib/section-status";
import { SECTIONS, type SectionId } from "@/lib/sections";
import { getDailyWord } from "@/lib/wordle/daily";
import { planWards } from "@/lib/shop/ward-rule";

/** How many of a charm the player carries. */
export async function charmCount(discordId: string, itemId: string): Promise<number> {
  return prisma.purchase.count({ where: { discordId, itemId, status: "fulfilled" } });
}

/** Take one charm out of the pack and write what it was used for. Returns the
 *  row's id, or null when the player has none (or another request took it). */
async function spend(discordId: string, itemId: string, tag: string, boughtBefore?: Date): Promise<string | null> {
  const row = await prisma.purchase.findFirst({
    where: {
      discordId,
      itemId,
      status: "fulfilled",
      ...(boughtBefore ? { createdAt: { lte: boughtBefore } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!row) return null;
  const claim = await prisma.purchase.updateMany({
    where: { id: row.id, status: "fulfilled" },
    data: { status: "used", roleId: tag },
  });
  return claim.count === 1 ? row.id : null;
}

/** Put a charm back: what it was spent on did not happen. */
async function giveBack(id: string): Promise<void> {
  await prisma.purchase
    .update({ where: { id }, data: { status: "fulfilled", roleId: null } })
    .catch((err) => logger.error("charm.give_back_failed", { id, message: String(err) }));
}

// --- Second Chance -----------------------------------------------------------

/**
 * The trials a Second Chance works on: the ones lost by running out of tries.
 * Not Wordle — a lost board has already shown the word — and not the runner,
 * whose runs are staked rather than counted.
 */
export const SECOND_CHANCE_SECTIONS: SectionId[] = ["typing", "aim", "litany", "braziers"];

export type CharmResult = { ok: true; message: string } | { ok: false; code: number; error: string };

export async function spendSecondChance(discordId: string, section: string): Promise<CharmResult> {
  if (await isDevMode(discordId)) {
    return { ok: false, code: 400, error: "Dev mode is on — nothing is locked while testing." };
  }
  if (!SECOND_CHANCE_SECTIONS.includes(section as SectionId)) {
    return { ok: false, code: 400, error: "A Second Chance does not work on that trial." };
  }
  const id = section as SectionId;
  const date = getChallengeDate();
  const key = { discordId_section_date: { discordId, section: id, date } };

  const [done, attempt] = await Promise.all([
    prisma.completion.findUnique({ where: key, select: { rewarded: true } }),
    prisma.dailyAttempt.findUnique({ where: key, select: { fails: true, failed: true } }),
  ]);
  if (done) return { ok: false, code: 409, error: "You have already bested that trial today." };

  // the Braziers spend a try as each run begins, and lock only when asked again
  const maxTries = id === "braziers" ? await getSectionTries(id) : 0;
  const lost = !!attempt && (attempt.failed || (id === "braziers" && attempt.fails >= maxTries));
  if (!attempt || !lost) {
    return { ok: false, code: 409, error: "That trial is still open to you." };
  }

  const rowId = await spend(discordId, "second-chance", `chance:${getChallengeDateString()}:${id}`);
  if (!rowId) return { ok: false, code: 409, error: "You have no Second Chance in your pack." };

  try {
    // one try handed back: the lock lifts, and the next loss locks it again
    const fails = id === "braziers" ? Math.min(attempt.fails, maxTries) : attempt.fails;
    await prisma.dailyAttempt.update({
      where: key,
      data: { failed: false, fails: Math.max(0, fails - 1) },
    });
  } catch (err) {
    await giveBack(rowId);
    logger.error("charm.second_chance_failed", { discordId, section: id, message: String(err) });
    return { ok: false, code: 500, error: "Couldn't reopen the trial. Your charm is still in your pack." };
  }

  logger.info("charm.second_chance", { discordId, section: id });
  return { ok: true, message: `${SECTIONS[id].label} is open to you again.` };
}

// --- Wordle Insight ----------------------------------------------------------

export type WordleHint = { pos: number; letter: string };

/** The letters of today's word this player's Insights have shown them. */
export async function getWordleHints(discordId: string): Promise<WordleHint[]> {
  const prefix = `insight:${getChallengeDateString()}:`;
  const rows = await prisma.purchase.findMany({
    where: { discordId, itemId: "wordle-insight", status: "used", roleId: { startsWith: prefix } },
    select: { roleId: true },
  });
  if (rows.length === 0) return [];
  const word = await getDailyWord();
  return rows
    .map((r) => Number(r.roleId?.slice(prefix.length)))
    .filter((pos) => Number.isInteger(pos) && pos >= 0 && pos < word.length)
    .map((pos) => ({ pos, letter: word[pos] }));
}

export type InsightResult =
  | { ok: true; hint: WordleHint; left: number }
  | { ok: false; code: number; error: string };

export async function spendWordleInsight(discordId: string): Promise<InsightResult> {
  if (await isDevMode(discordId)) {
    return { ok: false, code: 400, error: "Dev mode is on — charms are not used while testing." };
  }
  const date = getChallengeDate();
  const [game, word, shown] = await Promise.all([
    prisma.wordleGame.findUnique({
      where: { discordId_date: { discordId, date } },
      select: { guesses: true, finished: true },
    }),
    getDailyWord(),
    getWordleHints(discordId),
  ]);
  if (game?.finished) return { ok: false, code: 409, error: "Today's board is already finished." };

  // a place the player has not been shown: not by a guess, not by a charm
  const known = new Set(shown.map((h) => h.pos));
  for (const guess of game?.guesses ?? []) {
    for (let i = 0; i < word.length; i++) if (guess[i] === word[i]) known.add(i);
  }
  let pos = -1;
  for (let i = 0; i < word.length; i++) {
    if (!known.has(i)) {
      pos = i;
      break;
    }
  }
  if (pos < 0) return { ok: false, code: 409, error: "There is nothing left to show you." };

  const rowId = await spend(discordId, "wordle-insight", `insight:${getChallengeDateString()}:${pos}`);
  if (!rowId) return { ok: false, code: 409, error: "You have no Wordle Insight in your pack." };

  logger.info("charm.wordle_insight", { discordId, pos });
  return {
    ok: true,
    hint: { pos, letter: word[pos] },
    left: await charmCount(discordId, "wordle-insight"),
  };
}

// --- Streak Ward -------------------------------------------------------------

function dayOf(roleId: string | null): string | null {
  const day = roleId?.startsWith("ward:") ? roleId.slice(5) : null;
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Every day a ward has covered, per player — for the leaderboard. */
export async function wardedDaysByPlayer(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const rows = await prisma.purchase.findMany({
    where: { itemId: "streak-ward", status: "used", roleId: { startsWith: "ward:" } },
    select: { discordId: true, roleId: true },
  });
  for (const r of rows) {
    const day = dayOf(r.roleId);
    if (day) out.set(r.discordId, [...(out.get(r.discordId) ?? []), day]);
  }
  return out;
}

/** The days a ward has covered for one player, without spending anything. */
export async function wardedDays(discordId: string): Promise<string[]> {
  const rows = await prisma.purchase.findMany({
    where: { discordId, itemId: "streak-ward", status: "used", roleId: { startsWith: "ward:" } },
    select: { roleId: true },
  });
  return rows.map((r) => dayOf(r.roleId)).filter((d): d is string => !!d);
}

/**
 * The days a ward covers for this player, spending wards from the pack where a
 * streak needs them (the rule is in ./ward-rule.ts).
 *
 * `kept` is the player's perfect days. Never throws: a failed read is "no
 * wards", which only ever shows a streak as shorter than it is.
 */
export async function settleWards(discordId: string, kept: Iterable<string>): Promise<string[]> {
  try {
    const rows = await prisma.purchase.findMany({
      where: { discordId, itemId: "streak-ward", status: { in: ["fulfilled", "used"] } },
      select: { id: true, status: true, roleId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const warded = rows.map((r) => (r.status === "used" ? dayOf(r.roleId) : null)).filter((d): d is string => !!d);
    const inPack = rows.filter((r) => r.status === "fulfilled");
    if (inPack.length === 0) return warded;

    const plan = planWards(
      getChallengeDateString(),
      new Set<string>([...kept, ...warded]),
      inPack.map((r) => ({ id: r.id, boughtAt: r.createdAt })),
      (day) => challengeDayBoundary(day, true),
    );
    for (const p of plan) {
      const claim = await prisma.purchase.updateMany({
        where: { id: p.id, status: "fulfilled" },
        data: { status: "used", roleId: `ward:${p.day}` },
      });
      if (claim.count === 1) {
        warded.push(p.day);
        logger.info("charm.streak_ward", { discordId, day: p.day });
      }
    }
    return warded;
  } catch (err) {
    logger.error("charm.wards_failed", { discordId, message: String(err) });
    return [];
  }
}
