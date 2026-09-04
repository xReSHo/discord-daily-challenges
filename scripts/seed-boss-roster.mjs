/**
 * Seed / update the boss roster (`BossTemplate` table).
 *
 *   node scripts/seed-boss-roster.mjs
 *
 * Idempotent. First run seeds all five. On re-run it refreshes only the
 * "structural" fields (name, mechanic, image, blurb, sortOrder) and leaves the
 * tuning an admin owns (maxHp, rewardPool, penalty, params, enabled) untouched.
 * Veyrath's stats are taken from the existing `BossConfig` singleton (if
 * present) so the migration preserves the currently-live tuning; the schedule
 * stays in `BossConfig`.
 *
 * Every template carries clicker fallback params (`dmgPerClick`, `maxCps`) in
 * addition to its mechanic-specific knobs. Bosses whose mechanic handler isn't
 * built yet are seeded `enabled: false` so the weekly draw only lands a boss
 * that plays correctly; flip them on from /admin/boss as each phase ships.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const cfg = await prisma.bossConfig.findUnique({ where: { id: "singleton" } });
const vDmg = cfg?.dmgPerClick ?? 0.1;
const vCps = cfg?.maxCps ?? 10;

const TEMPLATES = [
  {
    key: "veyrath",
    name: cfg?.name || "Veyrath, The Hollow Sovereign",
    mechanic: "clicker",
    enabled: true,
    maxHp: cfg?.maxHp ?? 5000,
    rewardPool: cfg?.rewardPool ?? 10000,
    penalty: cfg?.penalty ?? 2000,
    image: "/boss/veyrath-idle",
    blurb: "Strike him by clicking — fast, relentless, no tricks.",
    params: { dmgPerClick: vDmg, maxCps: vCps },
    sortOrder: 0,
  },
  {
    key: "grieveth",
    name: "Grieveth, the Drowned Vow",
    mechanic: "clicker",
    enabled: true,
    maxHp: 18000,
    rewardPool: 22000,
    penalty: 3500,
    image: "/boss/grieveth-idle",
    blurb:
      "A war of attrition. He shrugs off bursts — only sustained pressure from the whole raid drowns him.",
    params: { dmgPerClick: 0.1, maxCps: 6 },
    sortOrder: 1,
  },
  {
    key: "nyrrek",
    name: "Nyrrek, the Second Dusk",
    mechanic: "eclipse",
    enabled: true,
    maxHp: 9000,
    rewardPool: 14000,
    penalty: 2500,
    image: "/boss/nyrrek-idle",
    blurb:
      "Watch the eclipse. A clean strike in the dusk, barely a scratch in the light — pour everything in when the black sun opens.",
    params: {
      dmgPerClick: 0.1,
      maxCps: 10,
      darkMult: 2.5,
      neutralMult: 1,
      lightMult: 0.15,
      // [min, max] ms — durations and the dark/light choice are seeded-random
      neutralMs: [16_000, 30_000],
      darkMs: [20_000, 38_000],
      lightMs: [20_000, 38_000],
    },
    sortOrder: 2,
  },
  {
    key: "silt-cardinal",
    name: "The Silt Cardinal",
    mechanic: "weakpoint",
    enabled: true,
    maxHp: 7000,
    rewardPool: 13000,
    penalty: 2200,
    image: "/boss/silt-cardinal-idle",
    blurb:
      "Lance the silt-sacs as they surface. Miss too many and the rot seizes your arm.",
    params: {
      slots: 6,
      sacTtlMs: 1200,
      sacIntervalMs: 700,
      dmgPerSac: 2,
      stallAt: 5,
      stallMs: 2000,
      maxSacsPerSec: 3,
    },
    sortOrder: 3,
  },
  {
    key: "unraveled-saint",
    name: "The Unraveled Saint",
    mechanic: "miniarena",
    enabled: true,
    maxHp: 5500,
    rewardPool: 15000,
    penalty: 2000,
    image: "/boss/unraveled-saint-idle",
    blurb:
      "Undo him through the reliquary trials — transcription, aim, and the litany. Harder trials tear deeper.",
    params: {
      cooldownMs: 15_000,
      typing: { dmgBase: 90, dmgCeil: 150, targetWpm: 55, words: 10 },
      aim: {
        dmgBase: 70,
        dmgCeil: 120,
        targetMs: 650,
        targets: 6,
        radius: 0.065,
        timeLimitMs: 7000,
      },
      litany: { dmgPerRound: 45, dmgCeil: 380, seqLen: 7, glyphs: 5 },
    },
    sortOrder: 4,
  },
];

for (const t of TEMPLATES) {
  const { key, name, mechanic, image, blurb, sortOrder, ...tuning } = t;
  await prisma.bossTemplate.upsert({
    where: { key },
    create: { key, name, mechanic, image, blurb, sortOrder, ...tuning },
    // re-run: refresh structure only, keep admin-owned tuning
    update: { name, mechanic, image, blurb, sortOrder },
  });
  console.log(`upserted ${key.padEnd(16)} ${mechanic.padEnd(10)} hp ${t.maxHp}`);
}

await prisma.$disconnect();
console.log("done.");
