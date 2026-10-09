/**
 * Offline check of the "perfect day" rule now that games can be switched off:
 * a day is perfect when every game *required that day* was cleared.
 *
 *   node --experimental-strip-types --import ./scripts/ts-esm-hook.mjs scripts/verify-perfect-days.mts
 */
import { requiredFor, type Requirements } from "../src/lib/day-requirement-rule";
import { perfectDaysOf } from "../src/lib/day-requirement-rule";

let failed = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}

const ALL = ["wordle", "typing", "aim", "litany", "geodash"];
const day = (d: string, sections: string[]) =>
  sections.map((section) => ({ date: new Date(`${d}T00:00:00.000Z`), section }));
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// No recorded requirement = a day from before the table existed: all five.
check(same(perfectDaysOf(day("2026-09-10", ALL)), ["2026-09-10"]), "legacy day: all five cleared is perfect");
check(same(perfectDaysOf(day("2026-09-10", ALL.slice(0, 4))), []), "legacy day: four of five is not perfect");
check(same([...requiredFor("2026-09-10")], ALL), "legacy day requires the original five");

const req: Requirements = new Map([
  ["2026-10-08", new Set(["wordle", "aim", "geodash"])], // typing + litany switched off
  ["2026-10-09", new Set<string>()], // every game off
]);
check(
  same(perfectDaysOf(day("2026-10-08", ["wordle", "aim", "geodash"]), req), ["2026-10-08"]),
  "with two games off, clearing the three live ones is perfect",
);
check(
  same(perfectDaysOf(day("2026-10-08", ["wordle", "aim"]), req), []),
  "…but missing one live game is not",
);
check(
  same(perfectDaysOf(day("2026-10-08", ["wordle", "aim", "typing", "litany"]), req), []),
  "clearing switched-off games does not stand in for a live one",
);
check(
  same(perfectDaysOf(day("2026-10-09", ["wordle"]), req), []),
  "a day with no live games can never be perfect",
);
check(
  same(
    perfectDaysOf(
      [...day("2026-09-10", ALL), ...day("2026-10-08", ["wordle", "aim", "geodash"]), ...day("2026-10-07", ["wordle"])],
      req,
    ),
    ["2026-09-10", "2026-10-08"],
  ),
  "mixed history: each day is judged by its own requirement",
);
check(
  same(perfectDaysOf(day("2026-09-10", ALL), req), ["2026-09-10"]),
  "switching games off later never un-perfects an old day",
);
check(
  same(perfectDaysOf(day("2026-09-11", ["wordle", "aim", "geodash"]), req), []),
  "…and never retro-perfects an old day that missed a game",
);

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
