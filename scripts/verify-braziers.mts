/**
 * Offline check of The Braziers' board maker: every board is solvable, its
 * shortest solution is exactly PAR touches (found here by brute force, not by
 * the shortcut the maker uses), and two players never share a board.
 *
 *   node --experimental-strip-types --import ./scripts/ts-esm-hook.mjs scripts/verify-braziers.mts
 */
import { deriveBoard } from "../src/lib/braziers/daily";
import { ALL_LIT, CELLS, MOVE_CAP, PAR, SIZE, litCount, touchMask } from "../src/lib/braziers/rules";

let failed = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}

/** Every set of touches that lights `board`: try each top row, then chase the
 *  dark braziers down the hall (a touch below is the only way left to turn one). */
function solutions(board: number): number[] {
  const found: number[] = [];
  for (let top = 0; top < 1 << SIZE; top++) {
    let b = board;
    let set = 0;
    for (let c = 0; c < SIZE; c++) {
      if (top & (1 << c)) {
        b ^= touchMask(c);
        set |= 1 << c;
      }
    }
    for (let i = SIZE; i < CELLS; i++) {
      if (!(b & (1 << (i - SIZE)))) {
        b ^= touchMask(i);
        set |= 1 << i;
      }
    }
    if (b === ALL_LIT) found.push(set);
  }
  return found;
}

const boards = new Set<number>();
let solvable = true;
let parExact = true;
let fourEach = true;
let neverLit = true;
const N = 4000;
for (let n = 0; n < N; n++) {
  const day = `2026-${String(1 + (n % 12)).padStart(2, "0")}-${String(1 + (n % 28)).padStart(2, "0")}`;
  const { board } = deriveBoard(day, `1000000000${10000000 + n * 7919}`);
  boards.add(board);
  const all = solutions(board);
  if (all.length === 0) solvable = false;
  if (all.length !== 4) fourEach = false;
  if (Math.min(...all.map(litCount)) !== PAR) parExact = false;
  if (board === ALL_LIT) neverLit = false;
}

check(solvable, `${N} boards: every one can be lit`);
check(fourEach, "every board has exactly four solutions");
check(parExact, `the shortest solution is always ${PAR} touches`);
check(neverLit, "no board starts fully lit");
check(boards.size > N * 0.95, `boards differ between players (${boards.size} distinct of ${N})`);
check(
  deriveBoard("2026-10-09", "123").board === deriveBoard("2026-10-09", "123").board,
  "the same player and day always give the same board",
);
check(MOVE_CAP > PAR, "the touch limit leaves room above par");

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall good");
