/**
 * Judging an aim round, as pure arithmetic: given the day's marks, what the
 * page says it struck, and how long the server knows has passed, was the run
 * won, lost, or not believable? No database, no clock of its own — so it can
 * be run against recorded rounds in a test. (./game does the reading and
 * writing around it.)
 */

import { ASPECT, MIN_ASPECT, distance, positionAt, reachLimit, schedule, type AimHit, type AimLayout } from "./rules";

const MIN_REACT_MS = 120; // fastest plausible reaction to a mark appearing
const MIN_INTERVAL_MS = 60; // fastest plausible shot-to-shot (two marks can be up at once)
const LATE_SLACK_MS = 150; // a shot may land this long after its mark's time ran out

export type Verdict =
  | { kind: "won"; avgMs: number; hits: number; misses: number }
  /** an honest loss: too many marks let go or shots wasted */
  | { kind: "lost"; reason: string; avgMs: number; hits: number }
  /** not a round a person could have played: logged, and counted as a loss */
  | { kind: "rejected"; reason: string; flag: string; detail?: Record<string, unknown> };

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** The hits as sent, in the order they were made. Null if they are not a
 *  well-formed list of distinct marks with rising times. */
export function parseHits(raw: unknown, count: number): AimHit[] | null {
  if (!Array.isArray(raw) || raw.length > count) return null;
  const hits: AimHit[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const h = item as Record<string, unknown>;
    const i = Number(h?.i);
    const x = Number(h?.x);
    const y = Number(h?.y);
    const t = Number(h?.t);
    if (![i, x, y, t].every(Number.isFinite)) return null;
    if (!Number.isInteger(i) || i < 0 || i >= count || seen.has(i)) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1 || t < 0) return null;
    if (hits.length > 0 && t <= hits[hits.length - 1].t) return null;
    seen.add(i);
    hits.push({ i, x, y, t });
  }
  return hits;
}

export function judgeRound(
  layout: AimLayout,
  rawHits: unknown,
  rawStrays: unknown,
  /** ms since the server issued this round's token */
  windowMs: number,
  /** the shape of the range the page played on (width over height) */
  rawAspect: unknown = ASPECT,
): Verdict {
  const count = layout.targets.length;
  const hits = parseHits(rawHits, count);
  const strays = Number(rawStrays);
  const aspect = Number(rawAspect);
  const shapeOk = Number.isFinite(aspect) && aspect >= MIN_ASPECT - 0.01 && aspect <= ASPECT + 0.01;
  if (!hits || !shapeOk || !Number.isInteger(strays) || strays < 0 || strays > 1000) {
    return { kind: "rejected", reason: "Malformed round data.", flag: "malformed round data" };
  }

  // Replay the round: when each mark was due, given when the struck ones fell.
  const due = schedule(layout, new Map(hits.map((h) => [h.i, h.t])));

  const reactions: number[] = [];
  let offCentre = 0;
  for (const h of hits) {
    const target = layout.targets[h.i];
    const age = h.t - due[h.i];
    if (age < MIN_REACT_MS) {
      return {
        kind: "rejected",
        reason: "A mark was struck faster than humanly possible.",
        flag: "struck a mark before it could be seen",
        detail: { target: h.i, ageMs: Math.round(age), floor: MIN_REACT_MS },
      };
    }
    if (age > layout.ttlMs + LATE_SLACK_MS) {
      return {
        kind: "rejected",
        reason: "A mark was struck after it had gone.",
        flag: "struck a mark after it was gone",
        detail: { target: h.i, ageMs: Math.round(age), ttl: layout.ttlMs },
      };
    }
    const at = positionAt(target, age, aspect);
    const dist = distance(h.x, h.y, at.x, at.y, aspect);
    const reach = reachLimit(target.r);
    if (dist > reach) {
      return {
        kind: "rejected",
        reason: "Some shots missed their mark.",
        flag: "click missed its target",
        detail: { target: h.i, dist: Number(dist.toFixed(4)), tolerance: Number(reach.toFixed(4)) },
      };
    }
    reactions.push(age);
    offCentre += dist / target.r;
  }

  const times = hits.map((h) => h.t);
  const intervals = times.slice(1).map((t, k) => t - times[k]);
  if (intervals.some((iv) => iv < MIN_INTERVAL_MS)) {
    return {
      kind: "rejected",
      reason: "Shots came faster than humanly possible.",
      flag: "inter-click interval below human floor",
      detail: { minInterval: Math.round(Math.min(...intervals)), floor: MIN_INTERVAL_MS },
    };
  }

  const avgMs = reactions.length
    ? Math.round(reactions.reduce((a, b) => a + b, 0) / reactions.length)
    : 0;

  // An honest loss. A run cut short by the page is the same thing: every mark
  // not struck counts as let go.
  const misses = strays + (count - hits.length);
  if (misses >= layout.maxMisses) {
    return {
      kind: "lost",
      reason: `${hits.length} of ${count} marks struck.`,
      avgMs,
      hits: hits.length,
    };
  }

  // A winning round, as replayed, must fit in the time that has really passed
  // since the token was issued: nobody finishes 20 seconds of marks 5 seconds
  // after starting.
  const roundMs = Math.max(times[times.length - 1] ?? 0, due[due.length - 1]);
  if (roundMs > windowMs + 1500) {
    return {
      kind: "rejected",
      reason: "Reported time doesn't fit the session window.",
      flag: "reported time exceeds session window",
      detail: { roundMs: Math.round(roundMs), windowMs },
    };
  }

  if (reactions.length >= 8 && stdev(reactions) < 10) {
    return {
      kind: "rejected",
      reason: "Robotic timing pattern - rejected.",
      flag: "robotic timing pattern",
      detail: { reactionStdev: Number(stdev(reactions).toFixed(2)) },
    };
  }
  // how far from dead centre the shots landed, as a share of each mark's radius
  const meanOffCentre = offCentre / Math.max(1, hits.length);
  if (meanOffCentre < 0.05) {
    return {
      kind: "rejected",
      reason: "Shots are pixel-perfect - rejected.",
      flag: "pixel-perfect centre hits (generated coords)",
      detail: { meanOffCentre: Number(meanOffCentre.toFixed(5)) },
    };
  }

  return { kind: "won", avgMs, hits: hits.length, misses };
}
