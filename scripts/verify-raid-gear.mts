/**
 * Offline check that the shop's raid gear does what its card says: which
 * pieces work against which boss, what the multipliers come to, when a draught
 * and its rest are in force, and that a Rot Lure really makes rare growths
 * three times as likely (measured over the schedule, not read off the formula).
 *
 *   node --experimental-strip-types --import ./scripts/ts-esm-hook.mjs scripts/verify-raid-gear.mts
 */
import {
  BATCH_GRACE_MS,
  BERSERK_REST_MS,
  LURE_SACS,
  NO_KIT,
  PASSIVE_IDS,
  USABLE_IDS,
  gearApplies,
  hourHolds,
  kitMult,
  lured,
  resting,
  type Kit,
} from "../src/lib/boss/kit-rules";
import { SAC_KINDS, offeredByKind, sacKind, weakpointConfig } from "../src/lib/boss/mechanics/weakpoint";
import { breathFrom } from "../src/lib/boss/mechanics/combo";
import { GEAR } from "../src/lib/shop/gear";
import { planWards } from "../src/lib/shop/ward-rule";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

// --- every shop item is either carried or used, and all are on sale ---
const known = new Set<string>([...PASSIVE_IDS, ...USABLE_IDS, "raiders-kit", "second-chance", "wordle-insight", "streak-ward"]);
check("every shop item has an effect", GEAR.every((g) => known.has(g.id)), GEAR.filter((g) => !known.has(g.id)).map((g) => g.id).join(","));
check("every shop item is on sale", GEAR.every((g) => g.live));
check("23 items", GEAR.length === 23, String(GEAR.length));

// --- which gear works against which boss ---
const BOSSES = [
  { name: "Veyrath", mechanic: "clicker", combo: "momentum" },
  { name: "Grieveth", mechanic: "clicker", combo: "breath" },
  { name: "Nyrrek", mechanic: "eclipse", combo: "corona" },
  { name: "Silt Cardinal", mechanic: "weakpoint", combo: "streak" },
  { name: "Unraveled Saint", mechanic: "miniarena", combo: "threads" },
] as const;
for (const g of GEAR.filter((x) => x.boss)) {
  const works = BOSSES.filter((b) => gearApplies(g.id, b.mechanic, b.combo)).map((b) => b.name);
  check(`${g.id} works only against ${g.boss}`, works.length === 1 && works[0] === g.boss, works.join(","));
}
check("swift gauntlets: the three click-race bosses", BOSSES.filter((b) => gearApplies("swift-gauntlets", b.mechanic, b.combo)).length === 3);
check("steady hand: not Veyrath or Grieveth", BOSSES.filter((b) => gearApplies("steady-hand", b.mechanic, b.combo)).map((b) => b.name).join() === "Nyrrek,Silt Cardinal,Unraveled Saint");
check("stopped hour: not Grieveth", !gearApplies("stopped-hour", "clicker", "breath") && gearApplies("stopped-hour", "clicker", "momentum"));
check("whetstone, mark, charm, horn, flask: every boss", ["whetstone", "executioners-mark", "warding-charm", "war-horn", "flask-of-fury", "firebomb", "second-breath"].every((id) => BOSSES.every((b) => gearApplies(id, b.mechanic, b.combo))));

// --- multipliers ---
const T = 1_000_000_000_000;
const kit = (over: Partial<Kit>): Kit => ({ ...NO_KIT, ...over });
const at = (k: Kit, hpShare = 1, hornUntil = 0, now = T) => kitMult(k, { hpShare, hornUntil, now });
check("no gear: x1", at(NO_KIT) === 1);
check("whetstone: x1.25", near(at(kit({ on: ["whetstone"] })), 1.25));
check("mark above a quarter: x1", at(kit({ on: ["executioners-mark"] }), 0.25) === 1);
check("mark under a quarter: x1.5", near(at(kit({ on: ["executioners-mark"] }), 0.249), 1.5));
check("horn: x1.1 for a fighter with nothing", near(at(NO_KIT, 1, T + 1), 1.1));
check("horn run out: x1", at(NO_KIT, 1, T - 1) === 1);
check("flask running: x2", near(at(kit({ draughtMult: 2, draughtUntil: T + 1000 })), 2));
check("flask just run out, batch in flight: still x2", near(at(kit({ draughtMult: 2, draughtUntil: T - BATCH_GRACE_MS + 1 })), 2));
check("flask long run out: x1", at(kit({ draughtMult: 2, draughtUntil: T - BATCH_GRACE_MS - 1 })) === 1);
check("whetstone + mark + horn + berserker: x1.25 x1.5 x1.1 x3", near(at(kit({ on: ["whetstone", "executioners-mark"], draughtMult: 3, draughtUntil: T + 1 }), 0.1, T + 1), 1.25 * 1.5 * 1.1 * 3));

// --- the rest after a Berserker's Draught ---
const restUntil = T + BERSERK_REST_MS; // the draught ended at T
check("not resting while the last batch is in flight", !resting(kit({ restUntil }), T + BATCH_GRACE_MS - 1));
check("resting after it", resting(kit({ restUntil }), T + BATCH_GRACE_MS + 1));
check("resting to the end", resting(kit({ restUntil }), restUntil - 1));
check("rest over", !resting(kit({ restUntil }), restUntil + 1));
check("no draught: never resting", !resting(NO_KIT, T));

// --- the Stopped Hour ---
check("hour holds while running", hourHolds(kit({ hourUntil: T + 1 }), T));
check("hour over", !hourHolds(kit({ hourUntil: T - BATCH_GRACE_MS - 1 }), T));

// --- Deep Lungs ---
check("a full breath takes 4s without", breathFrom(3000)!.mult < 3 && breathFrom(4000)!.mult === 3);
check("a full breath takes 3s with Deep Lungs", breathFrom(3000, 3000)!.mult === 3 && breathFrom(3000, 3000)!.blows === 20);

// --- the Rot Lure ---
const SPAWN = 5_000_000;
const INTERVAL = 700;
const thrown = SPAWN + 10 * INTERVAL + 50; // during growth #10
const covered = Array.from({ length: 40 }, (_, i) => i).filter((i) => lured([thrown], SPAWN, INTERVAL, i));
check(`a lure covers the next ${LURE_SACS} growths`, covered.length === LURE_SACS && covered[0] === 11 && covered[9] === 20, covered.join(","));
check("no lure: nothing covered", !lured([], SPAWN, INTERVAL, 11));

const N = 200_000;
let rare = 0;
let rareLured = 0;
let worth = 0;
let worthLured = 0;
for (let i = 0; i < N; i++) {
  const a = sacKind("seed-a", i);
  const b = sacKind("seed-a", i, true);
  if (a > 0) rare += 1;
  if (b > 0) rareLured += 1;
  worth += SAC_KINDS[a].mult;
  worthLured += SAC_KINDS[b].mult;
}
check("plain: about 30% rare", near(rare / N, 0.3, 0.01), (rare / N).toFixed(3));
check("lured: about 90% rare (three times as likely)", near(rareLured / N, 0.9, 0.01), (rareLured / N).toFixed(3));
console.log(`     a lured growth is worth x${(worthLured / worth).toFixed(2)} a plain one on average`);

// the server offers a lured fighter the growths their arena shows them
const cfg = weakpointConfig({});
const lure = (i: number) => lured([thrown], SPAWN, cfg.sacIntervalMs, i);
const from = 11 * cfg.sacIntervalMs;
const to = 21 * cfg.sacIntervalMs - 1;
const offered = offeredByKind(cfg, "seed-b", from, to, lure);
const shown = SAC_KINDS.map(() => 0);
for (let i = Math.max(0, Math.floor((from - cfg.sacTtlMs) / cfg.sacIntervalMs) + 1); i <= Math.floor(to / cfg.sacIntervalMs); i++) {
  shown[sacKind("seed-b", i, lure(i))] += 1;
}
check("server and arena agree on a lured fighter's growths", offered.join() === shown.join(), `${offered.join()} vs ${shown.join()}`);

// --- the Streak Ward ---
{
  const endOf = (day: string) => new Date(Date.parse(`${day}T23:59:59.999Z`));
  const bought = (day: string, id = "w1") => ({ id, boughtAt: new Date(`${day}T12:00:00.000Z`) });
  const days = (p: { day: string }[]) => p.map((x) => x.day).join();
  const TODAY = "2026-10-09";
  check("ward: yesterday missed, the day before kept: spent on yesterday", days(planWards(TODAY, new Set(["2026-10-07"]), [bought("2026-10-06")], endOf)) === "2026-10-08");
  check("ward: nothing missed: not spent", planWards(TODAY, new Set(["2026-10-08"]), [bought("2026-10-06")], endOf).length === 0);
  check("ward: bought after the missed day: not spent", planWards(TODAY, new Set(["2026-10-07"]), [bought("2026-10-09")], endOf).length === 0);
  check("ward: bought on the missed day itself: spent", days(planWards(TODAY, new Set(["2026-10-07"]), [bought("2026-10-08")], endOf)) === "2026-10-08");
  check("ward: two days missed, one ward: not spent", planWards(TODAY, new Set(["2026-10-06"]), [bought("2026-10-01")], endOf).length === 0);
  check("ward: two days missed, two wards: both spent", days(planWards(TODAY, new Set(["2026-10-06"]), [bought("2026-10-01"), bought("2026-10-02", "w2")], endOf)) === "2026-10-07,2026-10-08");
  check("ward: three days missed: the streak is gone", planWards(TODAY, new Set(["2026-10-05"]), [bought("2026-10-01"), bought("2026-10-01", "w2")], endOf).length === 0);
  check("ward: no streak to keep: not spent", planWards(TODAY, new Set(), [bought("2026-10-01")], endOf).length === 0);
  check("ward: a day already warded counts as kept", days(planWards(TODAY, new Set(["2026-10-07"]), [bought("2026-10-01")], endOf)) === "2026-10-08");
}

console.log(failed === 0 ? "\nAll raid gear checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
