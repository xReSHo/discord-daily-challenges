/**
 * "The Litany" — sequence-memory scoring and anti-cheat.
 *
 * Token-stateful like Aim/Typing. `startLitany` hands the client the full seeded
 * glyph sequence plus a signed token carrying `iat`; the client only *reveals*
 * the sequence one flash at a time. On submit the client returns every glyph it
 * tapped (each round replays the whole sequence-so-far, Simon-style) with a
 * timestamp per tap. The server checks:
 *   - the taps are an exact prefix of today's seeded stream
 *   - taps are strictly increasing and above a human gap floor
 *   - the run did not clear rounds faster than the flashes can physically play
 *     (`iat` is the authoritative start — the client cannot forge elapsed time)
 *   - the cadence is not a fixed-interval replay (bot)
 */

import { getChallengeDateString } from "@/lib/challenge-date";
import { signToken, verifyToken } from "@/lib/session-token";
import {
  completeSection,
  getCompletedSectionsToday,
  type CompleteResult,
} from "@/lib/completions";
import { getAttempt, recordFail, lockNow } from "@/lib/attempts";
import { flagAttempt } from "@/lib/audit";
import { recordScore } from "@/lib/scores";
import { SECTIONS } from "@/lib/sections";
import {
  getDailyLitany,
  GLYPHS,
  PASS_ROUND,
  SEQUENCE_LENGTH,
  START_ROUND,
} from "./daily";

const SECTION = "litany" as const;
const TOKEN_TTL_MS = 15 * 60 * 1000;

/** Base prize for sealing at PASS_ROUND. */
const BASE_PRIZE = SECTIONS.litany.reward;
/** Each round cleared *past* PASS_ROUND adds this to the prize. */
export const CONTINUE_BONUS = Math.max(
  0,
  Number(process.env.LITANY_CONTINUE_BONUS) || 100,
);

/** The prize for sealing after clearing `round` (>= PASS_ROUND). */
export function litanyPrize(round: number): number {
  return BASE_PRIZE + CONTINUE_BONUS * Math.max(0, round - PASS_ROUND);
}

/** Client flash timing. The server uses the cycle as the "you can't have seen
 *  N flashes faster than this" floor. Keep in sync with LitanyGame.tsx. */
export const FLASH_ON_MS = 480;
export const FLASH_GAP_MS = 200;
const FLASH_CYCLE_MS = FLASH_ON_MS + FLASH_GAP_MS;
/** Slack for fast devices / RAF jitter — the floor is 70% of nominal. */
const FLASH_SLACK = 0.7;
/** Fastest plausible gap between two deliberate taps. */
const MIN_TAP_GAP_MS = 85;

export type StartResult = {
  sequence: number[];
  glyphs: number;
  startRound: number;
  passRound: number;
  maxRound: number;
  flashOnMs: number;
  flashGapMs: number;
  basePrize: number;
  continueBonus: number;
  token: string;
  alreadyCompleted: boolean;
  failed: boolean;
};

export async function startLitany(discordId: string): Promise<StartResult> {
  const [{ sequence }, completed, attempt] = await Promise.all([
    getDailyLitany(),
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, SECTION),
  ]);
  const token = signToken({
    d: discordId,
    day: getChallengeDateString(),
    s: SECTION,
  });
  return {
    sequence,
    glyphs: GLYPHS,
    startRound: START_ROUND,
    passRound: PASS_ROUND,
    maxRound: SEQUENCE_LENGTH,
    flashOnMs: FLASH_ON_MS,
    flashGapMs: FLASH_GAP_MS,
    basePrize: BASE_PRIZE,
    continueBonus: CONTINUE_BONUS,
    token,
    alreadyCompleted: completed.has(SECTION),
    failed: attempt.failed,
  };
}

type TokenPayload = { d: string; day: string; s: string; iat: number };

export type SubmitInput = { token: unknown; taps: unknown; tapTimes: unknown };
export type SubmitResult =
  | { ok: true; round: number; prize: number; reward: CompleteResult }
  | {
      ok: false;
      reason: string;
      round?: number;
      /** true when a post-seal slip cost the guaranteed prize (day locked). */
      lostPrize?: boolean;
      /** true when the day's rite was already failed. */
      locked?: boolean;
    };

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** Taps needed to have fully cleared through round `r` (rounds START_ROUND..r,
 *  each replaying `k` glyphs). 0 for r < START_ROUND. */
function tapsToClear(r: number): number {
  if (r < START_ROUND) return 0;
  const a = START_ROUND;
  return (r * (r + 1) - (a - 1) * a) / 2;
}

/** The full expected tap stream for a perfect run through `maxRound`. */
function expectedStream(sequence: number[]): number[] {
  const out: number[] = [];
  for (let r = START_ROUND; r <= SEQUENCE_LENGTH; r++) {
    for (let i = 0; i < r; i++) out.push(sequence[i]);
  }
  return out;
}

export async function submitLitany(
  discordId: string,
  input: SubmitInput,
): Promise<SubmitResult> {
  const token = typeof input.token === "string" ? input.token : "";
  const payload = verifyToken<TokenPayload>(token);
  if (!payload || payload.s !== SECTION || payload.d !== discordId) {
    return { ok: false, reason: "Invalid session. Start the rite again." };
  }
  if (payload.day !== getChallengeDateString()) {
    return { ok: false, reason: "That rite was from another day. Start again." };
  }
  const windowMs = Date.now() - payload.iat;
  if (windowMs > TOKEN_TTL_MS) {
    return { ok: false, reason: "Session expired. Start the rite again." };
  }

  if ((await getAttempt(discordId, SECTION)).failed) {
    return {
      ok: false,
      reason: "You pushed past the seal earlier — today's rite is lost.",
      locked: true,
    };
  }

  const taps = Array.isArray(input.taps) ? input.taps.map(Number) : null;
  const tapTimes = Array.isArray(input.tapTimes)
    ? input.tapTimes.map(Number)
    : null;
  if (
    !taps ||
    !tapTimes ||
    taps.length !== tapTimes.length ||
    taps.length === 0 ||
    !taps.every((n) => Number.isInteger(n) && n >= 0 && n < GLYPHS) ||
    !tapTimes.every(Number.isFinite)
  ) {
    flagAttempt(discordId, SECTION, "malformed litany submission");
    return { ok: false, reason: "Malformed round data." };
  }

  const { sequence } = await getDailyLitany();
  const full = expectedStream(sequence);
  if (taps.length > full.length + 1) {
    flagAttempt(discordId, SECTION, "more taps than the sequence allows");
    return { ok: false, reason: "Malformed round data." };
  }

  // longest correct prefix
  let m = 0;
  while (m < taps.length && m < full.length && taps[m] === full[m]) m++;
  // the client stops on the first wrong glyph, so at most one extra tap is ok
  if (taps.length > m + 1) {
    flagAttempt(discordId, SECTION, "kept tapping after a wrong glyph", {
      matched: m,
      submitted: taps.length,
    });
    return { ok: false, reason: "Malformed round data." };
  }

  // A rejected run — track it (retryable), never a "lost the prize" lock.
  async function reject(reason: string): Promise<SubmitResult> {
    await recordFail(discordId, SECTION);
    return { ok: false, reason };
  }

  // rounds fully cleared
  let cleared = START_ROUND - 1;
  while (cleared + 1 <= SEQUENCE_LENGTH && tapsToClear(cleared + 1) <= m) cleared++;
  // a trailing wrong tap = the player slipped; all-correct taps = a voluntary seal
  const slipped = taps.length > m;
  if (cleared < START_ROUND) {
    await recordFail(discordId, SECTION);
    return { ok: false, reason: "The rite broke almost at once.", round: 0 };
  }

  // timing: strictly increasing, human gaps
  const gaps: number[] = [];
  for (let i = 1; i < tapTimes.length; i++) {
    const g = tapTimes[i] - tapTimes[i - 1];
    if (g <= 0) {
      flagAttempt(discordId, SECTION, "tap timestamps not increasing");
      return reject("Tap timestamps are not increasing.");
    }
    gaps.push(g);
  }
  if (gaps.some((g) => g < MIN_TAP_GAP_MS)) {
    flagAttempt(discordId, SECTION, "taps faster than humanly possible", {
      minGap: Math.round(Math.min(...gaps)),
      floor: MIN_TAP_GAP_MS,
    });
    return reject("Taps came faster than humanly possible.");
  }

  const attempted =
    m > tapsToClear(cleared) ? Math.min(cleared + 1, SEQUENCE_LENGTH) : cleared;
  const minWatchMs = tapsToClear(attempted) * FLASH_CYCLE_MS * FLASH_SLACK;
  if (windowMs < minWatchMs) {
    flagAttempt(discordId, SECTION, "rounds cleared faster than the flashes play", {
      windowMs,
      minWatchMs: Math.round(minWatchMs),
      round: cleared,
    });
    return reject("Rounds cleared faster than the rite can be shown.");
  }

  if (gaps.length >= 5 && stdev(gaps) < 8) {
    flagAttempt(discordId, SECTION, "robotic tap cadence", {
      gapStdev: Number(stdev(gaps).toFixed(2)),
    });
    return reject("Robotic input cadence — rejected.");
  }

  // --- outcome ---

  if (cleared < PASS_ROUND) {
    // didn't pass — retryable, no lock
    await recordFail(discordId, SECTION);
    return {
      ok: false,
      reason: `Reached round ${cleared}. Clear round ${PASS_ROUND} to pass.`,
      round: cleared,
    };
  }

  if (slipped) {
    // cleared the seal point, chose to continue, and slipped -> lose it all
    recordScore(discordId, SECTION, "litanyRound", cleared);
    await lockNow(discordId, SECTION);
    return {
      ok: false,
      reason: `Round ${cleared} — you pushed past the seal and the rite broke. The prize is lost.`,
      round: cleared,
      lostPrize: true,
    };
  }

  // sealed at or past PASS_ROUND
  const prize = litanyPrize(cleared);
  const reward = await completeSection(discordId, SECTION, prize);
  recordScore(discordId, SECTION, "litanyRound", cleared);
  return { ok: true, round: cleared, prize, reward };
}
