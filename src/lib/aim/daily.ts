import { createHash } from "node:crypto";
import { getOrCreateDailyContent } from "@/lib/daily-content";

const SEED = process.env.AIM_SEED ?? "daily-challenges";
const SECTION = "aim";

export const TARGET_COUNT = 22;
/** Target radius as a fraction of the play-area width. */
export const TARGET_RADIUS = 0.05;

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

export type AimTargets = {
  targets: { x: number; y: number }[];
  radius: number;
  count: number;
};

/** Pure date -> target layout. Exported for verification scripts. */
export function deriveDailyTargets(dateStr: string): AimTargets {
  const seed = createHash("sha256")
    .update(`${SEED}:${dateStr}`)
    .digest()
    .readUInt32BE(0);
  const rand = mulberry32(seed);

  const targets: { x: number; y: number }[] = [];
  for (let i = 0; i < TARGET_COUNT; i++) {
    // keep targets fully inside the area with a margin
    targets.push({
      x: Number((0.08 + rand() * 0.84).toFixed(4)),
      y: Number((0.1 + rand() * 0.8).toFixed(4)),
    });
  }
  return { targets, radius: TARGET_RADIUS, count: TARGET_COUNT };
}

export async function getDailyTargets(): Promise<AimTargets> {
  return getOrCreateDailyContent<AimTargets>(SECTION, deriveDailyTargets);
}
