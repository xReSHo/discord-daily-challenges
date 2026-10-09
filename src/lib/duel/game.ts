/**
 * The Pit: staking, fighting and paying out duels.
 *
 * A duel never needs both fighters at once. The challenger locks in their
 * five moves and their stake; the row waits, `open`, until someone answers
 * with moves of their own and an equal stake, and the server plays the two
 * orders against each other (rules.ts). Against the pit's champion (the CPU)
 * the answer is drawn at random on the spot.
 *
 * The challenger's moves are a secret until the duel is decided: they are
 * never sent to a browser while the row is `open`.
 *
 * Coins:
 *   - each side's stake is charged before their moves count;
 *   - the winner is paid the pot less the pit's cut; a draw returns both stakes;
 *   - `paidC` / `paidO` record that a side has received what it is owed, and
 *     are claimed before the payment is sent, so nothing is ever paid twice;
 *     a payment that fails is retried the next time that player opens the pit.
 *
 * Standing (MMR) moves only in duels between two players.
 *
 * The switches and numbers (open or closed, the cut, the stake limits) are
 * live settings, edited in /admin/pit — see `getPitSettings`.
 */

import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { addCurrency, refund, spend } from "@/lib/unbelievaboat";
import { logger } from "@/lib/logger";
import { evaluateAchievements } from "@/lib/achievements/engine";
import { later } from "@/lib/background";
import { getOwned } from "@/lib/equipment-drops";
import { RARITIES, bestLoadout } from "@/lib/equipment";
import { getPitSettings, pitStakeLimit, type PitSettings } from "@/lib/site-settings";
import {
  MOVE_IDS,
  ROUNDS,
  START_MMR,
  fight,
  mmrDelta,
  split,
  type Fight,
  type Move,
  type Round,
} from "./rules";

export const CPU = "cpu";
export const CPU_NAME = "The Pit's Champion";
export type DuelOutcome = "win" | "lose" | "draw";

/** A decided duel, from one fighter's point of view. */
export type DuelResult = {
  id: string | null;
  /** Rounds with `me` / `them` in place of the row's challenger / opponent. */
  rounds: { me: Move; them: Move; win: "me" | "them" | "tie" }[];
  me: number;
  them: number;
  outcome: DuelOutcome;
  opponent: string;
  stake: number;
  /** What this fighter was paid: the pot less the cut, their stake back, or 0. */
  paid: number;
  /** Change in standing; 0 against the champion. */
  mmr: number;
  /** Dev mode: nothing was staked, paid or recorded. */
  practice?: boolean;
};

export type DuelFail = { ok: false; code: number; error: string };

const fail = (code: number, error: string): DuelFail => ({ ok: false, code, error });

/** How good a player's sword is: 0 for none, then 1 (common) to 5 (legendary). */
async function swordRank(discordId: string): Promise<number> {
  const sword = bestLoadout(await getOwned(discordId)).sword;
  return sword ? RARITIES.findIndex((r) => r.id === sword.rarity) + 1 : 0;
}

function view(f: Fight, asChallenger: boolean): Pick<DuelResult, "rounds" | "me" | "them" | "outcome"> {
  const mine = asChallenger ? "a" : "b";
  return {
    rounds: f.rounds.map((r) => ({
      me: asChallenger ? r.a : r.b,
      them: asChallenger ? r.b : r.a,
      win: r.win === "tie" ? "tie" : r.win === mine ? "me" : "them",
    })),
    me: asChallenger ? f.a : f.b,
    them: asChallenger ? f.b : f.a,
    outcome: f.winner === "draw" ? "draw" : f.winner === mine ? "win" : "lose",
  };
}

/** The stake, or why it can't be taken. */
function checkStake(raw: unknown, pit: PitSettings, vs: "cpu" | "open"): number | DuelFail {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < pit.minStake) {
    return fail(400, `Stake at least ${pit.minStake.toLocaleString("en-US")} coins.`);
  }
  const limit = pitStakeLimit(pit, vs);
  if (limit != null && n > limit) {
    return fail(
      400,
      `The largest stake ${vs === "cpu" ? "against the champion" : "here"} is ${limit.toLocaleString("en-US")} coins.`,
    );
  }
  return n;
}

const closed = (pit: PitSettings): DuelFail => fail(503, pit.note ?? "The pit is closed for now.");

const chargeError = (reason: "insufficient" | "unavailable" | "error"): DuelFail =>
  reason === "insufficient"
    ? fail(402, "You don't have enough coins for that stake.")
    : reason === "unavailable"
      ? fail(503, "The coin service isn't configured.")
      : fail(502, "Couldn't reach the coin service. Try again shortly.");

/**
 * Send one side what a decided duel owes them, once. `side` is "C" for the
 * challenger, "O" for the opponent. Safe to call again: a side already paid
 * is skipped.
 */
async function settle(duelId: string, side: "C" | "O"): Promise<void> {
  const flag = side === "C" ? "paidC" : "paidO";
  const duel = await prisma.duel.findUnique({ where: { id: duelId } });
  if (!duel || duel.status !== "done" || duel[flag]) return;
  const who = side === "C" ? duel.challengerId : duel.opponentId;
  const won = duel.winner === (side === "C" ? "challenger" : "opponent");
  const draw = duel.winner === "draw";

  const claim = await prisma.duel.updateMany({ where: { id: duelId, [flag]: false }, data: { [flag]: true } });
  if (claim.count === 0 || !who || who === CPU || (!won && !draw)) return;

  try {
    if (won) {
      await addCurrency(who, Number(duel.payout), "The Pit: duel won");
    } else {
      // a draw: the stake goes back where it came from
      const cash = Number(side === "C" ? duel.paidCashC : duel.paidCashO);
      const bank = Number(side === "C" ? duel.paidBankC : duel.paidBankO);
      await refund(who, cash, bank, "The Pit: duel drawn, stake returned");
    }
  } catch (err) {
    await prisma.duel.updateMany({ where: { id: duelId }, data: { [flag]: false } }).catch(() => {});
    logger.error("duel.settle_failed", { duelId, side, message: String(err) });
  }
}

/** Retry anything a past duel still owes this player. */
async function settleOwed(discordId: string): Promise<void> {
  const owed = await prisma.duel.findMany({
    where: {
      status: "done",
      OR: [
        { challengerId: discordId, paidC: false },
        { opponentId: discordId, paidO: false },
      ],
    },
    select: { id: true, challengerId: true },
    take: 5,
  });
  for (const d of owed) await settle(d.id, d.challengerId === discordId ? "C" : "O");
}

function feats(...ids: string[]) {
  for (const id of ids) {
    if (id === CPU) continue;
    later(() => evaluateAchievements(id));
  }
}

/**
 * Start a duel. Against the champion it is fought at once; otherwise it is
 * posted as an open challenge for another player to answer.
 */
export async function createDuel(
  discordId: string,
  input: { stake: unknown; moves: Move[]; vs: "cpu" | "open" },
  opts: { devMode?: boolean } = {},
): Promise<{ ok: true; result?: DuelResult; posted?: true } | DuelFail> {
  const pit = await getPitSettings();
  if (!pit.open) return closed(pit);
  if (input.vs === "cpu" ? !pit.cpu : !pit.players) {
    return fail(
      503,
      input.vs === "cpu" ? "The champion is not taking duels for now." : "Challenges between players are closed for now.",
    );
  }
  const stake = checkStake(input.stake, pit, input.vs);
  if (typeof stake !== "number") return stake;

  if (input.vs === "cpu") {
    const theirs = Array.from({ length: ROUNDS }, () => MOVE_IDS[randomInt(MOVE_IDS.length)]);
    const f = fight(input.moves, theirs);
    // a sword trims the pit's cut but never removes it, so the odds stay
    // (slightly) with the house and the champion can't be farmed
    const { payout, rake } = split(stake, await swordRank(discordId), pit.cut);

    if (opts.devMode) {
      const v = view(f, true);
      return {
        ok: true,
        result: {
          id: null,
          ...v,
          opponent: CPU_NAME,
          stake,
          paid: v.outcome === "win" ? payout : v.outcome === "draw" ? stake : 0,
          mmr: 0,
          practice: true,
        },
      };
    }

    const charged = await spend(discordId, stake, "The Pit: stake");
    if (!charged.ok) return chargeError(charged.reason);

    const winner = f.winner === "draw" ? "draw" : f.winner === "a" ? "challenger" : "opponent";
    const duel = await prisma.duel.create({
      data: {
        challengerId: discordId,
        opponentId: CPU,
        stake,
        challengerMoves: input.moves.join(""),
        opponentMoves: theirs.join(""),
        status: "done",
        winner,
        rounds: f.rounds,
        scoreC: f.a,
        scoreO: f.b,
        payout: winner === "challenger" ? payout : 0,
        rake: winner === "draw" ? 0 : rake,
        paidCashC: charged.paidCash,
        paidBankC: charged.paidBank,
        paidO: true,
        resolvedAt: new Date(),
      },
      select: { id: true },
    });
    await settle(duel.id, "C");
    await prisma.duelRating.upsert({
      where: { discordId },
      create: {
        discordId,
        cpuWins: winner === "challenger" ? 1 : 0,
        cpuLosses: winner === "opponent" ? 1 : 0,
      },
      update:
        winner === "challenger"
          ? { cpuWins: { increment: 1 } }
          : winner === "opponent"
            ? { cpuLosses: { increment: 1 } }
            : {},
    });
    feats(discordId);
    logger.info("duel.cpu", { discordId, stake, winner });

    const v = view(f, true);
    return {
      ok: true,
      result: {
        id: duel.id,
        ...v,
        opponent: CPU_NAME,
        stake,
        paid: v.outcome === "win" ? payout : v.outcome === "draw" ? stake : 0,
        mmr: 0,
      },
    };
  }

  if (opts.devMode) return fail(400, "Dev mode is on. Only practice against the champion is open.");
  const waiting = await prisma.duel.count({ where: { challengerId: discordId, status: "open" } });
  if (waiting >= pit.maxOpen) {
    return fail(409, `You already have ${waiting} challenges waiting. Withdraw one first.`);
  }
  const charged = await spend(discordId, stake, "The Pit: stake");
  if (!charged.ok) return chargeError(charged.reason);
  await prisma.duel.create({
    data: {
      challengerId: discordId,
      stake,
      challengerMoves: input.moves.join(""),
      status: "open",
      paidCashC: charged.paidCash,
      paidBankC: charged.paidBank,
    },
  });
  logger.info("duel.posted", { discordId, stake });
  return { ok: true, posted: true };
}

/** Answer an open challenge: stake the same, and the duel is fought at once. */
export async function acceptDuel(
  discordId: string,
  duelId: string,
  moves: Move[],
  opts: { devMode?: boolean } = {},
): Promise<{ ok: true; result: DuelResult } | DuelFail> {
  if (opts.devMode) return fail(400, "Dev mode is on. Only practice against the champion is open.");
  const pit = await getPitSettings();
  if (!pit.open) return closed(pit);
  if (!pit.players) return fail(503, "Challenges between players are closed for now.");

  // take the challenge, so two answers can never both land
  const claim = await prisma.duel.updateMany({
    where: { id: duelId, status: "open", challengerId: { not: discordId } },
    data: { status: "locked", opponentId: discordId },
  });
  if (claim.count === 0) return fail(409, "That challenge is gone: answered, withdrawn, or your own.");
  const duel = await prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
  const stake = Number(duel.stake);
  const reopen = () =>
    prisma.duel.updateMany({ where: { id: duelId, status: "locked" }, data: { status: "open", opponentId: null } });

  const charged = await spend(discordId, stake, "The Pit: stake");
  if (!charged.ok) {
    await reopen();
    return chargeError(charged.reason);
  }

  try {
    const mine = duel.challengerMoves.split("") as Move[];
    const [swordC, swordO, ratingC, ratingO] = await Promise.all([
      swordRank(duel.challengerId),
      swordRank(discordId),
      prisma.duelRating.findUnique({ where: { discordId: duel.challengerId } }),
      prisma.duelRating.findUnique({ where: { discordId } }),
    ]);
    const f = fight(mine, moves);
    const winner = f.winner === "draw" ? "draw" : f.winner === "a" ? "challenger" : "opponent";
    // the winner's own sword sets the pit's cut of their winnings
    const { payout, rake } = split(stake, winner === "challenger" ? swordC : swordO, pit.cut);
    const mmrC = ratingC?.mmr ?? START_MMR;
    const mmrO = ratingO?.mmr ?? START_MMR;
    const delta = mmrDelta(mmrC, mmrO, winner === "draw" ? 0.5 : winner === "challenger" ? 1 : 0);

    const tally = (won: boolean, lost: boolean, d: number, now: number, peak: number) => ({
      mmr: { increment: d },
      peak: Math.max(peak, now + d),
      wins: { increment: won ? 1 : 0 },
      losses: { increment: lost ? 1 : 0 },
      draws: { increment: !won && !lost ? 1 : 0 },
    });
    const fresh = (id: string, won: boolean, lost: boolean, d: number) => ({
      discordId: id,
      mmr: START_MMR + d,
      peak: Math.max(START_MMR, START_MMR + d),
      wins: won ? 1 : 0,
      losses: lost ? 1 : 0,
      draws: !won && !lost ? 1 : 0,
    });
    const cWon = winner === "challenger";
    const oWon = winner === "opponent";

    await prisma.$transaction([
      prisma.duel.update({
        where: { id: duelId },
        data: {
          status: "done",
          opponentMoves: moves.join(""),
          winner,
          rounds: f.rounds,
          scoreC: f.a,
          scoreO: f.b,
          payout: winner === "draw" ? 0 : payout,
          rake: winner === "draw" ? 0 : rake,
          paidCashO: charged.paidCash,
          paidBankO: charged.paidBank,
          mmrC: delta,
          mmrO: -delta,
          resolvedAt: new Date(),
        },
      }),
      prisma.duelRating.upsert({
        where: { discordId: duel.challengerId },
        create: fresh(duel.challengerId, cWon, oWon, delta),
        update: tally(cWon, oWon, delta, mmrC, ratingC?.peak ?? START_MMR),
      }),
      prisma.duelRating.upsert({
        where: { discordId },
        create: fresh(discordId, oWon, cWon, -delta),
        update: tally(oWon, cWon, -delta, mmrO, ratingO?.peak ?? START_MMR),
      }),
    ]);

    await settle(duelId, "C");
    await settle(duelId, "O");
    feats(duel.challengerId, discordId);
    logger.info("duel.fought", { duelId, stake, winner });

    const challenger = await prisma.user.findFirst({
      where: { discordId: duel.challengerId },
      select: { name: true },
    });
    const v = view(f, false);
    return {
      ok: true,
      result: {
        id: duelId,
        ...v,
        opponent: challenger?.name ?? "A challenger",
        stake,
        paid: v.outcome === "win" ? payout : v.outcome === "draw" ? stake : 0,
        mmr: -delta,
      },
    };
  } catch (err) {
    // nothing was decided: give the stake back and put the challenge back up
    logger.error("duel.fight_failed", { duelId, message: String(err) });
    const still = await prisma.duel.findUnique({ where: { id: duelId }, select: { status: true } });
    if (still?.status === "locked") {
      await refund(discordId, charged.paidCash, charged.paidBank, "The Pit: duel failed, stake returned").catch(
        (e) => logger.error("duel.refund_failed", { duelId, discordId, message: String(e) }),
      );
      await reopen();
    }
    return fail(500, "The duel couldn't be fought. Your stake is returned.");
  }
}

/** Take back one's own open challenge, and its stake. */
export async function cancelDuel(discordId: string, duelId: string): Promise<{ ok: true } | DuelFail> {
  const claim = await prisma.duel.updateMany({
    where: { id: duelId, status: "open", challengerId: discordId },
    data: { status: "cancelled", resolvedAt: new Date() },
  });
  if (claim.count === 0) return fail(409, "That challenge has already been answered or withdrawn.");
  const duel = await prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
  try {
    await refund(discordId, Number(duel.paidCashC), Number(duel.paidBankC), "The Pit: challenge withdrawn");
  } catch (err) {
    // the stake must not be lost: put the challenge back so it can be withdrawn again
    await prisma.duel.updateMany({ where: { id: duelId }, data: { status: "open", resolvedAt: null } });
    logger.error("duel.cancel_refund_failed", { duelId, message: String(err) });
    return fail(502, "Couldn't return your stake just now. The challenge is still up; try again.");
  }
  return { ok: true };
}

// --- for the admin ----------------------------------------------------------

/**
 * Take a waiting challenge down and return its stake, whoever posted it. Used
 * when the pit (or challenges between players) is closed, so no coins are left
 * sitting in it.
 */
export async function withdrawChallenge(duelId: string): Promise<"refunded" | "gone" | "failed"> {
  const claim = await prisma.duel.updateMany({
    where: { id: duelId, status: "open" },
    data: { status: "cancelled", resolvedAt: new Date() },
  });
  if (claim.count === 0) return "gone";
  const duel = await prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
  try {
    await refund(
      duel.challengerId,
      Number(duel.paidCashC),
      Number(duel.paidBankC),
      "The Pit: challenge withdrawn by the pit",
    );
    return "refunded";
  } catch (err) {
    await prisma.duel.updateMany({ where: { id: duelId }, data: { status: "open", resolvedAt: null } });
    logger.error("duel.admin_refund_failed", { duelId, message: String(err) });
    return "failed";
  }
}

/** Withdraw every waiting challenge (up to `limit` in one go). */
export async function withdrawAllChallenges(limit = 40): Promise<{ refunded: number; failed: number; left: number }> {
  const open = await prisma.duel.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let refunded = 0;
  let failed = 0;
  for (const d of open) {
    const out = await withdrawChallenge(d.id);
    if (out === "refunded") refunded++;
    else if (out === "failed") failed++;
  }
  const left = await prisma.duel.count({ where: { status: "open" } });
  return { refunded, failed, left };
}

/**
 * A challenge is `locked` only for the second or two it is being answered. One
 * left that way (the server stopped mid-duel) is put back up for anyone to
 * answer. Only for a challenge that has plainly been stuck for a while.
 */
export async function reopenStuckDuel(duelId: string): Promise<boolean> {
  const out = await prisma.duel.updateMany({
    where: { id: duelId, status: "locked" },
    data: { status: "open", opponentId: null },
  });
  return out.count > 0;
}

/** Send again every payment a decided duel still owes (up to `limit` duels). */
export async function settleAllOwed(limit = 40): Promise<{ tried: number; left: number }> {
  const where = { status: "done", OR: [{ paidC: false }, { paidO: false }] };
  const owed = await prisma.duel.findMany({ where, select: { id: true }, take: limit });
  for (const d of owed) {
    await settle(d.id, "C");
    await settle(d.id, "O");
  }
  return { tried: owed.length, left: await prisma.duel.count({ where }) };
}

/** Set a player's standing by hand (to undo win-trading, say). */
export async function setStanding(discordId: string, mmr: number): Promise<void> {
  await prisma.duelRating.upsert({
    where: { discordId },
    create: { discordId, mmr, peak: Math.max(START_MMR, mmr) },
    update: { mmr },
  });
}

// --- the page ---------------------------------------------------------------

export type Standing = {
  mmr: number;
  peak: number;
  wins: number;
  losses: number;
  draws: number;
  cpuWins: number;
  cpuLosses: number;
};

export type OpenChallenge = {
  id: string;
  mine: boolean;
  name: string;
  image: string | null;
  mmr: number;
  stake: number;
  at: string;
};

export type PastDuel = DuelResult & { at: string; asChallenger: boolean };

/** The live terms of a duel, as the page needs them. */
export type PitTerms = {
  cut: number;
  minStake: number;
  /** Largest stake against each kind of opponent, or null for no limit. */
  maxCpu: number | null;
  maxOpen: number | null;
  cpu: boolean;
  players: boolean;
};

export function pitTerms(s: PitSettings): PitTerms {
  return {
    cut: s.cut,
    minStake: s.minStake,
    maxCpu: pitStakeLimit(s, "cpu"),
    maxOpen: pitStakeLimit(s, "open"),
    cpu: s.cpu,
    players: s.players,
  };
}

export type Pit = {
  standing: Standing;
  /** Whether a sword is worn, and how good: 0 none … 5 legendary. */
  sword: number;
  open: OpenChallenge[];
  past: PastDuel[];
};

export async function getPit(discordId: string): Promise<Pit> {
  await settleOwed(discordId).catch(() => {});

  const [rating, open, past, sword] = await Promise.all([
    prisma.duelRating.findUnique({ where: { discordId } }),
    prisma.duel.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      take: 30,
      // never the moves: they are the challenger's secret
      select: { id: true, challengerId: true, stake: true, createdAt: true },
    }),
    prisma.duel.findMany({
      where: { status: "done", OR: [{ challengerId: discordId }, { opponentId: discordId }] },
      orderBy: { resolvedAt: "desc" },
      take: 10,
    }),
    swordRank(discordId),
  ]);

  const ids = [
    ...new Set([
      ...open.map((o) => o.challengerId),
      ...past.map((p) => (p.challengerId === discordId ? p.opponentId : p.challengerId)),
    ]),
  ].filter((id): id is string => !!id && id !== CPU);
  const [users, ratings] = ids.length
    ? await Promise.all([
        prisma.user.findMany({
          where: { discordId: { in: ids } },
          select: { discordId: true, name: true, image: true },
        }),
        prisma.duelRating.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, mmr: true } }),
      ])
    : [[], []];
  const user = new Map(users.map((u) => [u.discordId, u]));
  const mmr = new Map(ratings.map((r) => [r.discordId, r.mmr]));

  return {
    standing: {
      mmr: rating?.mmr ?? START_MMR,
      peak: rating?.peak ?? START_MMR,
      wins: rating?.wins ?? 0,
      losses: rating?.losses ?? 0,
      draws: rating?.draws ?? 0,
      cpuWins: rating?.cpuWins ?? 0,
      cpuLosses: rating?.cpuLosses ?? 0,
    },
    sword,
    open: open.map((o) => ({
      id: o.id,
      mine: o.challengerId === discordId,
      name: user.get(o.challengerId)?.name ?? "A challenger",
      image: user.get(o.challengerId)?.image ?? null,
      mmr: mmr.get(o.challengerId) ?? START_MMR,
      stake: Number(o.stake),
      at: o.createdAt.toISOString(),
    })),
    past: past.map((p) => {
      const asChallenger = p.challengerId === discordId;
      const other = asChallenger ? p.opponentId : p.challengerId;
      const rounds = (p.rounds as Round[] | null) ?? [];
      const f: Fight = {
        rounds,
        a: p.scoreC,
        b: p.scoreO,
        winner: p.winner === "draw" ? "draw" : p.winner === "challenger" ? "a" : "b",
      };
      const v = view(f, asChallenger);
      const stake = Number(p.stake);
      return {
        id: p.id,
        ...v,
        opponent: other === CPU ? CPU_NAME : (user.get(other ?? "")?.name ?? "A challenger"),
        stake,
        paid: v.outcome === "win" ? Number(p.payout) : v.outcome === "draw" ? stake : 0,
        mmr: asChallenger ? p.mmrC : p.mmrO,
        at: (p.resolvedAt ?? p.createdAt).toISOString(),
        asChallenger,
      };
    }),
  };
}
