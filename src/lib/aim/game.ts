/**
 * Aim trainer scoring and anti-cheat.
 *
 * The server issues a signed token at round start (carrying `iat`). On submit
 * the client returns, for each target in order, the click position and the
 * time in ms since the round clock started. The server checks:
 *   - every click actually landed on its target (distance)
 *   - the timing is physically possible (reaction floor, per-shot floor,
 *     total time fits inside the server's window)
 *   - all targets were cleared before the time limit
 *   - the pattern isn't synthetic (identical intervals, pixel-perfect centres)
 *
 * Retry economy: MAX_TRIES losing runs and the day's challenge is failed
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
import { flagAttempt } from "@/lib/audit";
import { recordScore } from "@/lib/scores";
import { getDailyTargets, type AimTargets } from "./daily";

const SECTION = "aim" as const;
const TOKEN_TTL_MS = 20 * 60 * 1000;
const ASPECT = 3 / 2; // play area width : height
const MIN_FIRST_MS = 120; // reaction time to the first target
const MIN_INTERVAL_MS = 80; // fastest plausible target-to-target
const HIT_TOLERANCE = 1.5; // click must be within radius * this of the centre

/** Losing runs allowed before the day's challenge is failed. */
export const MAX_TRIES = Math.max(1, Number(process.env.AIM_MAX_TRIES) || 3);

/** Total time allowed to clear every target. */
export const TIME_LIMIT_MS = Math.max(
  5000,
  Number(process.env.AIM_TIME_LIMIT_MS) || 18000,
);

export type StartResult = {
  targets: { x: number; y: number }[];
  radius: number;
  count: number;
  timeLimitMs: number;
  token: string;
  alreadyCompleted: boolean;
  failed: boolean;
  /** Losing runs used so far today. */
  tries: number;
  maxTries: number;
};

export async function startRound(discordId: string): Promise<StartResult> {
  const [layout, completed, attempt] = await Promise.all([
    getDailyTargets(),
    getCompletedSectionsToday(discordId),
    getAttempt(discordId, SECTION),
  ]);
  const token = signToken({ d: discordId, day: getChallengeDateString(), s: SECTION });
  return {
    ...layout,
    timeLimitMs: TIME_LIMIT_MS,
    token,
    alreadyCompleted: completed.has(SECTION),
    failed: attempt.failed,
    tries: attempt.fails,
    maxTries: MAX_TRIES,
  };
}

type TokenPayload = { d: string; day: string; s: string; iat: number };
type Hit = { i: number; x: number; y: number; t: number };

export type SubmitResult =
  | { ok: true; avgMs: number; totalMs: number; reward: CompleteResult }
  | {
      ok: false;
      reason: string;
      avgMs?: number;
      tries?: number;
      maxTries?: number;
      failed?: boolean;
      locked?: boolean;
    };

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

function parseHits(raw: unknown, count: number): Hit[] | null {
  if (!Array.isArray(raw) || raw.length !== count) return null;
  const hits: Hit[] = [];
  for (let k = 0; k < raw.length; k++) {
    const h = raw[k] as Record<string, unknown>;
    const i = Number(h?.i);
    const x = Number(h?.x);
    const y = Number(h?.y);
    const t = Number(h?.t);
    if (![i, x, y, t].every(Number.isFinite)) return null;
    if (i !== k) return null; // must be in target order
    if (x < 0 || x > 1 || y < 0 || y > 1 || t < 0) return null;
    hits.push({ i, x, y, t });
  }
  return hits;
}

export async function submitRound(
  discordId: string,
  input: { token: unknown; hits: unknown },
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

  const before = await getAttempt(discordId, SECTION);
  if (before.failed) {
    return {
      ok: false,
      reason: "You're out of tries for today's aim round.",
      locked: true,
      failed: true,
      tries: before.fails,
      maxTries: MAX_TRIES,
    };
  }

  async function lose(reason: string, extra: { avgMs?: number } = {}) {
    const after = await recordFail(discordId, SECTION, { lockAt: MAX_TRIES });
    return {
      ok: false as const,
      reason,
      ...extra,
      tries: after.fails,
      maxTries: MAX_TRIES,
      failed: after.failed,
    };
  }

  const layout: AimTargets = await getDailyTargets();

  // An incomplete run (client timed out / missed out) — a genuine loss, not
  // malformed. More hits than targets *is* malformed.
  if (Array.isArray(input.hits) && input.hits.length < layout.count) {
    return lose(
      `Round lost — cleared ${input.hits.length}/${layout.count} targets.`,
    );
  }

  const hits = parseHits(input.hits, layout.count);
  if (!hits) {
    flagAttempt(discordId, SECTION, "malformed round data");
    return lose("Malformed or incomplete round data.");
  }

  for (const h of hits) {
    const target = layout.targets[h.i];
    const dx = h.x - target.x;
    const dy = (h.y - target.y) / ASPECT;
    const dist = Math.hypot(dx, dy);
    if (dist > layout.radius * HIT_TOLERANCE) {
      flagAttempt(discordId, SECTION, "click missed its target", {
        target: h.i,
        dist: Number(dist.toFixed(4)),
        tolerance: Number((layout.radius * HIT_TOLERANCE).toFixed(4)),
      });
      return lose("Some clicks missed their target.");
    }
  }

  const times = hits.map((h) => h.t);
  for (let k = 1; k < times.length; k++) {
    if (times[k] <= times[k - 1]) {
      flagAttempt(discordId, SECTION, "click timestamps not increasing");
      return lose("Click timestamps are not increasing.");
    }
  }
  if (times[0] < MIN_FIRST_MS) {
    flagAttempt(discordId, SECTION, "impossibly fast first reaction", {
      firstMs: times[0],
      floor: MIN_FIRST_MS,
    });
    return lose("Impossibly fast reaction to the first target.");
  }
  const intervals = times.slice(1).map((t, k) => t - times[k]);
  if (intervals.some((iv) => iv < MIN_INTERVAL_MS)) {
    flagAttempt(discordId, SECTION, "inter-click interval below human floor", {
      minInterval: Math.round(Math.min(...intervals)),
      floor: MIN_INTERVAL_MS,
    });
    return lose("Clicks came faster than humanly possible.");
  }
  const totalMs = times[times.length - 1];
  if (totalMs > windowMs + 1500) {
    flagAttempt(discordId, SECTION, "reported time exceeds session window", {
      totalMs: Math.round(totalMs),
      windowMs,
    });
    return lose("Reported time doesn't fit the session window.");
  }

  if (totalMs > TIME_LIMIT_MS) {
    return lose("Ran out of time — hit every target before the timer ends.", {
      avgMs: Math.round(totalMs / layout.count),
    });
  }

  if (stdev(intervals) < 10) {
    flagAttempt(discordId, SECTION, "robotic timing pattern", {
      intervalStdev: Number(stdev(intervals).toFixed(2)),
    });
    return lose("Robotic timing pattern - rejected.");
  }
  const meanCentreOffset =
    hits.reduce((a, h) => {
      const target = layout.targets[h.i];
      return a + Math.hypot(h.x - target.x, (h.y - target.y) / ASPECT);
    }, 0) / hits.length;
  if (meanCentreOffset < layout.radius * 0.05) {
    flagAttempt(discordId, SECTION, "pixel-perfect centre hits (generated coords)", {
      meanCentreOffset: Number(meanCentreOffset.toFixed(5)),
    });
    return lose("Clicks are pixel-perfect - rejected.");
  }

  const avgMs = Math.round(totalMs / layout.count);
  const reward = await completeSection(discordId, SECTION);
  recordScore(discordId, SECTION, "aimMs", avgMs);
  return { ok: true, avgMs, totalMs: Math.round(totalMs), reward };
}
