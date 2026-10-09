/**
 * The achievement list, read from (and written to) the `AchievementDef` table.
 *
 * Edited from /admin/achievements, so adding an achievement or changing a
 * reward needs no deploy. The first read of an empty table seeds it with
 * `DEFAULT_ACHIEVEMENTS`. Rows are re-validated on the way out — a row the
 * engine can't understand is skipped (and logged), never trusted.
 *
 * Cached ~15s per server instance; writes bust the cache.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  ACHIEVEMENT_ICON_NAMES,
  DEFAULT_ACHIEVEMENTS,
  duelAchievements,
  parseReward,
  parseTrigger,
  type AchievementDef,
} from "./catalog";

const CACHE_MS = 15_000;
let cache: { at: number; defs: AchievementDef[] } | null = null;

export function bustAchievementCache(): void {
  cache = null;
}

async function seedDefaults(): Promise<void> {
  const devoutRole = (process.env.ACHIEVEMENT_DEVOUT_ROLE_ID ?? "").trim();
  await prisma.achievementDef.createMany({
    data: DEFAULT_ACHIEVEMENTS.map((d) => ({
      key: d.key,
      name: d.name,
      description: d.description,
      icon: d.icon,
      trigger: d.trigger as Prisma.InputJsonValue,
      reward: (d.key === "perfect-day" && d.reward.kind === "role"
        ? { ...d.reward, roleId: /^\d{15,22}$/.test(devoutRole) ? devoutRole : "" }
        : d.reward) as Prisma.InputJsonValue,
      enabled: d.enabled,
      sortOrder: d.sortOrder,
    })),
    skipDuplicates: true,
  });
}

/**
 * Achievements added to the game after the table was first seeded. Each batch
 * is written once and remembered in `SiteSetting`, so one an admin later
 * deletes stays deleted.
 */
const LATER: { marker: string; defs: () => AchievementDef[] }[] = [
  { marker: "achievements.added.duel", defs: duelAchievements },
];
let toppedUp = false;

async function topUp(): Promise<boolean> {
  if (toppedUp) return false;
  const done = new Set(
    (
      await prisma.siteSetting.findMany({
        where: { key: { in: LATER.map((l) => l.marker) } },
        select: { key: true },
      })
    ).map((r) => r.key),
  );
  let added = false;
  for (const batch of LATER) {
    if (done.has(batch.marker)) continue;
    await prisma.achievementDef.createMany({
      data: batch.defs().map((d) => ({
        key: d.key,
        name: d.name,
        description: d.description,
        icon: d.icon,
        trigger: d.trigger as Prisma.InputJsonValue,
        reward: d.reward as Prisma.InputJsonValue,
        enabled: d.enabled,
        sortOrder: d.sortOrder,
      })),
      skipDuplicates: true,
    });
    await prisma.siteSetting.upsert({
      where: { key: batch.marker },
      create: { key: batch.marker, value: true },
      update: {},
    });
    added = true;
  }
  toppedUp = true;
  return added;
}

type DefRow = {
  key?: unknown;
  name?: unknown;
  description?: unknown;
  icon?: unknown;
  trigger?: unknown;
  reward?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
};

/** Validate `AchievementDef` rows. A row the engine can't understand is
 *  skipped (and logged), never trusted. */
export function achievementDefsFromRows(rows: DefRow[]): AchievementDef[] {
  const defs: AchievementDef[] = [];
  for (const r of rows) {
    const trigger = parseTrigger(r.trigger);
    const reward = parseReward(r.reward);
    if (typeof r.key !== "string" || !trigger || !reward) {
      logger.error("achievements.bad_definition", { key: String(r.key) });
      continue;
    }
    const icon = typeof r.icon === "string" ? r.icon : "";
    defs.push({
      key: r.key,
      name: String(r.name ?? ""),
      description: String(r.description ?? ""),
      icon: ACHIEVEMENT_ICON_NAMES.includes(icon) ? icon : "sparkles",
      trigger,
      reward,
      enabled: r.enabled !== false,
      sortOrder: Number(r.sortOrder) || 0,
    });
  }
  return defs;
}

/** Every achievement, enabled or not, in display order. */
export async function getAllAchievementDefs(): Promise<AchievementDef[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.defs;

  try {
    let rows = await prisma.achievementDef.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (rows.length === 0) {
      await seedDefaults();
      rows = await prisma.achievementDef.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
    }
    if (await topUp()) {
      rows = await prisma.achievementDef.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
    }

    const defs = achievementDefsFromRows(rows);
    cache = { at: Date.now(), defs };
    return defs;
  } catch (err) {
    logger.error("achievements.load_failed", { message: String(err) });
    // Serve the last good list, else the built-ins, rather than nothing.
    return cache?.defs ?? DEFAULT_ACHIEVEMENTS;
  }
}

/** Achievements that can currently be unlocked. */
export async function getEnabledAchievementDefs(): Promise<AchievementDef[]> {
  return (await getAllAchievementDefs()).filter((d) => d.enabled);
}

export async function getAchievementDef(key: string): Promise<AchievementDef | undefined> {
  return (await getAllAchievementDefs()).find((d) => d.key === key);
}

export async function saveAchievementDef(def: AchievementDef): Promise<void> {
  const data = {
    name: def.name,
    description: def.description,
    icon: def.icon,
    trigger: def.trigger as Prisma.InputJsonValue,
    reward: def.reward as Prisma.InputJsonValue,
    enabled: def.enabled,
    sortOrder: def.sortOrder,
  };
  await prisma.achievementDef.upsert({
    where: { key: def.key },
    create: { key: def.key, ...data },
    update: data,
  });
  bustAchievementCache();
}

/** Delete an achievement nobody has unlocked. Returns false (and deletes
 *  nothing) if anyone holds it — disable it instead, so their unlock, and any
 *  permanent boost it carries, stays intact. */
export async function deleteAchievementDef(key: string): Promise<boolean> {
  const holders = await prisma.achievement.count({ where: { key } });
  if (holders > 0) return false;
  await prisma.achievementDef.deleteMany({ where: { key } });
  bustAchievementCache();
  return true;
}
