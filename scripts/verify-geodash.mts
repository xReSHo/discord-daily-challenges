/**
 * Offline check that every seeded geodash course is clearable by its own
 * jump-point solution, plus a read on obstacle counts, cadence and timing slack.
 *
 *   node --experimental-strip-types --import ./scripts/ts-esm-hook.mjs scripts/verify-geodash.mts
 */
import { deriveCourseWithSolution, DIFFICULTIES } from "../src/lib/geodash/daily";
import { simulate, expectedRunMs } from "../src/lib/geodash/physics";

const dates: string[] = [];
for (let d = 0; d < 60; d++) {
  dates.push(new Date(Date.UTC(2026, 0, 1) + d * 86400000).toISOString().slice(0, 10));
}

let fails = 0;
for (const diff of DIFFICULTIES) {
  let minGap = Infinity;
  let maxJumps = 0;
  let minObs = Infinity;
  let maxObs = 0;
  let slack = Infinity;

  const kinds: Record<string, number> = {};
  for (const date of dates) {
    const { course, solution } = deriveCourseWithSolution(date, diff);
    for (const o of course.obstacles) kinds[o.t] = (kinds[o.t] ?? 0) + 1;
    const res = simulate(course, solution);
    if (!res.reachedEnd) {
      console.log(`FAIL ${diff} ${date}: died @ ${res.distancePct.toFixed(1)}% (obs=${course.obstacles.length})`);
      fails++;
      continue;
    }

    const gaps: number[] = [];
    for (let i = 1; i < solution.length; i++) gaps.push(solution[i] - solution[i - 1]);
    if (gaps.length) minGap = Math.min(minGap, Math.min(...gaps));
    maxJumps = Math.max(maxJumps, solution.length);
    minObs = Math.min(minObs, course.obstacles.length);
    maxObs = Math.max(maxObs, course.obstacles.length);

    for (const dt of [40, 24, 16, 8]) {
      const late = simulate(course, solution.map((t) => t + dt)).reachedEnd;
      const early = simulate(course, solution.map((t) => t - dt)).reachedEnd;
      if (late && early) slack = Math.min(slack, dt);
    }
  }

  // per-jump gaussian timing error (a rough human model): pass rate over a run
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const sdPass: Record<number, number> = {};
  for (const sd of [15, 25, 35, 50]) {
    let ok = 0;
    const trials = 400;
    for (let n = 0; n < trials; n++) {
      const { course: c, solution } = deriveCourseWithSolution(dates[n % dates.length], diff);
      const noisy = solution.map((t) => t + gauss() * sd);
      if (simulate(c, noisy).reachedEnd) ok++;
    }
    sdPass[sd] = Math.round((ok / trials) * 100);
  }

  const { course } = deriveCourseWithSolution(dates[0], diff);
  const mix = Object.entries(kinds)
    .map(([k, n]) => `${k}:${(n / dates.length).toFixed(1)}`)
    .join(" ");
  console.log(
    `${diff.padEnd(11)} obs ${minObs}-${maxObs} [${mix}]  jumps<=${maxJumps}  ` +
      `minGap ${Number.isFinite(minGap) ? minGap.toFixed(0) : "n/a"}ms  ` +
      `runtime ${(expectedRunMs(course) / 1000).toFixed(1)}s  ` +
      `clear% @ SD 15/25/35/50ms = ${sdPass[15]}/${sdPass[25]}/${sdPass[35]}/${sdPass[50]}`,
  );
}

console.log(fails ? `\n${fails} FAILURES` : "\nall courses clearable by their solution");

// A losing trace must never read as a clear.
const { course } = deriveCourseWithSolution(dates[0], "medium");
const noJumps = simulate(course, []);
console.log(`no-jump run on medium: reachedEnd=${noJumps.reachedEnd} dist=${noJumps.distancePct.toFixed(1)}%`);
if (noJumps.reachedEnd) fails++;

process.exit(fails ? 1 : 0);
