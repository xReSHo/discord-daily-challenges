"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";
import { BOSS_DEFAULTS, bustBossConfigCache } from "@/lib/boss/config";
import { resolveBoss, despawnBoss as despawnBossById } from "@/lib/boss/game";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!isAdmin(session?.user?.discordId)) throw new Error("Not authorized");
}

function clampInt(fd: FormData, key: string, fallback: number, lo: number, hi: number): number {
  const n = Math.floor(Number(fd.get(key)));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

function num(fd: FormData, key: string, fallback: number, lo: number): number {
  const n = Number(fd.get(key));
  return Number.isFinite(n) && n >= lo ? n : fallback;
}

function refresh(): void {
  revalidatePath("/admin/boss");
  revalidatePath("/", "layout");
}

/** Upsert the BossConfig singleton (the recurring raid + defaults). */
export async function saveBossConfig(fd: FormData): Promise<void> {
  await requireAdmin();
  const data = {
    name: String(fd.get("name") ?? "").trim() || BOSS_DEFAULTS.name,
    maxHp: clampInt(fd, "maxHp", BOSS_DEFAULTS.maxHp, 1, 100_000_000),
    rewardPool: clampInt(fd, "rewardPool", BOSS_DEFAULTS.rewardPool, 0, 1_000_000_000),
    penalty: clampInt(fd, "penalty", BOSS_DEFAULTS.penalty, 0, 1_000_000_000),
    dmgPerClick: num(fd, "dmgPerClick", BOSS_DEFAULTS.dmgPerClick, 0.0001),
    maxCps: clampInt(fd, "maxCps", BOSS_DEFAULTS.maxCps, 1, 100),
    spawnDow: clampInt(fd, "spawnDow", BOSS_DEFAULTS.spawnDow, 0, 6),
    spawnHour: clampInt(fd, "spawnHour", BOSS_DEFAULTS.spawnHour, 0, 23),
    despawnHour: clampInt(fd, "despawnHour", BOSS_DEFAULTS.despawnHour, 0, 23),
    despawnMin: clampInt(fd, "despawnMin", BOSS_DEFAULTS.despawnMin, 0, 59),
    weeklyEnabled: fd.get("weeklyEnabled") === "on",
  };
  await prisma.bossConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });
  bustBossConfigCache();
  refresh();
}

/** Spawn a one-off boss now (or between explicit start/end times). */
export async function spawnBoss(fd: FormData): Promise<void> {
  await requireAdmin();

  const now = new Date();
  // datetime-local sends "YYYY-MM-DDTHH:MM" with no zone — read it as UTC.
  const asUtc = (s: string): Date => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  const startRaw = String(fd.get("startsAt") ?? "").trim();
  const endRaw = String(fd.get("endsAt") ?? "").trim();

  const spawnsAt = startRaw ? asUtc(startRaw) : now;
  if (Number.isNaN(spawnsAt.getTime())) throw new Error("Bad start time");

  let expiresAt: Date;
  if (endRaw) {
    expiresAt = asUtc(endRaw);
    if (Number.isNaN(expiresAt.getTime())) throw new Error("Bad end time");
  } else {
    const hours = num(fd, "autoEndHours", 6, 0.05);
    expiresAt = new Date(spawnsAt.getTime() + hours * 3_600_000);
  }
  if (expiresAt <= spawnsAt) throw new Error("End must be after start");

  await prisma.boss.create({
    data: {
      dedupeKey: `manual:${randomUUID()}`,
      source: "manual",
      weekOf: getChallengeDate(spawnsAt),
      name: String(fd.get("name") ?? "").trim() || BOSS_DEFAULTS.name,
      maxHp: clampInt(fd, "maxHp", BOSS_DEFAULTS.maxHp, 1, 100_000_000),
      rewardPool: clampInt(fd, "rewardPool", BOSS_DEFAULTS.rewardPool, 0, 1_000_000_000),
      penalty: clampInt(fd, "penalty", BOSS_DEFAULTS.penalty, 0, 1_000_000_000),
      adminOnly: fd.get("adminOnly") === "on",
      paysOut: fd.get("paysOut") === "on",
      spawnsAt,
      expiresAt,
    },
  });
  refresh();
}

/** Force a boss's window closed now (it then flows to resolution normally). */
export async function endBossNow(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  await prisma.boss.updateMany({
    where: { id, resolved: false },
    data: { expiresAt: new Date() },
  });
  refresh();
}

/** End (if needed) and settle a boss now. */
export async function resolveBossNow(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  await prisma.boss.updateMany({
    where: { id, resolved: false, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });
  await resolveBoss(id);
  refresh();
}

/** Despawn a boss immediately — no resolution, no payout. A manual test boss is
 *  deleted; the weekly boss is force-resolved so it stops showing. */
export async function despawnBoss(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  await despawnBossById(id);
  refresh();
}
