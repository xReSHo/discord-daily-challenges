/**
 * Aim trial: starting a round and judging the one sent back.
 *
 * The server issues the day's run of marks and a signed token at round start
 * (carrying `iat`). On submit the page returns every mark it struck — which
 * one, where the shot landed and when — plus how many shots hit nothing. The
 * round is then replayed and judged by ./judge; this file does the reading and
 * writing around that verdict.
 *
 * Retry economy: `aimMaxTries()` losing runs and the day's challenge is failed
 * (locked). See src/lib/attempts.ts.
 */

import { getChallengeDateString } from "@/lib/challenge-date";
import { signToken, verifyToken } from "@/lib/session-token";
import {
  completeSection,
  getCompletedSectionsToday,
  type CompleteResult,
} from "@/lib/completions";
import { getAttempt, recordFail } from "@/lib/attempts";
import { getSectionTries } from "@/lib/section-status";
import { flagAttempt } from "@/lib/audit";
import { recordScore } from "@/lib/scores";
import { getDailyLayout } from "./daily";
import { judgeRound } from "./judge";
import type { AimLayout } from "./rules";

const SECTION = "aim" as const;
const TOKEN_TTL_MS = 20 * 60 * 1000;
/** Losing runs allowed before the day's challenge is failed — live, set in
 *  /admin/games. */
export function aimMaxTries(): Promise<number> {
  return getSectionTries(SECTION);
}

export type StartResult = {
  layout: AimLayout;
  token: string;
  alreadyCompleted: boolean;
  failed: boolean;
  /** Losing runs used so far today. */
  tries: number;
  maxTries: number;
};

export async function startRound(discordId: string): Promise<StartResult> {
  const [layout, completed, attempt, maxTries] = await Promise.all([
    getDailyLayout(),
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, SECTION),
    aimMaxTries(),
  ]);
  const token = signToken({ d: discordId, day: getChallengeDateString(), s: SECTION });
  return {
    layout,
    token,
    alreadyCompleted: completed.has(SECTION),
    failed: attempt.failed,
    tries: attempt.fails,
    maxTries,
  };
}

type TokenPayload = { d: string; day: string; s: string; iat: number };

export type SubmitResult =
  | {
      ok: true;
      /** average time from a mark appearing to it being struck */
      avgMs: number;
      hits: number;
      misses: number;
      reward: CompleteResult;
    }
  | {
      ok: false;
      reason: string;
      avgMs?: number;
      hits?: number;
      tries?: number;
      maxTries?: number;
      failed?: boolean;
      locked?: boolean;
    };

export async function submitRound(
  discordId: string,
  input: { token: unknown; hits: unknown; strays: unknown; aspect: unknown },
): Promise<SubmitResult> {
  const token = typeof input.token === "string" ? input.token : "";

  const payload = verifyToken<TokenPayload>(token);
  if (!payload || payload.s !== SECTION || payload.d !== discordId) {
    return { ok: false, reason: "Invalid session. Start the round again." };
  }
  if (payload.day !== getChallengeDateString()) {
    return { ok: false, reason: "That round was from another day. Start again." };
  }
  const windowMs = Date.now() - payload.iat;
  if (windowMs > TOKEN_TTL_MS) {
    return { ok: false, reason: "Session expired. Start the round again." };
  }

  const [before, maxTries] = await Promise.all([
    getAttempt(discordId, SECTION),
    aimMaxTries(),
  ]);
  if (before.failed) {
    return {
      ok: false,
      reason: "You're out of tries for today's aim round.",
      locked: true,
      failed: true,
      tries: before.fails,
      maxTries,
    };
  }

  async function lose(reason: string, extra: { avgMs?: number; hits?: number } = {}) {
    const after = await recordFail(discordId, SECTION, { lockAt: maxTries });
    return {
      ok: false as const,
      reason,
      ...extra,
      tries: after.fails,
      maxTries,
      failed: after.failed,
    };
  }

  const layout = await getDailyLayout();
  const verdict = judgeRound(layout, input.hits, input.strays, windowMs, input.aspect ?? undefined);

  if (verdict.kind === "rejected") {
    flagAttempt(discordId, SECTION, verdict.flag, verdict.detail);
    return lose(verdict.reason);
  }
  if (verdict.kind === "lost") {
    return lose(`Run lost — ${verdict.reason}`, { avgMs: verdict.avgMs, hits: verdict.hits });
  }

  await recordScore(discordId, SECTION, "aimMs", verdict.avgMs);
  const reward = await completeSection(discordId, SECTION);
  return { ok: true, avgMs: verdict.avgMs, hits: verdict.hits, misses: verdict.misses, reward };
}
