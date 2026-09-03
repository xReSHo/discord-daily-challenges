import { createHash } from "node:crypto";
import { getOrCreateDailyContent } from "@/lib/daily-content";

const SEED = process.env.LITANY_SEED ?? "daily-challenges";
const SECTION = "litany";

/** Sigils on the ring. */
export const GLYPHS = 7;
/** Longest rite the day holds — the ceiling on rounds (and the prize). */
export const SEQUENCE_LENGTH = Math.max(
  12,
  Number(process.env.LITANY_MAX_ROUND) || 30,
);
/** The first round shown — the sequence is `startRound` glyph(s) long to begin. */
export const START_ROUND = 1;
/**
 * Clear a sequence this long and the day is passed. Higher rounds are for score.
 * The default sits around an adult's working-memory span for a 7-symbol set —
 * roughly the length a focused person reaches, so it's a real filter rather than
 * a formality. Tune with `LITANY_PASS_ROUND`.
 */
export const PASS_ROUND = Math.max(
  START_ROUND,
  Number(process.env.LITANY_PASS_ROUND) || 10,
);

/** Small, fast, seedable PRNG (same one the aim game uses). */
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

export type LitanySequence = { sequence: number[] };

/** Pure date -> glyph sequence. Exported for verification scripts. */
export function deriveDailyLitany(dateStr: string): LitanySequence {
  const seed = createHash("sha256")
    .update(`${SEED}:${dateStr}`)
    .digest()
    .readUInt32BE(0);
  const rand = mulberry32(seed);

  const sequence: number[] = [];
  let last = -1;
  for (let i = 0; i < SEQUENCE_LENGTH; i++) {
    // no immediate repeats — every flash is then an unambiguous new glyph
    let g = Math.floor(rand() * GLYPHS);
    if (g === last) g = (g + 1) % GLYPHS;
    sequence.push(g);
    last = g;
  }
  return { sequence };
}

export async function getDailyLitany(): Promise<LitanySequence> {
  return getOrCreateDailyContent<LitanySequence>(SECTION, deriveDailyLitany);
}
