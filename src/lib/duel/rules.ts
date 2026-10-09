/**
 * The Pit: the rules of a duel, as plain functions.
 *
 * Two fighters each choose, in secret, an order of five moves. The orders are
 * then played against each other round by round; the first to win three
 * rounds wins the duel. Strike beats Feint, Feint beats Guard, Guard beats
 * Strike; the same move twice is a tied round and scores nothing.
 *
 * Equipment never touches who wins. A sword only lowers the cut the pit takes
 * from its bearer's winnings (see `cutFor`).
 *
 * No server deps — the page uses the same functions to draw a fight that the
 * server used to decide it.
 */

export type Move = "S" | "G" | "F";

export const MOVES: Record<Move, { name: string; beats: Move; line: string }> = {
  S: { name: "Strike", beats: "F", line: "Cuts down a Feint" },
  G: { name: "Guard", beats: "S", line: "Turns a Strike aside" },
  F: { name: "Feint", beats: "G", line: "Slips past a Guard" },
};

export const MOVE_IDS = Object.keys(MOVES) as Move[];
export const ROUNDS = 5;
export const WIN_AT = 3;

/** The smallest stake, and the largest the books can hold. */
export const MIN_STAKE = 100;
export const MAX_STAKE = 1_000_000_000_000;
/** The share of the pot the pit keeps from the winner, in percent — the
 *  default; the live figure is set in /admin/pit. */
export const CUT = 5;
/** Each step of sword rarity takes a tenth off the cut: 5% down to 2.5%. */
export const CUT_PER_SWORD = 0.1;

/**
 * The pit's cut, in percent, for a winner whose sword is `sword` (0 none … 5
 * legendary), from a base cut of `cut`.
 */
export function cutFor(sword: number, cut = CUT): number {
  const share = 1 - CUT_PER_SWORD * Math.max(0, Math.min(5, sword));
  return Math.round(cut * share * 100) / 100;
}

/** A fighter's five moves from untrusted input: "SGFSG" or ["S","G",…]. */
export function parseMoves(raw: unknown): Move[] | null {
  const list = typeof raw === "string" ? [...raw] : Array.isArray(raw) ? raw : null;
  if (!list || list.length !== ROUNDS) return null;
  return list.every((m) => m === "S" || m === "G" || m === "F") ? (list as Move[]) : null;
}

export type Side = "a" | "b";

export type Round = {
  a: Move;
  b: Move;
  /** Who took the round. */
  win: Side | "tie";
};

export type Fight = {
  /** The rounds that were fought: the duel stops once someone has three. */
  rounds: Round[];
  a: number;
  b: number;
  winner: Side | "draw";
};

/** Play two orders of moves against each other. */
export function fight(a: Move[], b: Move[]): Fight {
  const rounds: Round[] = [];
  const score = { a: 0, b: 0 };
  for (let i = 0; i < ROUNDS && score.a < WIN_AT && score.b < WIN_AT; i++) {
    const win: Round["win"] = a[i] === b[i] ? "tie" : MOVES[a[i]].beats === b[i] ? "a" : "b";
    if (win !== "tie") score[win]++;
    rounds.push({ a: a[i], b: b[i], win });
  }
  return {
    rounds,
    a: score.a,
    b: score.b,
    winner: score.a === score.b ? "draw" : score.a > score.b ? "a" : "b",
  };
}

/**
 * What the winner takes from a pot of two equal stakes, and what the pit
 * keeps. `sword` is the winner's sword (0 none … 5 legendary), `cut` the pit's
 * base cut in percent.
 */
export function split(stake: number, sword = 0, cut = CUT): { payout: number; rake: number } {
  const pot = stake * 2;
  const rake = Math.floor((pot * cutFor(sword, cut)) / 100);
  return { payout: pot - rake, rake };
}

// --- standing ---------------------------------------------------------------

export const START_MMR = 1000;
/** How far one duel can move a rating. */
const K = 32;

export const RANKS = [
  { id: "squire", name: "Squire", from: 0 },
  { id: "duelist", name: "Duelist", from: 1100 },
  { id: "pitlord", name: "Pit Lord", from: 1300 },
] as const;

export type Rank = (typeof RANKS)[number];

export function rankOf(mmr: number): Rank {
  return [...RANKS].reverse().find((r) => mmr >= r.from) ?? RANKS[0];
}

/** The rank after this one, or null at the top. */
export function nextRank(mmr: number): Rank | null {
  return RANKS.find((r) => r.from > mmr) ?? null;
}

/**
 * How much side A's rating moves (B's moves the same amount the other way).
 * Beating someone rated above you is worth more than beating someone below.
 * `score` is 1 for a win, 0 for a loss, 0.5 for a draw.
 */
export function mmrDelta(a: number, b: number, score: 0 | 0.5 | 1): number {
  const expected = 1 / (1 + Math.pow(10, (b - a) / 400));
  return Math.round(K * (score - expected));
}
