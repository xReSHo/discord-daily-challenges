/**
 * Offline check that equipment does what its card says: each stat changes the
 * number it should by the percent it shows, the legendaries' extras fire when
 * they should and only then, and Luck really moves the drop odds (measured over
 * two million rolls, not just read off the formula).
 *
 *   node --experimental-strip-types --import ./scripts/ts-esm-hook.mjs scripts/verify-equipment.mts
 */
import { randomInt } from "node:crypto";
import {
  BONUS,
  BOSS_ODDS,
  EQUIPMENT,
  FANG_MS,
  NO_GEAR,
  TRIAL_ODDS,
  comboGrace,
  fortuneFor,
  gearLines,
  gearOf,
  rarityFor,
  rerollsRepeats,
  skipsFirstStall,
  withFocus,
  withHaste,
  withPower,
  withWard,
  type Odds,
  type Rarity,
  type SlotId,
} from "../src/lib/equipment";

let failed = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const piece = (slot: SlotId, rarity: Rarity) => EQUIPMENT.find((p) => p.slot === slot && p.rarity === rarity)!.id;

// --- what is worn ---
check(JSON.stringify(gearOf([])) === JSON.stringify(NO_GEAR), "no equipment adds nothing");
const mixed = gearOf([piece("sword", "common"), piece("sword", "rare"), piece("helm", "epic")]);
check(mixed.power === BONUS.sword.rare && mixed.focus === BONUS.helm.epic, "the best piece of each slot counts, not the sum");
check(mixed.ward === 0 && mixed.perks.length === 0, "empty slots add nothing, and no legendary means no extras");
const full = gearOf(EQUIPMENT.map((p) => p.id));
check(
  full.power === 12 && full.focus === 18 && full.ward === 25 && full.haste === 18 && full.fortune === 12 && full.luck === 18,
  "a full legendary set gives the numbers on the cards (12 / 18 / 25 / 18 / 12 / 18)",
);
check(full.perks.length === 6, "a full legendary set has all six extras");

// --- sword: raid damage ---
const rareSword = gearOf([piece("sword", "rare")]);
check(near(withPower(1000, rareSword, 60_000), 1060), "rare sword: 1,000 damage becomes 1,060 (+6%)");
check(near(withPower(1000, NO_GEAR, 0), 1000), "no sword: damage is unchanged");
const fang = gearOf([piece("sword", "legendary")]);
check(near(withPower(1000, fang, 0), 1000 * 1.12 * 1.1), "legendary sword, first seconds: +12% and a tenth more (1,232)");
check(near(withPower(1000, fang, FANG_MS), 1120), "legendary sword after 15 seconds: +12% only (1,120)");

// --- helm: combo bonus ---
const rareHelm = gearOf([piece("helm", "rare")]);
check(near(withFocus(1.5, rareHelm), 1.545), "rare helm: a ×1.5 combo becomes ×1.545 (its bonus +9%)");
check(withFocus(1, rareHelm) === 1, "helm: no combo, no change");
check(near(withFocus(3, gearOf([piece("helm", "legendary")])), 1 + 2 * 1.18), "legendary helm: a ×3 heavy blow becomes ×3.36");
check(comboGrace(gearOf([piece("helm", "legendary")])) === 2000 && comboGrace(rareHelm) === 0, "only the legendary helm holds a combo 2 seconds longer");

// --- chestplate: raid penalty ---
const epicChest = gearOf([piece("chest", "epic")]);
check(withWard(10_000, epicChest, 0.5) === 8200, "epic chestplate: a 10,000 penalty becomes 8,200 (−18%)");
check(withWard(10_000, NO_GEAR, 0.05) === 10_000, "no chestplate: the full penalty, however close the boss was");
const ribcage = gearOf([piece("chest", "legendary")]);
check(withWard(10_000, ribcage, 0.5) === 7500, "legendary chestplate, boss at half health: 7,500 (−25%)");
check(withWard(10_000, ribcage, 0.09) === 0, "legendary chestplate, boss under a tenth of its health: no penalty");
check(withWard(10_000, ribcage, 0.1) === 7500, "legendary chestplate, boss at exactly a tenth: the penalty stands");

// --- gauntlets: stalls ---
const rareGauntlets = gearOf([piece("gauntlets", "rare")]);
check(withHaste(2000, rareGauntlets) === 1820, "rare gauntlets: a 2-second stall lasts 1.82 seconds (−9%)");
check(withHaste(15_000, gearOf([piece("gauntlets", "legendary")])) === 12_300, "legendary gauntlets: a 15-second wait lasts 12.3 seconds");
check(skipsFirstStall(gearOf([piece("gauntlets", "legendary")])) && !skipsFirstStall(rareGauntlets), "only the legendary gauntlets skip the first stall");

// --- boots: coins from trials ---
const epicBoots = gearOf([piece("boots", "epic")]);
check(Math.floor(3000 * (1 + fortuneFor(epicBoots, true) / 100)) === 3270, "epic boots: a 3,000 trial pays 3,270 (+9%)");
const steps = gearOf([piece("boots", "legendary")]);
check(fortuneFor(steps, true) === 24 && fortuneFor(steps, false) === 12, "legendary boots: +24% on the day's first trial, +12% after");
check(fortuneFor(NO_GEAR, true) === 0, "no boots: nothing added");

// --- amulet: luck, measured ---
function measure(odds: Odds, luck: number, n: number): Record<string, number> {
  const hits: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const r = rarityFor(odds, randomInt(10_000) / 100, luck) ?? "nothing";
    hits[r] = (hits[r] ?? 0) + 1;
  }
  for (const k of Object.keys(hits)) hits[k] = (hits[k] / n) * 100;
  return hits;
}
const N = 2_000_000;
const plain = measure(TRIAL_ODDS, 0, N);
const lucky = measure(TRIAL_ODDS, gearOf([piece("amulet", "legendary")]).luck, N);
const any = (h: Record<string, number>) => 100 - (h.nothing ?? 0);
console.log(
  `      trial roll, measured over ${N.toLocaleString("en-US")} rolls each:\n` +
    `        no amulet        find something ${any(plain).toFixed(2)}%  rare ${plain.rare.toFixed(2)}%  epic ${plain.epic.toFixed(2)}%\n` +
    `        legendary amulet find something ${any(lucky).toFixed(2)}%  rare ${lucky.rare.toFixed(2)}%  epic ${lucky.epic.toFixed(2)}%`,
);
check(near(any(plain), 35.75, 0.15), "no amulet: a trial finds something 35.75% of the time");
check(near(any(lucky), 35.75 * 1.18, 0.15), "legendary amulet (+18% Luck): 42.19% of the time");
check(near(lucky.epic, 0.75 * 1.18, 0.05) && near(lucky.rare, 3 * 1.18, 0.08), "Luck raises every rarity by the same share");
const bossLucky = measure(BOSS_ODDS, 18, 500_000);
check(near(100 - (bossLucky.nothing ?? 0), 65 * 1.18, 0.3), "Luck works on a boss roll too (65% becomes 76.7%)");
check(rerollsRepeats(gearOf([piece("amulet", "legendary")])) && !rerollsRepeats(gearOf([piece("amulet", "epic")])), "only the legendary amulet redraws a repeat");

// --- what the player is told ---
const told = gearLines(gearOf([piece("sword", "rare"), piece("amulet", "common")]));
check(told.includes("+6% raid damage") && told.includes("+3% drop chances") && told.length === 2, "the Spoils panel lists exactly what is worn");

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall good");
