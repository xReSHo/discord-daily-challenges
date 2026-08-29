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
 */

import { getChallengeDateString } from "@/lib/challenge-date";
import { signToken, verifyToken } from "@/lib/session-token";
import {
  completeSection,
  getCompletedSectionsToday,
  type CompleteResult,
} from "@/lib/completions";
import { flagAttempt } from "@/lib/audit";
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

export type StartResult = {
  text: string;
  token: string;
  alreadyCompleted: boolean;
};

export async function startTest(discordId: string): Promise<StartResult> {
  const [text, completed] = await Promise.all([
    getDailyParagraph(),
    getCompletedSectionsToday(discordId),
  ]);
  const token = signToken({ d: discordId, day: getChallengeDateString(), s: SECTION });
  return { text, token, alreadyCompleted: completed.has(SECTION) };
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
  | { ok: false; reason: string; wpm?: number; accuracy?: number };

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

  const target = await getDailyParagraph();

  if (typed.length < target.length * MIN_COMPLETION) {
    return { ok: false, reason: "You didn't finish the paragraph." };
  }

  let correct = 0;
  for (let i = 0; i < target.length; i++) {
    if (typed[i] === target[i]) correct++;
  }
  const accuracy = correct / target.length;
  const wrong = target.length - correct;

  // Strike rule. The client counts one strike per burst of mistakes (a short
  // grace window after each), so a two-key slip or letter+space is one strike,
  // not two. Trust that count for the strike-out when it's sane...
  const strikes =
    Number.isFinite(reportedStrikes) && reportedStrikes >= 0
      ? Math.floor(reportedStrikes)
      : wrong;
  if (strikes >= MAX_STRIKES) {
    return {
      ok: false,
      reason: `${MAX_STRIKES} strikes — too many mistakes.`,
      accuracy,
    };
  }
  // ...but still hard-fail a run whose final text is mostly wrong. No grace
  // window excuses that many errors, and it's what a tampered count would hide.
  const wrongCeiling = Math.max(10, Math.ceil(target.length * 0.1));
  if (wrong > wrongCeiling) {
    if (strikes < MAX_STRIKES) {
      flagAttempt(discordId, SECTION, "error count far exceeds reported strikes", {
        wrong,
        reportedStrikes: strikes,
        wrongCeiling,
      });
    }
    return {
      ok: false,
      reason: `Too many mistakes (${wrong}).`,
      accuracy,
    };
  }

  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS) {
    flagAttempt(discordId, SECTION, "impossibly fast completion", {
      durationMs,
      windowMs,
    });
    return { ok: false, reason: "Completed impossibly fast - rejected.", accuracy };
  }
  if (durationMs > windowMs + 3000) {
    flagAttempt(discordId, SECTION, "reported time exceeds session window", {
      durationMs,
      windowMs,
    });
    return { ok: false, reason: "Reported time doesn't match the session - rejected." };
  }
  if (!Number.isFinite(keystrokes) || keystrokes < target.length * 0.6) {
    flagAttempt(discordId, SECTION, "keystroke count too low (pasted?)", {
      keystrokes,
      targetLength: target.length,
    });
    return { ok: false, reason: "Input looks pasted, not typed - rejected.", accuracy };
  }

  const netWpm = correct / 5 / (durationMs / 60000);
  const serverWpm = correct / 5 / (windowMs / 60000);

  if (netWpm > MAX_WPM || serverWpm > MAX_WPM) {
    flagAttempt(discordId, SECTION, "WPM not humanly plausible", {
      netWpm: Math.round(netWpm),
      serverWpm: Math.round(serverWpm),
      maxWpm: MAX_WPM,
    });
    return {
      ok: false,
      reason: `${Math.round(netWpm)} WPM is not humanly plausible - rejected.`,
      wpm: Math.round(netWpm),
      accuracy,
    };
  }
  if (netWpm < MIN_WPM) {
    return {
      ok: false,
      reason: `${Math.round(netWpm)} WPM is below the ${MIN_WPM} WPM minimum.`,
      wpm: Math.round(netWpm),
      accuracy,
    };
  }

  const reward = await completeSection(discordId, SECTION);
  return { ok: true, wpm: Math.round(netWpm), accuracy, reward };
}
