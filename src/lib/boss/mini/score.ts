/**
 * The Unraveled Saint — mini-arena scoring + anti-cheat.
 *
 * Self-contained (the daily typing/aim/litany scorers are left untouched), but
 * keeps the same non-negotiable human-speed floors so a scripted run can't
 * out-damage a real one. The server re-derives the content from the token
 * nonce and recomputes every score here — the client's numbers are never
 * trusted. A `flag` means "record a SuspiciousAttempt and deal zero damage".
 */

const MAX_WPM = 220;
const MIN_TYPING_MS = 1200;
const MIN_FIRST_MS = 120;
const MIN_INTERVAL_MS = 80;
const MIN_TAP_GAP_MS = 85;
const FLASH_CYCLE_MS = 680;
const FLASH_SLACK = 0.7;
const ASPECT = 3 / 2;
const HIT_TOLERANCE = 1.5;

export type MiniScore =
  | { ok: true; metric: number; accuracy: number }
  | {
      ok: false;
      reason: string;
      flag?: { reason: string; detail?: Record<string, unknown> };
      metric?: number;
    };

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

// --- typing ---------------------------------------------------------

export function scoreMiniTyping(
  target: string,
  input: { typed?: unknown; durationMs?: unknown; keystrokes?: unknown },
  windowMs: number,
): MiniScore {
  const typed = typeof input.typed === "string" ? input.typed : "";
  const durationMs = Number(input.durationMs);
  const keystrokes = Number(input.keystrokes);

  if (typed.length < target.length) {
    return { ok: false, reason: "The verse wasn't finished." };
  }
  let correct = 0;
  for (let i = 0; i < target.length; i++) if (typed[i] === target[i]) correct++;
  const accuracy = correct / target.length;
  if (accuracy < 0.9) {
    return { ok: false, reason: "Too many slips in the transcription." };
  }
  if (!Number.isFinite(durationMs) || durationMs < MIN_TYPING_MS) {
    return {
      ok: false,
      reason: "Transcribed impossibly fast.",
      flag: { reason: "boss-mini typing impossibly fast", detail: { durationMs } },
    };
  }
  if (durationMs > windowMs + 3000) {
    return {
      ok: false,
      reason: "Reported time doesn't fit the session.",
      flag: { reason: "boss-mini typing time exceeds window", detail: { durationMs, windowMs } },
    };
  }
  if (!Number.isFinite(keystrokes) || keystrokes < target.length * 0.6) {
    return {
      ok: false,
      reason: "That looks pasted, not typed.",
      flag: { reason: "boss-mini typing pasted", detail: { keystrokes, len: target.length } },
    };
  }
  const wpm = correct / 5 / (durationMs / 60000);
  if (wpm > MAX_WPM) {
    return {
      ok: false,
      reason: `${Math.round(wpm)} WPM isn't humanly plausible.`,
      flag: { reason: "boss-mini typing wpm implausible", detail: { wpm: Math.round(wpm) } },
      metric: Math.round(wpm),
    };
  }
  return { ok: true, metric: Math.round(wpm), accuracy };
}

// --- aim -----------------------------------------------------------

type Hit = { i: number; x: number; y: number; t: number };

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
    if (i !== k) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1 || t < 0) return null;
    hits.push({ i, x, y, t });
  }
  return hits;
}

export function scoreMiniAim(
  content: { targets: { x: number; y: number }[]; radius: number; count: number },
  rawHits: unknown,
  windowMs: number,
  timeLimitMs: number,
): MiniScore {
  if (Array.isArray(rawHits) && rawHits.length < content.count) {
    return { ok: false, reason: `Only ${rawHits.length}/${content.count} struck.` };
  }
  const hits = parseHits(rawHits, content.count);
  if (!hits) {
    return {
      ok: false,
      reason: "Malformed round data.",
      flag: { reason: "boss-mini aim malformed" },
    };
  }
  for (const h of hits) {
    const target = content.targets[h.i];
    const dist = Math.hypot(h.x - target.x, (h.y - target.y) / ASPECT);
    if (dist > content.radius * HIT_TOLERANCE) {
      return {
        ok: false,
        reason: "A strike missed its mark.",
        flag: { reason: "boss-mini aim click missed", detail: { i: h.i, dist: +dist.toFixed(4) } },
      };
    }
  }
  const times = hits.map((h) => h.t);
  for (let k = 1; k < times.length; k++) {
    if (times[k] <= times[k - 1]) {
      return {
        ok: false,
        reason: "Strike times aren't increasing.",
        flag: { reason: "boss-mini aim times not increasing" },
      };
    }
  }
  if (times[0] < MIN_FIRST_MS) {
    return {
      ok: false,
      reason: "Impossibly fast first strike.",
      flag: { reason: "boss-mini aim first reaction too fast", detail: { firstMs: times[0] } },
    };
  }
  const intervals = times.slice(1).map((t, k) => t - times[k]);
  if (intervals.some((iv) => iv < MIN_INTERVAL_MS)) {
    return {
      ok: false,
      reason: "Strikes came faster than a hand can move.",
      flag: { reason: "boss-mini aim interval below floor", detail: { min: Math.round(Math.min(...intervals)) } },
    };
  }
  const totalMs = times[times.length - 1];
  if (totalMs > windowMs + 1500) {
    return {
      ok: false,
      reason: "Reported time doesn't fit the session.",
      flag: { reason: "boss-mini aim time exceeds window", detail: { totalMs: Math.round(totalMs), windowMs } },
    };
  }
  if (totalMs > timeLimitMs) {
    return { ok: false, reason: "The trial ran out of time.", metric: Math.round(totalMs / content.count) };
  }
  if (stdev(intervals) < 10) {
    return {
      ok: false,
      reason: "Robotic timing — rejected.",
      flag: { reason: "boss-mini aim robotic timing", detail: { stdev: +stdev(intervals).toFixed(2) } },
    };
  }
  const meanOffset =
    hits.reduce((a, h) => {
      const target = content.targets[h.i];
      return a + Math.hypot(h.x - target.x, (h.y - target.y) / ASPECT);
    }, 0) / hits.length;
  if (meanOffset < content.radius * 0.05) {
    return {
      ok: false,
      reason: "Pixel-perfect clicks — rejected.",
      flag: { reason: "boss-mini aim pixel-perfect", detail: { meanOffset: +meanOffset.toFixed(5) } },
    };
  }
  return { ok: true, metric: Math.round(totalMs / content.count), accuracy: 1 };
}

// --- litany --------------------------------------------------------

/** Taps to have fully cleared through round r (rounds 1..r, Simon replay). */
function tapsToClear(r: number): number {
  return r < 1 ? 0 : (r * (r + 1)) / 2;
}

export function scoreMiniLitany(
  content: { sequence: number[]; glyphs: number },
  input: { taps?: unknown; tapTimes?: unknown },
  windowMs: number,
): MiniScore {
  const taps = Array.isArray(input.taps) ? input.taps.map(Number) : null;
  const tapTimes = Array.isArray(input.tapTimes) ? input.tapTimes.map(Number) : null;
  const len = content.sequence.length;

  if (
    !taps ||
    !tapTimes ||
    taps.length !== tapTimes.length ||
    taps.length === 0 ||
    !taps.every((n) => Number.isInteger(n) && n >= 0 && n < content.glyphs) ||
    !tapTimes.every(Number.isFinite)
  ) {
    return {
      ok: false,
      reason: "Malformed round data.",
      flag: { reason: "boss-mini litany malformed" },
    };
  }

  const full: number[] = [];
  for (let r = 1; r <= len; r++) for (let i = 0; i < r; i++) full.push(content.sequence[i]);
  if (taps.length > full.length + 1) {
    return {
      ok: false,
      reason: "Malformed round data.",
      flag: { reason: "boss-mini litany too many taps" },
    };
  }

  let m = 0;
  while (m < taps.length && m < full.length && taps[m] === full[m]) m++;
  if (taps.length > m + 1) {
    return {
      ok: false,
      reason: "Malformed round data.",
      flag: { reason: "boss-mini litany kept tapping after miss", detail: { matched: m, submitted: taps.length } },
    };
  }

  let cleared = 0;
  while (cleared + 1 <= len && tapsToClear(cleared + 1) <= m) cleared++;

  const gaps: number[] = [];
  for (let i = 1; i < tapTimes.length; i++) {
    const g = tapTimes[i] - tapTimes[i - 1];
    if (g <= 0) {
      return {
        ok: false,
        reason: "Tap times aren't increasing.",
        flag: { reason: "boss-mini litany times not increasing" },
      };
    }
    gaps.push(g);
  }
  if (gaps.some((g) => g < MIN_TAP_GAP_MS)) {
    return {
      ok: false,
      reason: "Taps faster than humanly possible.",
      flag: { reason: "boss-mini litany taps too fast", detail: { min: Math.round(Math.min(...gaps)) } },
    };
  }
  const minWatchMs = tapsToClear(Math.min(cleared + 1, len)) * FLASH_CYCLE_MS * FLASH_SLACK;
  if (windowMs < minWatchMs) {
    return {
      ok: false,
      reason: "Cleared faster than the ribbon can be shown.",
      flag: { reason: "boss-mini litany faster than flashes", detail: { windowMs, minWatchMs: Math.round(minWatchMs) } },
    };
  }
  if (gaps.length >= 5 && stdev(gaps) < 8) {
    return {
      ok: false,
      reason: "Robotic cadence — rejected.",
      flag: { reason: "boss-mini litany robotic cadence", detail: { stdev: +stdev(gaps).toFixed(2) } },
    };
  }

  return { ok: true, metric: cleared, accuracy: 1 };
}
