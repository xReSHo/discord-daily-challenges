/**
 * Typing test scoring and anti-cheat.
 *
 * The server issues a signed token at start (carrying `iat`). On submit it
 * trusts only:
 *   - `iat` from the token  -> the real time window the attempt had
 *   - the daily paragraph    -> the expected characters
 *   - what the client typed  -> for accuracy
 * The client also reports `durationMs` (first keystroke -> submit) and a
 * `keystrokes` count; both are sanity-checked against the server window and
 * against each other. A paste has ~0 keystrokes; an instant submit blows the
 * duration floor; a scripted sprint blows the WPM ceiling.
 *
 * Retry economy: fails 1..FREE_FAILS are free (prize stays at base). Each fail
 * beyond that drops the day's prize by FAIL_DROP; once it would hit 0 the
 * day's challenge is failed (locked). See src/lib/attempts.ts.
 */

import { getChallengeDateString } from "@/lib/challenge-date";
import { signToken, verifyToken } from "@/lib/session-token";
import {
  completeSection,
  getCompletedSectionsToday,
  type CompleteResult,
} from "@/lib/completions";
import { getAttempt, recordFail } from "@/lib/attempts";
import { flagAttempt } from "@/lib/audit";
import { recordScore } from "@/lib/scores";
import { SECTIONS } from "@/lib/sections";
import { getDailyParagraph } from "./daily";

const SECTION = "typing" as const;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_WPM = 220; // sustained typing world record is ~215 wpm
/** Floor speed to pass. The client also fails a run live if it dips under this. */
export const MIN_WPM = Math.max(1, Number(process.env.TYPING_MIN_WPM) || 30);
/** A run fails after this many wrong characters. The client tracks it live. */
export const MAX_STRIKES = Math.max(1, Number(process.env.TYPING_MAX_STRIKES) || 3);
const MIN_DURATION_MS = 4000;
const MIN_COMPLETION = 0.85; // must type at least this fraction of the paragraph

/** Full prize before any drop. */
const BASE_PRIZE = SECTIONS.typing.reward;
/** Losing runs 1..FREE_FAILS don't touch the prize. */
export const FREE_FAILS = Math.max(0, Number(process.env.TYPING_FREE_FAILS) || 6);
/** Each fail past FREE_FAILS drops the prize by this. */
export const FAIL_DROP = Math.max(1, Number(process.env.TYPING_FAIL_DROP) || 100);
/** Fail count at which the day is locked (prize would be 0). */
export const LOCK_AT = FREE_FAILS + Math.ceil(BASE_PRIZE / FAIL_DROP);

/** The day's prize given how many losing runs have already happened. */
export function prizeFor(fails: number): number {
  const dropped = BASE_PRIZE - FAIL_DROP * Math.max(0, fails - FREE_FAILS);
  return Math.max(0, Math.min(BASE_PRIZE, dropped));
}

export type StartResult = {
  text: string;
  token: string;
  alreadyCompleted: boolean;
  failed: boolean;
  fails: number;
  prize: number;
};

export async function startTest(discordId: string): Promise<StartResult> {
  const [text, completed, attempt] = await Promise.all([
    getDailyParagraph(),
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, SECTION),
  ]);
  const token = signToken({ d: discordId, day: getChallengeDateString(), s: SECTION });
  return {
    text,
    token,
    alreadyCompleted: completed.has(SECTION),
    failed: attempt.failed,
    fails: attempt.fails,
    prize: prizeFor(attempt.fails),
  };
}

type TokenPayload = { d: string; day: string; s: string; iat: number };

export type SubmitInput = {
  token: unknown;
  typed: unknown;
  durationMs: unknown;
  keystrokes: unknown;
  /** Client's strike count — one per burst of mistakes (grace-windowed). */
  strikes: unknown;
};

export type SubmitResult =
  | { ok: true; wpm: number; accuracy: number; reward: CompleteResult }
  | {
      ok: false;
      reason: string;
      wpm?: number;
      accuracy?: number;
      /** Present on a genuine losing run — the day's state after it. */
      fails?: number;
      prize?: number;
      failed?: boolean;
      locked?: boolean;
    };

export async function submitTest(
  discordId: string,
  input: SubmitInput,
): Promise<SubmitResult> {
  const token = typeof input.token === "string" ? input.token : "";
  const typed = typeof input.typed === "string" ? input.typed : "";
  const durationMs = Number(input.durationMs);
  const keystrokes = Number(input.keystrokes);
  const reportedStrikes = Number(input.strikes);

  const payload = verifyToken<TokenPayload>(token);
  if (!payload || payload.s !== SECTION || payload.d !== discordId) {
    return { ok: false, reason: "Invalid session. Start the test again." };
  }
  if (payload.day !== getChallengeDateString()) {
    return { ok: false, reason: "That test was from another day. Start again." };
  }
  const windowMs = Date.now() - payload.iat;
  if (windowMs > TOKEN_TTL_MS) {
    return { ok: false, reason: "Session expired. Start the test again." };
  }

  // From here it's a genuine attempt. A locked day rejects it outright; any
  // other non-ok result counts as a losing run.
  const before = await getAttempt(discordId, SECTION);
  if (before.failed) {
    return {
      ok: false,
      reason: "You're out of tries for today's typing test.",
      locked: true,
      failed: true,
      fails: before.fails,
      prize: 0,
    };
  }

  async function lose(reason: string, extra: { wpm?: number; accuracy?: number } = {}) {
    const after = await recordFail(discordId, SECTION, { lockAt: LOCK_AT });
    return {
      ok: false as const,
      reason,
      ...extra,
      fails: after.fails,
      prize: prizeFor(after.fails),
      failed: after.failed,
    };
  }

  const target = await getDailyParagraph();

  if (typed.length < target.length * MIN_COMPLETION) {
    return lose("You didn't finish the paragraph.");
  }

  let correct = 0;
  for (let i = 0; i < target.length; i++) {
    if (typed[i] === target[i]) correct++;
  }
  const accuracy = correct / target.length;
  const wrong = target.length - correct;

  const strikes =
    Number.isFinite(reportedStrikes) && reportedStrikes >= 0
      ? Math.floor(reportedStrikes)
      : wrong;
  if (strikes >= MAX_STRIKES) {
    return lose(`${MAX_STRIKES} strikes — too many mistakes.`, { accuracy });
  }
  const wrongCeiling = Math.max(10, Math.ceil(target.length * 0.1));
  if (wrong > wrongCeiling) {
    if (strikes < MAX_STRIKES) {
      flagAttempt(discordId, SECTION, "error count far exceeds reported strikes", {
        wrong,
        reportedStrikes: strikes,
        wrongCeiling,
      });
    }
    return lose(`Too many mistakes (${wrong}).`, { accuracy });
  }

  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS) {
    flagAttempt(discordId, SECTION, "impossibly fast completion", {
      durationMs,
      windowMs,
    });
    return lose("Completed impossibly fast - rejected.", { accuracy });
  }
  if (durationMs > windowMs + 3000) {
    flagAttempt(discordId, SECTION, "reported time exceeds session window", {
      durationMs,
      windowMs,
    });
    return lose("Reported time doesn't match the session - rejected.");
  }
  if (!Number.isFinite(keystrokes) || keystrokes < target.length * 0.6) {
    flagAttempt(discordId, SECTION, "keystroke count too low (pasted?)", {
      keystrokes,
      targetLength: target.length,
    });
    return lose("Input looks pasted, not typed - rejected.", { accuracy });
  }

  const netWpm = correct / 5 / (durationMs / 60000);
  const serverWpm = correct / 5 / (windowMs / 60000);

  if (netWpm > MAX_WPM || serverWpm > MAX_WPM) {
    flagAttempt(discordId, SECTION, "WPM not humanly plausible", {
      netWpm: Math.round(netWpm),
      serverWpm: Math.round(serverWpm),
      maxWpm: MAX_WPM,
    });
    return lose(`${Math.round(netWpm)} WPM is not humanly plausible - rejected.`, {
      wpm: Math.round(netWpm),
      accuracy,
    });
  }
  if (netWpm < MIN_WPM) {
    return lose(`${Math.round(netWpm)} WPM is below the ${MIN_WPM} WPM minimum.`, {
      wpm: Math.round(netWpm),
      accuracy,
    });
  }

  const prize = prizeFor(before.fails);
  const reward = await completeSection(discordId, SECTION, prize);
  recordScore(discordId, SECTION, "wpm", Math.round(netWpm));
  return { ok: true, wpm: Math.round(netWpm), accuracy, reward };
}
