import { createHash } from "node:crypto";
import { getOrCreateDailyContent } from "@/lib/daily-content";
import { ASPECT, type AimLayout, type AimTarget } from "./rules";

const SEED = process.env.AIM_SEED ?? "daily-challenges";
/** The stored layout's name. It changes whenever the rules do, so a day's
 *  layout frozen under the old rules is never served to the new game ("aim"
 *  and "aim2" hold earlier versions; those rows are left as they are). */
const CONTENT_KEY = "aim3";

export const TARGET_COUNT = 30;
export const TTL_MS = 1650;
export const GAP_MS = 700;
export const MAX_MISSES = 5;

/** The three sizes of mark (radius as a fraction of the area's width), and how
 *  often each comes up. */
const SIZES = [
  { r: 0.054, share: 0.3 },
  { r: 0.042, share: 0.42 },
  { r: 0.031, share: 0.28 },
];
/** How many of the marks drift, and how fast (widths per second). */
const MOVING_SHARE = 0.46;
const SPEED_MIN = 0.12;
const SPEED_MAX = 0.28;

/** Small, fast, seedable PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round4 = (n: number) => Number(n.toFixed(4));

/** Pure date -> the day's run of marks. Exported for verification scripts. */
export function deriveDailyLayout(dateStr: string): AimLayout {
  const seed = createHash("sha256").update(`${SEED}:v3:${dateStr}`).digest().readUInt32BE(0);
  const rand = mulberry32(seed);
  const life = TTL_MS / 1000;

  const targets: AimTarget[] = [];
  for (let i = 0; i < TARGET_COUNT; i++) {
    let pick = rand();
    const size = SIZES.find((s) => (pick -= s.share) < 0) ?? SIZES[1];
    const r = size.r;
    // the room a mark needs to stay wholly on the board, across and down
    const mx = r + 0.02;
    const my = r * ASPECT + 0.03;

    // somewhere clear of the mark before it, so two never sit on top of each other
    let x = 0.5;
    let y = 0.5;
    for (let attempt = 0; attempt < 8; attempt++) {
      x = mx + rand() * (1 - 2 * mx);
      y = my + rand() * (1 - 2 * my);
      const prev = targets[i - 1];
      if (!prev || Math.hypot(x - prev.x, (y - prev.y) / ASPECT) > 0.2) break;
    }

    // the first two hold still, as a way in
    let vx = 0;
    let vy = 0;
    if (i >= 2 && rand() < MOVING_SHARE) {
      const speed = SPEED_MIN + rand() * (SPEED_MAX - SPEED_MIN);
      const angle = rand() * Math.PI * 2;
      vx = Math.cos(angle) * speed;
      vy = Math.sin(angle) * speed * ASPECT;
      // head back towards the middle rather than off the edge
      if (x + vx * life < mx || x + vx * life > 1 - mx) vx = -vx;
      if (y + vy * life < my || y + vy * life > 1 - my) vy = -vy;
      // still leaving the board (started near a corner, moving fast): slow down
      const fit = (pos: number, v: number, m: number) =>
        v === 0 ? 1 : Math.min(1, v > 0 ? (1 - m - pos) / (v * life) : (pos - m) / (-v * life));
      const k = Math.max(0, Math.min(fit(x, vx, mx), fit(y, vy, my)));
      vx *= k;
      vy *= k;
    }
    targets.push({ x: round4(x), y: round4(y), r, vx: round4(vx), vy: round4(vy) });
  }
  return { v: 2, targets, ttlMs: TTL_MS, gapMs: GAP_MS, maxMisses: MAX_MISSES };
}

export async function getDailyLayout(): Promise<AimLayout> {
  return getOrCreateDailyContent<AimLayout>(CONTENT_KEY, deriveDailyLayout);
}
