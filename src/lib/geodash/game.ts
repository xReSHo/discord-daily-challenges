/**
 * Geometry Dash — economy + anti-cheat.
 *
 * Unlike the other games this one charges up front. The flow:
 *   startCourse  -> validate difficulty/stake, `spend()` the entry, open a
 *                   `GeoRun`, hand back the course + a signed run token.
 *   submitCourse -> replay the recorded jump trace with the shared `simulate`,
 *                   run plausibility gates, then settle:
 *                     clear    -> pay `payoutFor()`, record a Completion (0
 *                                 coins — the payout already happened), "won".
 *                     death    -> stake already gone, lock the day, "lost".
 *                     cheat    -> flag, forfeit the stake, lock the day,
 *                                 "rejected".
 *   abandoned    -> an `open` run whose token TTL lapsed with no submit is
 *                   refunded and the day's play is NOT consumed (lazy, in
 *                   getGeoState / startCourse).
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDate, getChallengeDateString } from "@/lib/challenge-date";
import { signToken, verifyToken } from "@/lib/session-token";
import { spend, addCurrency, refund, getBalance } from "@/lib/unbelievaboat";
import { completeSection } from "@/lib/completions";
import { lockNow } from "@/lib/attempts";
import { flagAttempt } from "@/lib/audit";
import { recordScore } from "@/lib/scores";
import { isDevMode } from "@/lib/dev-mode";
import { logger } from "@/lib/logger";
import { isDifficulty, type Difficulty } from "./daily";
import { getDailyCourse } from "./courses";
import { simulate, expectedRunMs, type Course } from "./physics";

const SECTION = "geodash" as const;

function envInt(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
}

const ENTRY = envInt("GEODASH_ENTRY", 100);
const REWARD: Record<"easy" | "medium" | "hard", number> = {
  easy: envInt("GEODASH_EASY_REWARD", 100),
  medium: envInt("GEODASH_MEDIUM_REWARD", 300),
  hard: envInt("GEODASH_HARD_REWARD", 500),
};
const IMPOSSIBLE_MIN = envInt("GEODASH_IMPOSSIBLE_MIN", 5000);
const IMPOSSIBLE_MULT = 5;
/** 0 = uncapped (honours "no maximum" for impossible). */
const MAX_PAYOUT = envInt("GEODASH_MAX_PAYOUT", 0);
const TTL_MS = envInt("GEODASH_RUN_TTL_MIN", 20) * 60_000;
/** free restarts per fee before the player must pay again to keep going */
const MAX_RESTARTS = envInt("GEODASH_MAX_RESTARTS", 5);

function costFor(difficulty: Difficulty, stake: number): number {
  return difficulty === "impossible" ? stake : ENTRY;
}

function payoutFor(difficulty: Difficulty, stake: number): number {
  const raw =
    difficulty === "impossible"
      ? stake * IMPOSSIBLE_MULT
      : stake + REWARD[difficulty];
  return MAX_PAYOUT > 0 ? Math.min(raw, MAX_PAYOUT) : raw;
}

// --- state ----------------------------------------------------------------

type RunView =
  | { status: "none" }
  | { status: "refunded" }
  | {
      status: "open";
      difficulty: Difficulty;
      stake: number;
      restartsLeft: number;
      deaths: number;
    }
  | {
      status: "spent";
      difficulty: Difficulty;
      stake: number;
      feesPaid: number;
      distancePct: number;
    }
  | { status: "won"; difficulty: Difficulty; stake: number; payout: number }
  | { status: "rejected"; difficulty: Difficulty; stake: number };

export type GeoState = {
  section: "geodash";
  entry: number;
  impossibleMin: number;
  multiplier: number;
  maxRestarts: number;
  rewards: { easy: number; medium: number; hard: number };
  devMode: boolean;
  balance: { cash: number; bank: number; total: number } | null;
  run: RunView;
};

type GeoRunRow = {
  id: string;
  discordId: string;
  difficulty: string;
  stake: number;
  paidCash: number;
  paidBank: number;
  status: string;
  payout: number;
  distancePct: number;
  restarts: number;
  deaths: number;
  feesPaid: number;
  tokenIat: bigint;
};

/** Move an abandoned (never-played) `open` run to `refunded`, putting the stake
 *  back exactly. Only valid at `deaths === 0` — once a player has died the fee
 *  is consumed. Claims the transition first so concurrent readers can't
 *  double-refund. */
async function expireRun(row: GeoRunRow): Promise<void> {
  if (row.deaths > 0) return;
  const claim = await prisma.geoRun.updateMany({
    where: { id: row.id, status: "open", deaths: 0 },
    data: { status: "refunded", resolvedAt: new Date() },
  });
  if (claim.count === 0) return;

  if (row.paidCash <= 0 && row.paidBank <= 0) return;
  try {
    await refund(
      row.discordId,
      row.paidCash,
      row.paidBank,
      "Geometry Dash — run abandoned",
    );
  } catch (err) {
    // reopen so a later read retries the refund
    await prisma.geoRun
      .updateMany({ where: { id: row.id }, data: { status: "open" } })
      .catch(() => {});
    logger.error("geodash.refund_failed", { id: row.id, message: String(err) });
  }
}

async function baseState(discordId: string, devMode: boolean): Promise<Omit<GeoState, "run">> {
  const b = await getBalance(discordId);
  return {
    section: SECTION,
    entry: ENTRY,
    impossibleMin: IMPOSSIBLE_MIN,
    multiplier: IMPOSSIBLE_MULT,
    maxRestarts: MAX_RESTARTS,
    rewards: REWARD,
    devMode,
    balance: b ? { cash: b.cash, bank: b.bank, total: b.total } : null,
  };
}

export async function getGeoState(discordId: string): Promise<GeoState> {
  const devMode = await isDevMode(discordId);
  const base = await baseState(discordId, devMode);
  if (devMode) return { ...base, run: { status: "none" } };

  const row = (await prisma.geoRun.findUnique({
    where: { discordId_date: { discordId, date: getChallengeDate() } },
  })) as GeoRunRow | null;
  if (!row) return { ...base, run: { status: "none" } };

  const difficulty = row.difficulty as Difficulty;

  if (row.status === "open") {
    // abandoned before a single death → refund and free the day
    if (row.deaths === 0 && Date.now() - Number(row.tokenIat) > TTL_MS) {
      await expireRun(row);
      return { ...base, run: { status: "refunded" } };
    }
    return {
      ...base,
      run: {
        status: "open",
        difficulty,
        stake: row.stake,
        restartsLeft: Math.max(0, MAX_RESTARTS - row.restarts),
        deaths: row.deaths,
      },
    };
  }
  if (row.status === "spent" || row.status === "lost") {
    return {
      ...base,
      run: {
        status: "spent",
        difficulty,
        stake: row.stake,
        feesPaid: row.feesPaid,
        distancePct: row.distancePct,
      },
    };
  }
  if (row.status === "won") {
    return {
      ...base,
      run: { status: "won", difficulty, stake: row.stake, payout: row.payout },
    };
  }
  if (row.status === "rejected") {
    return { ...base, run: { status: "rejected", difficulty, stake: row.stake } };
  }
  return { ...base, run: { status: "refunded" } };
}

// --- start --------------------------------------------------------------

export type StartResult =
  | {
      ok: true;
      token: string;
      course: Course;
      difficulty: Difficulty;
      stake: number;
      devMode: boolean;
      /** fresh: paid a new entry · resume: same first attempt · restart: a free
       *  retry within the fee block · repay: paid the fee again after running out */
      kind: "fresh" | "resume" | "restart" | "repay";
      restartsLeft: number;
    }
  | {
      ok: false;
      error:
        | "bad_difficulty"
        | "bad_stake"
        | "already_played"
        | "insufficient"
        | "unavailable";
      message?: string;
    };

export async function startCourse(
  discordId: string,
  input: { difficulty: unknown; stake: unknown },
): Promise<StartResult> {
  if (!isDifficulty(input.difficulty)) return { ok: false, error: "bad_difficulty" };
  const difficulty = input.difficulty;
  const day = getChallengeDateString();
  const date = getChallengeDate();

  const course = await getDailyCourse(difficulty);
  const issue = (iat: number, dev = false) =>
    signToken({ d: discordId, day, s: SECTION, diff: difficulty, iat, ...(dev ? { dev: true } : {}) });

  if (await isDevMode(discordId)) {
    return {
      ok: true,
      token: issue(Date.now(), true),
      course,
      difficulty,
      stake: difficulty === "impossible" ? IMPOSSIBLE_MIN : ENTRY,
      devMode: true,
      kind: "fresh",
      restartsLeft: MAX_RESTARTS,
    };
  }

  const existing = (await prisma.geoRun.findUnique({
    where: { discordId_date: { discordId, date } },
  })) as GeoRunRow | null;

  // difficulty is locked for the day once a run exists
  if (
    existing &&
    existing.difficulty !== difficulty &&
    existing.status !== "refunded"
  ) {
    return {
      ok: false,
      error: "already_played",
      message: `You picked ${existing.difficulty} today — that's locked in.`,
    };
  }

  // ---- free restart / first-attempt resume ----
  if (existing && existing.status === "open") {
    const freshTok = Date.now() - Number(existing.tokenIat) <= TTL_MS;
    if (existing.deaths === 0 && !freshTok) {
      await expireRun(existing); // abandoned before playing → refund, then re-charge below
    } else {
      const iat = Date.now();
      await prisma.geoRun.update({
        where: { id: existing.id },
        data: { tokenIat: BigInt(iat) },
      });
      return {
        ok: true,
        token: issue(iat),
        course,
        difficulty,
        stake: existing.stake,
        devMode: false,
        kind: existing.deaths === 0 ? "resume" : "restart",
        restartsLeft: Math.max(0, MAX_RESTARTS - existing.restarts),
      };
    }
  }

  // ---- terminal ----
  if (existing && (existing.status === "won" || existing.status === "rejected")) {
    return { ok: false, error: "already_played" };
  }

  // ---- re-pay after running out of free restarts ----
  const repaying =
    !!existing && (existing.status === "spent" || existing.status === "lost");

  // stake: Impossible takes a (possibly new) stake; the rest is the flat entry
  let stake: number;
  if (difficulty === "impossible") {
    const s = Number(input.stake);
    if (!Number.isInteger(s) || s < IMPOSSIBLE_MIN) {
      return {
        ok: false,
        error: "bad_stake",
        message: `The minimum stake for Impossible is ${IMPOSSIBLE_MIN.toLocaleString()}.`,
      };
    }
    stake = s;
  } else {
    stake = ENTRY;
  }

  const cost = costFor(difficulty, stake);
  const reason = repaying
    ? `Geometry Dash — ${difficulty} continue`
    : `Geometry Dash — ${difficulty} entry`;
  const paid = await spend(discordId, cost, reason);
  if (!paid.ok) {
    if (paid.reason === "insufficient") return { ok: false, error: "insufficient" };
    return { ok: false, error: "unavailable" };
  }

  const iat = Date.now();
  try {
    if (repaying && existing) {
      await prisma.geoRun.update({
        where: { id: existing.id },
        data: {
          stake: cost,
          paidCash: paid.paidCash,
          paidBank: paid.paidBank,
          status: "open",
          payout: 0,
          distancePct: 0,
          restarts: 0,
          feesPaid: { increment: 1 },
          tokenIat: BigInt(iat),
          resolvedAt: null,
        },
      });
    } else {
      await prisma.geoRun.upsert({
        where: { discordId_date: { discordId, date } },
        create: {
          discordId,
          date,
          difficulty,
          stake: cost,
          paidCash: paid.paidCash,
          paidBank: paid.paidBank,
          status: "open",
          tokenIat: BigInt(iat),
        },
        update: {
          difficulty,
          stake: cost,
          paidCash: paid.paidCash,
          paidBank: paid.paidBank,
          status: "open",
          payout: 0,
          distancePct: 0,
          restarts: 0,
          deaths: 0,
          feesPaid: 1,
          tokenIat: BigInt(iat),
          resolvedAt: null,
        },
      });
    }
  } catch (err) {
    await refund(discordId, paid.paidCash, paid.paidBank, `${reason} (could not start)`).catch(
      () => {},
    );
    logger.error("geodash.start_write_failed", { discordId, message: String(err) });
    return { ok: false, error: "unavailable" };
  }

  return {
    ok: true,
    token: issue(iat),
    course,
    difficulty,
    stake: cost,
    devMode: false,
    kind: repaying ? "repay" : "fresh",
    restartsLeft: MAX_RESTARTS,
  };
}

// --- submit ------------------------------------------------------------

type TokenPayload = {
  d: string;
  day: string;
  s: string;
  diff: string;
  dev?: boolean;
  iat: number;
};

export type SubmitResult =
  | { ok: true; outcome: "won"; payout: number; newBalance: number | null; devMode: boolean }
  /** died, but a free restart is available */
  | { ok: false; outcome: "down"; distancePct: number; restartsLeft: number; devMode: boolean }
  /** died and out of free restarts — the fee must be paid again to continue */
  | { ok: false; outcome: "spent"; distancePct: number; feesPaid: number; devMode: boolean }
  | { ok: false; outcome: "rejected"; reason: string; devMode: boolean }
  | { ok: false; outcome: "error"; reason: string };

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

export async function submitCourse(
  discordId: string,
  input: { token: unknown; jumpTimes: unknown; totalMs: unknown },
): Promise<SubmitResult> {
  const token = typeof input.token === "string" ? input.token : "";
  const payload = verifyToken<TokenPayload>(token);
  if (!payload || payload.s !== SECTION || payload.d !== discordId) {
    return { ok: false, outcome: "error", reason: "Invalid run token. Start again." };
  }
  if (payload.day !== getChallengeDateString()) {
    return { ok: false, outcome: "error", reason: "That run was from another day." };
  }
  if (!isDifficulty(payload.diff)) {
    return { ok: false, outcome: "error", reason: "Invalid run token." };
  }
  const difficulty = payload.diff;

  const jumpTimes = Array.isArray(input.jumpTimes)
    ? input.jumpTimes.filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
    : null;
  const totalMs = Number(input.totalMs);
  if (!jumpTimes || !Number.isFinite(totalMs) || totalMs <= 0) {
    return { ok: false, outcome: "error", reason: "Malformed run data." };
  }

  const course = await getDailyCourse(difficulty);
  const sim = simulate(course, jumpTimes);
  const windowMs = Date.now() - payload.iat;
  const expected = expectedRunMs(course);

  // dev mode: report the outcome, record nothing, move no coins.
  if (payload.dev || (await isDevMode(discordId))) {
    if (sim.reachedEnd) {
      const nominal = difficulty === "impossible" ? IMPOSSIBLE_MIN : ENTRY;
      return {
        ok: true,
        outcome: "won",
        payout: payoutFor(difficulty, nominal),
        newBalance: null,
        devMode: true,
      };
    }
    return {
      ok: false,
      outcome: "down",
      distancePct: sim.distancePct,
      restartsLeft: MAX_RESTARTS,
      devMode: true,
    };
  }

  const row = (await prisma.geoRun.findUnique({
    where: { discordId_date: { discordId, date: getChallengeDate() } },
  })) as GeoRunRow | null;
  if (!row) {
    return { ok: false, outcome: "error", reason: "No run to submit. Start again." };
  }
  if (row.difficulty !== difficulty) {
    return { ok: false, outcome: "error", reason: "Run token does not match today's run." };
  }
  // only the most-recently issued token can submit — a replayed old-attempt
  // token must not double-count as another death
  if (Number(row.tokenIat) !== payload.iat) {
    return {
      ok: false,
      outcome: "error",
      reason: "That attempt has already ended. Restart to play again.",
    };
  }
  if (row.status !== "open") {
    if (row.status === "won") {
      return { ok: true, outcome: "won", payout: row.payout, newBalance: null, devMode: false };
    }
    if (row.status === "spent" || row.status === "lost") {
      return {
        ok: false,
        outcome: "spent",
        distancePct: row.distancePct,
        feesPaid: row.feesPaid,
        devMode: false,
      };
    }
    if (row.status === "rejected") {
      return {
        ok: false,
        outcome: "rejected",
        reason: "This run was rejected by the anti-cheat checks.",
        devMode: false,
      };
    }
    return { ok: false, outcome: "error", reason: "This run was refunded. Start again." };
  }

  // --- plausibility gates -------------------------------------------------
  const gaps: number[] = [];
  const sorted = [...jumpTimes].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);

  const reject = async (
    reason: string,
    detail: Record<string, unknown>,
  ): Promise<SubmitResult> => {
    flagAttempt(discordId, SECTION, reason, detail);
    await prisma.geoRun.updateMany({
      where: { id: row.id, status: "open" },
      data: { status: "rejected", distancePct: sim.distancePct, resolvedAt: new Date() },
    });
    await lockNow(discordId, SECTION);
    return {
      ok: false,
      outcome: "rejected",
      reason: "Run rejected — the recorded input didn't check out.",
      devMode: false,
    };
  };

  if (jumpTimes.length > course.obstacles.length * 4 + 20) {
    return reject("implausible jump count", {
      jumps: jumpTimes.length,
      obstacles: course.obstacles.length,
    });
  }
  if (sorted.length && sorted[0] < 90) {
    return reject("first jump faster than human reaction", { first: Math.round(sorted[0]) });
  }
  if (gaps.some((g) => g < 55)) {
    return reject("jumps faster than humanly possible", {
      minGap: Math.round(Math.min(...gaps)),
    });
  }
  if (sim.reachedEnd && gaps.length >= 6 && stdev(gaps) < 5) {
    return reject("robotic jump cadence", { gapStdev: Number(stdev(gaps).toFixed(2)) });
  }

  // --- clear ------------------------------------------------------------
  if (sim.reachedEnd) {
    if (windowMs < expected * 0.9) {
      return reject("cleared before the level could scroll", {
        windowMs: Math.round(windowMs),
        expected: Math.round(expected),
      });
    }
    if (totalMs < expected * 0.9 || totalMs > expected * 1.6) {
      return reject("reported run time inconsistent with the course", {
        totalMs: Math.round(totalMs),
        expected: Math.round(expected),
      });
    }

    const payout = payoutFor(difficulty, row.stake);
    const claim = await prisma.geoRun.updateMany({
      where: { id: row.id, status: "open" },
      data: { status: "won", payout, distancePct: 100, resolvedAt: new Date() },
    });
    if (claim.count === 0) {
      const cur = (await prisma.geoRun.findUnique({ where: { id: row.id } })) as GeoRunRow;
      return cur?.status === "won"
        ? { ok: true, outcome: "won", payout: cur.payout, newBalance: null, devMode: false }
        : { ok: false, outcome: "error", reason: "This run was already resolved." };
    }

    let newBalance: number | null = null;
    try {
      const bal = await addCurrency(
        discordId,
        payout,
        `Geometry Dash — ${difficulty} cleared`,
        "bank",
      );
      newBalance = bal.total;
    } catch (err) {
      logger.error("geodash.payout_failed", { discordId, payout, message: String(err) });
    }
    await completeSection(discordId, SECTION, 0);
    recordScore(discordId, SECTION, "geoPercent", 100);
    return { ok: true, outcome: "won", payout, newBalance, devMode: false };
  }

  // --- death ----------------------------------------------------------
  recordScore(discordId, SECTION, "geoPercent", sim.distancePct);

  // A replay that dies within a hair of the finish, while the wall-clock and
  // reported time both look like a full clear, is the signature of a
  // client/server physics divergence. Log it so any regression is visible.
  if (
    sim.distancePct >= 99 &&
    windowMs >= expected * 0.9 &&
    totalMs >= expected * 0.9 &&
    totalMs <= expected * 1.6
  ) {
    logger.warn("geodash.near_miss_death", {
      discordId,
      difficulty,
      distancePct: Number(sim.distancePct.toFixed(2)),
      deathAt: sim.deathAt ? Math.round(sim.deathAt) : null,
      windowMs: Math.round(windowMs),
      totalMs: Math.round(totalMs),
      expected: Math.round(expected),
    });
  }

  if (row.restarts < MAX_RESTARTS) {
    // a free restart is left — keep the run open but null the token (`tokenIat`
    // 0 matches nothing) so this attempt can't be re-submitted; the client must
    // call /start to get a fresh token.
    const claim = await prisma.geoRun.updateMany({
      where: { id: row.id, status: "open", tokenIat: BigInt(payload.iat) },
      data: {
        restarts: { increment: 1 },
        deaths: { increment: 1 },
        distancePct: sim.distancePct,
        tokenIat: BigInt(0),
      },
    });
    if (claim.count === 0) {
      const cur = (await prisma.geoRun.findUnique({ where: { id: row.id } })) as GeoRunRow;
      if (cur?.status === "won") {
        return { ok: true, outcome: "won", payout: cur.payout, newBalance: null, devMode: false };
      }
      if (cur?.status === "spent") {
        return {
          ok: false,
          outcome: "spent",
          distancePct: cur.distancePct,
          feesPaid: cur.feesPaid,
          devMode: false,
        };
      }
    }
    return {
      ok: false,
      outcome: "down",
      distancePct: sim.distancePct,
      restartsLeft: Math.max(0, MAX_RESTARTS - (row.restarts + 1)),
      devMode: false,
    };
  }

  // out of free restarts → the fee must be paid again
  await prisma.geoRun.updateMany({
    where: { id: row.id, status: "open", tokenIat: BigInt(payload.iat) },
    data: {
      status: "spent",
      deaths: { increment: 1 },
      distancePct: sim.distancePct,
      resolvedAt: new Date(),
    },
  });
  await lockNow(discordId, SECTION);
  return {
    ok: false,
    outcome: "spent",
    distancePct: sim.distancePct,
    feesPaid: row.feesPaid,
    devMode: false,
  };
}
