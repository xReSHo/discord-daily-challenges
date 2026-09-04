"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";
import { BOSS_DEFAULTS, bustBossConfigCache, getBossConfig } from "@/lib/boss/config";
import { bustRosterCache, getRoster, getTemplate } from "@/lib/boss/roster";
import { resolveBoss, despawnBoss as despawnBossById } from "@/lib/boss/game";
import type { Prisma } from "@prisma/client";

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

/**
 * Upsert the BossConfig singleton — now just the weekly schedule + global
 * switch. The legacy per-boss stat columns are non-null, so preserve whatever
 * is already stored (the roster owns those numbers).
 */
export async function saveBossConfig(fd: FormData): Promise<void> {
  await requireAdmin();
  const existing = await prisma.bossConfig.findUnique({ where: { id: "singleton" } });
  const legacy = {
    name: existing?.name ?? BOSS_DEFAULTS.name,
    maxHp: existing?.maxHp ?? BOSS_DEFAULTS.maxHp,
    rewardPool: existing?.rewardPool ?? BOSS_DEFAULTS.rewardPool,
    penalty: existing?.penalty ?? BOSS_DEFAULTS.penalty,
    dmgPerClick: existing?.dmgPerClick ?? BOSS_DEFAULTS.dmgPerClick,
    maxCps: existing?.maxCps ?? BOSS_DEFAULTS.maxCps,
  };
  const schedule = {
    spawnDow: clampInt(fd, "spawnDow", BOSS_DEFAULTS.spawnDow, 0, 6),
    spawnHour: clampInt(fd, "spawnHour", BOSS_DEFAULTS.spawnHour, 0, 23),
    despawnHour: clampInt(fd, "despawnHour", BOSS_DEFAULTS.despawnHour, 0, 23),
    despawnMin: clampInt(fd, "despawnMin", BOSS_DEFAULTS.despawnMin, 0, 59),
    weeklyEnabled: fd.get("weeklyEnabled") === "on",
  };
  await prisma.bossConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...legacy, ...schedule },
    update: schedule,
  });
  bustBossConfigCache();
  refresh();
}

/**
 * Edit one roster template. Mechanic params come in as labelled `p_<key>`
 * number fields (the shape depends on the boss's fixed mechanic); a blank field
 * keeps the current value.
 */
export async function saveBossTemplate(fd: FormData): Promise<void> {
  await requireAdmin();
  const key = String(fd.get("key") ?? "");
  const current = await getTemplate(key);
  if (!current) throw new Error("Unknown boss");

  const cur = (current.params ?? {}) as Record<string, unknown>;
  const sub = (k: string): Record<string, unknown> =>
    cur[k] && typeof cur[k] === "object" ? (cur[k] as Record<string, unknown>) : {};
  const arr = (k: string): number[] => (Array.isArray(cur[k]) ? (cur[k] as number[]) : []);

  /** Read a `p_<key>` field; blank / non-numeric → fallback. */
  const P = (name: string, fallback: unknown): number => {
    const raw = fd.get(`p_${name}`);
    if (raw === null || String(raw).trim() === "") {
      return typeof fallback === "number" ? fallback : 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : typeof fallback === "number" ? fallback : 0;
  };
  const Pi = (name: string, fallback: unknown): number => Math.round(P(name, fallback));

  let params: Record<string, unknown>;
  switch (current.mechanic) {
    case "eclipse":
      params = {
        dmgPerClick: P("dmgPerClick", cur.dmgPerClick ?? 0.1),
        maxCps: Pi("maxCps", cur.maxCps ?? 10),
        darkMult: P("darkMult", cur.darkMult ?? 2.5),
        neutralMult: P("neutralMult", cur.neutralMult ?? 1),
        lightMult: P("lightMult", cur.lightMult ?? 0.15),
        darkMs: [Pi("darkMs_min", arr("darkMs")[0] ?? 20000), Pi("darkMs_max", arr("darkMs")[1] ?? 38000)],
        neutralMs: [Pi("neutralMs_min", arr("neutralMs")[0] ?? 16000), Pi("neutralMs_max", arr("neutralMs")[1] ?? 30000)],
        lightMs: [Pi("lightMs_min", arr("lightMs")[0] ?? 20000), Pi("lightMs_max", arr("lightMs")[1] ?? 38000)],
      };
      break;
    case "weakpoint":
      params = {
        slots: Pi("slots", cur.slots ?? 6),
        sacIntervalMs: Pi("sacIntervalMs", cur.sacIntervalMs ?? 700),
        sacTtlMs: Pi("sacTtlMs", cur.sacTtlMs ?? 1200),
        dmgPerSac: P("dmgPerSac", cur.dmgPerSac ?? 2),
        stallAt: Pi("stallAt", cur.stallAt ?? 5),
        stallMs: Pi("stallMs", cur.stallMs ?? 2000),
        maxSacsPerSec: Pi("maxSacsPerSec", cur.maxSacsPerSec ?? 3),
      };
      break;
    case "miniarena": {
      const t = sub("typing");
      const a = sub("aim");
      const l = sub("litany");
      params = {
        cooldownMs: Pi("cooldownMs", cur.cooldownMs ?? 15000),
        typing: {
          dmgBase: P("typing_dmgBase", t.dmgBase ?? 90),
          dmgCeil: P("typing_dmgCeil", t.dmgCeil ?? 150),
          targetWpm: P("typing_targetWpm", t.targetWpm ?? 55),
          words: Pi("typing_words", t.words ?? 10),
        },
        aim: {
          dmgBase: P("aim_dmgBase", a.dmgBase ?? 70),
          dmgCeil: P("aim_dmgCeil", a.dmgCeil ?? 120),
          targetMs: P("aim_targetMs", a.targetMs ?? 650),
          targets: Pi("aim_targets", a.targets ?? 6),
          radius: P("aim_radius", a.radius ?? 0.065),
          timeLimitMs: Pi("aim_timeLimitMs", a.timeLimitMs ?? 7000),
        },
        litany: {
          dmgPerRound: P("litany_dmgPerRound", l.dmgPerRound ?? 45),
          dmgCeil: P("litany_dmgCeil", l.dmgCeil ?? 380),
          seqLen: Pi("litany_seqLen", l.seqLen ?? 7),
          glyphs: Pi("litany_glyphs", l.glyphs ?? 5),
        },
      };
      break;
    }
    default: // clicker
      params = {
        dmgPerClick: P("dmgPerClick", cur.dmgPerClick ?? 0.1),
        maxCps: Pi("maxCps", cur.maxCps ?? 10),
      };
  }

  await prisma.bossTemplate.update({
    where: { key },
    data: {
      name: String(fd.get("name") ?? "").trim() || current.name,
      blurb: String(fd.get("blurb") ?? "").trim(),
      enabled: fd.get("enabled") === "on",
      maxHp: clampInt(fd, "maxHp", current.maxHp, 1, 100_000_000),
      rewardPool: clampInt(fd, "rewardPool", current.rewardPool, 0, 1_000_000_000),
      penalty: clampInt(fd, "penalty", current.penalty, 0, 1_000_000_000),
      params: params as Prisma.InputJsonValue,
    },
  });
  bustRosterCache();
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

  // Optional roster template — supplies mechanic / params / art / defaults.
  const cfg = await getBossConfig();
  const pick = String(fd.get("templateKey") ?? "").trim();
  let tpl = pick && pick !== "random" ? await getTemplate(pick) : null;
  if (pick === "random") {
    const enabled = (await getRoster()).filter((t) => t.enabled);
    tpl = enabled.length
      ? enabled[Math.floor(Math.random() * enabled.length)]
      : null;
  }

  const base = tpl ?? {
    key: null as string | null,
    name: cfg.name,
    mechanic: "clicker",
    params: { dmgPerClick: cfg.dmgPerClick, maxCps: cfg.maxCps },
    image: "/boss/veyrath-idle",
    blurb: "",
    maxHp: cfg.maxHp,
    rewardPool: cfg.rewardPool,
    penalty: cfg.penalty,
  };

  // Form fields override the template when filled in (blank = use template).
  const overr = (key: string, fallback: number): number =>
    fd.get(key) ? clampInt(fd, key, fallback, 0, 1_000_000_000) : fallback;

  await prisma.boss.create({
    data: {
      dedupeKey: `manual:${randomUUID()}`,
      source: "manual",
      templateKey: base.key,
      weekOf: getChallengeDate(spawnsAt),
      name: String(fd.get("name") ?? "").trim() || base.name,
      mechanic: base.mechanic,
      params: base.params as Prisma.InputJsonValue,
      image: base.image,
      blurb: base.blurb,
      maxHp: Math.max(1, overr("maxHp", base.maxHp)),
      rewardPool: overr("rewardPool", base.rewardPool),
      penalty: overr("penalty", base.penalty),
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
