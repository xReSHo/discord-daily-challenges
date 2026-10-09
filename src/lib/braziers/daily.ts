import { createHash } from "node:crypto";
import { ALL_LIT, CELLS, PAR, litCount, touchMask } from "./rules";

const SEED = process.env.BRAZIERS_SEED ?? "daily-challenges";

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

/** Rows of the hall, top first, as a set of touches. */
function touches(rows: string[]): number {
  let set = 0;
  rows.join("").split("").forEach((ch, i) => {
    if (ch === "1") set |= 1 << i;
  });
  return set;
}

/**
 * The two sets of touches that change nothing on a 5x5 hall (and their sum).
 * Adding one to any solution gives another solution, so a board has exactly
 * four — the shortest of them is the board's par.
 */
const QUIET_A = touches(["01110", "10101", "11011", "10101", "01110"]);
const QUIET_B = touches(["10101", "10101", "00000", "10101", "10101"]);
const QUIET = [0, QUIET_A, QUIET_B, QUIET_A ^ QUIET_B];

/** The board left by making every touch in `set` on a fully lit hall. */
export function boardAfter(set: number): number {
  let board = ALL_LIT;
  for (let i = 0; i < CELLS; i++) if (set & (1 << i)) board ^= touchMask(i);
  return board;
}

/** The fewest touches that undo `set`. */
export function fewestTouches(set: number): number {
  return Math.min(...QUIET.map((q) => litCount(set ^ q)));
}

export type BrazierBoard = { board: number };

/**
 * Pure (day, player) -> that player's hall for the day. Nothing is stored: the
 * same pair always gives the same board, and no two players share one, so a
 * solution posted in the server is no use to anyone else.
 *
 * A board is made by touching PAR braziers of a lit hall, kept only when no
 * shorter way back exists — so every board's par is exactly PAR.
 */
export function deriveBoard(dateStr: string, discordId: string): BrazierBoard {
  const seed = createHash("sha256")
    .update(`${SEED}:v1:${dateStr}:${discordId}`)
    .digest()
    .readUInt32BE(0);
  const rand = mulberry32(seed);

  for (;;) {
    let set = 0;
    while (litCount(set) < PAR) set |= 1 << Math.floor(rand() * CELLS);
    if (fewestTouches(set) === PAR) return { board: boardAfter(set) };
  }
}
