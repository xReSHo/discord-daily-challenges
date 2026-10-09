/**
 * "The Braziers" trial: starting a run and judging the one sent back.
 *
 * Token-stateful like Aim/Litany. `startBraziers` hands the page the player's
 * board for the day and a signed token carrying `iat`; on submit the page
 * returns the braziers it touched, in order, and the server replays them on the
 * same board. Nothing about the answer has to be hidden — the puzzle is the
 * board — so the replay is the whole check, plus a floor on how fast a hand can
 * make that many touches.
 *
 * Retry economy: the board is the same on every try, so a try is spent when a
 * run *begins*, not when it is lost — otherwise reloading the page would be a
 * free way to start over. `fails` on the day's `DailyAttempt` row therefore
 * counts runs begun; the day locks when a run is lost (or walked away from)
 * with none left. See src/lib/attempts.ts.
 */

import { getChallengeDateString } from "@/lib/challenge-date";
import { signToken, verifyToken } from "@/lib/session-token";
import {
  completeSection,
  getCompletedSectionsToday,
  type CompleteResult,
} from "@/lib/completions";
import { getAttempt, lockNow, recordFail, type AttemptState } from "@/lib/attempts";
import { getSectionTries } from "@/lib/section-status";
import { flagAttempt } from "@/lib/audit";
import { recordScore } from "@/lib/scores";
import { deriveBoard } from "./daily";
import { ALL_LIT, CELLS, MOVE_CAP, PAR, touch } from "./rules";

const SECTION = "braziers" as const;
const TOKEN_TTL_MS = 30 * 60 * 1000;
/** Fastest a hand can plausibly make one deliberate touch after another. */
const MIN_TOUCH_MS = 120;

/** Runs allowed in a day — live, set in /admin/games. */
export function braziersMaxTries(): Promise<number> {
  return getSectionTries(SECTION);
}

/** true when the day is lost: locked, or the last run was begun and left. */
export function outOfTries(attempt: AttemptState, maxTries: number): boolean {
  return attempt.failed || attempt.fails >= maxTries;
}

export type StartResult =
  | { state: "completed" }
  | { state: "failed"; tries: number; maxTries: number }
  | {
      state: "ready";
      board: number;
      token: string;
      /** Runs begun today, this one included. */
      tries: number;
      maxTries: number;
      par: number;
      cap: number;
    };

export async function startBraziers(discordId: string): Promise<StartResult> {
  const [completed, attempt, maxTries] = await Promise.all([
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, SECTION),
    braziersMaxTries(),
  ]);
  if (completed.has(SECTION)) return { state: "completed" };
  if (outOfTries(attempt, maxTries)) {
    if (!attempt.failed) await lockNow(discordId, SECTION);
    return { state: "failed", tries: attempt.fails, maxTries };
  }

  // the try is spent here, as the run begins
  const after = await recordFail(discordId, SECTION);
  const day = getChallengeDateString();
  return {
    state: "ready",
    board: deriveBoard(day, discordId).board,
    token: signToken({ d: discordId, day, s: SECTION }),
    tries: after.fails,
    maxTries,
    par: PAR,
    cap: MOVE_CAP,
  };
}

type TokenPayload = { d: string; day: string; s: string; iat: number };

export type SubmitResult =
  | { ok: true; touches: number; par: number; reward: CompleteResult }
  | {
      ok: false;
      reason: string;
      tries?: number;
      maxTries?: number;
      /** true when that was the day's last run. */
      failed?: boolean;
    };

export async function submitBraziers(
  discordId: string,
  input: { token: unknown; touches: unknown },
): Promise<SubmitResult> {
  const token = typeof input.token === "string" ? input.token : "";
  const payload = verifyToken<TokenPayload>(token);
  if (!payload || payload.s !== SECTION || payload.d !== discordId) {
    return { ok: false, reason: "Invalid session. Begin again." };
  }
  if (payload.day !== getChallengeDateString()) {
    return { ok: false, reason: "That hall was from another day. Begin again." };
  }
  const windowMs = Date.now() - payload.iat;
  if (windowMs > TOKEN_TTL_MS) {
    return { ok: false, reason: "Session expired. Begin again." };
  }

  const [attempt, maxTries] = await Promise.all([
    getAttempt(discordId, SECTION),
    braziersMaxTries(),
  ]);
  if (attempt.failed) {
    return {
      ok: false,
      reason: "Today's hall is already lost.",
      tries: attempt.fails,
      maxTries,
      failed: true,
    };
  }

  /** The run is lost. Its try was spent when it began; lock the day if that
   *  was the last one. */
  async function lose(reason: string): Promise<SubmitResult> {
    const last = attempt.fails >= maxTries;
    if (last) await lockNow(discordId, SECTION);
    return {
      ok: false,
      reason: last ? `${reason} That was your last try for today.` : reason,
      tries: attempt.fails,
      maxTries,
      failed: last,
    };
  }

  const touches = Array.isArray(input.touches) ? input.touches.map(Number) : null;
  if (
    !touches ||
    touches.length > MOVE_CAP ||
    !touches.every((n) => Number.isInteger(n) && n >= 0 && n < CELLS)
  ) {
    flagAttempt(discordId, SECTION, "malformed braziers submission");
    return lose("Malformed run data.");
  }

  let board = deriveBoard(payload.day, discordId).board;
  let clearedAt = -1;
  touches.forEach((i, n) => {
    board = touch(board, i);
    if (board === ALL_LIT && clearedAt < 0) clearedAt = n;
  });

  if (clearedAt < 0) {
    return lose(
      touches.length >= MOVE_CAP
        ? `All ${MOVE_CAP} touches spent and the hall is not lit.`
        : "You left the hall unlit.",
    );
  }
  // the page stops at the touch that lights the hall
  if (clearedAt !== touches.length - 1) {
    flagAttempt(discordId, SECTION, "kept touching after the hall was lit", {
      clearedAt,
      submitted: touches.length,
    });
    return lose("Malformed run data.");
  }
  if (windowMs < touches.length * MIN_TOUCH_MS) {
    flagAttempt(discordId, SECTION, "touches faster than humanly possible", {
      windowMs,
      touches: touches.length,
    });
    return lose("Touches came faster than humanly possible.");
  }

  await recordScore(discordId, SECTION, "brazierTouches", touches.length);
  const reward = await completeSection(discordId, SECTION);
  return { ok: true, touches: touches.length, par: PAR, reward };
}
