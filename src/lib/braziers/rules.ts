/**
 * "The Braziers" — the rules of the board, shared by the page and the server.
 *
 * A hall of SIZE x SIZE braziers, each lit or dark. Touching one turns it and
 * the braziers beside it (up, down, left, right) over. The hall is cleared when
 * every brazier burns.
 *
 * A board is one number: bit `i` is set when brazier `i` (row * SIZE + col) is
 * lit.
 */

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
export const ALL_LIT = (1 << CELLS) - 1;

/** The fewest touches that clear any day's hall — every board is built to it. */
export const PAR = 5;
/** Touches a run may spend before it is lost. */
export const MOVE_CAP = 20;

/** The braziers turned over by touching brazier `i`, as a bit mask. */
export function touchMask(i: number): number {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  let mask = 1 << i;
  if (r > 0) mask |= 1 << (i - SIZE);
  if (r < SIZE - 1) mask |= 1 << (i + SIZE);
  if (c > 0) mask |= 1 << (i - 1);
  if (c < SIZE - 1) mask |= 1 << (i + 1);
  return mask;
}

export function touch(board: number, i: number): number {
  return board ^ touchMask(i);
}

export function isLit(board: number, i: number): boolean {
  return (board & (1 << i)) !== 0;
}

export function litCount(board: number): number {
  let n = 0;
  for (let b = board; b; b &= b - 1) n++;
  return n;
}
