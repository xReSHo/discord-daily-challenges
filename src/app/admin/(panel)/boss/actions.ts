"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAdmin, requireAdminAction } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { challengeInstant, formatAdminTime, getChallengeDate } from "@/lib/challenge-date";
import { BOSS_DEFAULTS, MAX_BOSS_PENALTY, bustBossConfigCache, capPenalty, getBossConfig } from "@/lib/boss/config";
import { bustRosterCache, getRoster, getTemplate } from "@/lib/boss/roster";
import { resolveBoss, despawnBoss as despawnBossById } from "@/lib/boss/game";
import type { Prisma } from "@prisma/client";

/** Full admin gate (allowlist + unlocked second factor), then an audit row
 *  naming the action and the boss / template it targets. */
async function requireAdmin(action: string, fd: FormData): Promise<void> {
  const discordId = await requireAdminAction();
  const target: Record<string, string> = {};
  for (const k of ["id", "key", "templateKey"]) {
    const v = fd.get(k);
    if (typeof v === "string" && v) target[k] = v.slice(0, 80);
  }
  await logAdmin(discordId, `boss.${action}`, target);
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

/** Back to the boss page with the result of the action shown at the top. */
function flash(kind: "ok" | "err", message: string): never {
  redirect(`/admin/boss?${kind}=${encodeURIComponent(message)}`);
}

/** Two ends of a range, in order and never below `lo`. */
function ordered(a: number, b: number, lo: number): [number, number] {
  const x = Math.max(lo, a);
  const y = Math.max(lo, b);
  return x <= y ? [x, y] : [y, x];
}

/**
 * Upsert the BossConfig singleton — now just the weekly schedule + global
 * switch. The legacy per-boss stat columns are non-null, so preserve whatever
 * is already stored (the roster owns those numbers).
 */
export async function saveBossConfig(fd: FormData): Promise<void> {
  await requireAdmin("saveBossConfig", fd);
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
  // The raid starts and ends on the same day; an end at or before the start
  // would be a raid that is never live.
  if (schedule.despawnHour * 60 + schedule.despawnMin <= schedule.spawnHour * 60) {
    flash("err", "The raid has to end later in the day than it starts.");
  }
  await prisma.bossConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...legacy, ...schedule },
    update: schedule,
  });
  bustBossConfigCache();
  refresh();
  flash("ok", schedule.weeklyEnabled ? "Schedule saved." : "Schedule saved — the weekly raid is off.");
}

/**
 * Edit one roster template. Mechanic params come in as labelled `p_<key>`
 * number fields (the shape depends on the boss's fixed mechanic); a blank field
 * keeps the current value.
 */
export async function saveBossTemplate(fd: FormData): Promise<void> {
  await requireAdmin("saveBossTemplate", fd);
  const key = String(fd.get("key") ?? "");
  const current = await getTemplate(key);
  if (!current) flash("err", "That boss no longer exists.");

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
        darkMs: ordered(Pi("darkMs_min", arr("darkMs")[0] ?? 20000), Pi("darkMs_max", arr("darkMs")[1] ?? 38000), 1000),
        neutralMs: ordered(Pi("neutralMs_min", arr("neutralMs")[0] ?? 16000), Pi("neutralMs_max", arr("neutralMs")[1] ?? 30000), 1000),
        lightMs: ordered(Pi("lightMs_min", arr("lightMs")[0] ?? 20000), Pi("lightMs_max", arr("lightMs")[1] ?? 38000), 1000),
      };
      break;
    case "weakpoint":
      params = {
        slots: Pi("slots", cur.slots ?? 6),
        sacIntervalMs: Pi("sacIntervalMs", cur.sacIntervalMs ?? 700),
        sacTtlMs: Pi("sacTtlMs", cur.sacTtlMs ?? 1200),
        dmgPerSac: P("dmgPerSac", cur.dmgPerSac ?? 2),
        missDmg: Math.max(0, P("missDmg", cur.missDmg ?? 0.2)),
        comboStep: Math.max(1, Pi("comboStep", cur.comboStep ?? 10)),
        comboBonus: Math.max(0, P("comboBonus", cur.comboBonus ?? 0.1)),
        comboMax: Math.min(5, Math.max(1, P("comboMax", cur.comboMax ?? 1.5))),
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
      name: String(fd.get("name") ?? "").trim().slice(0, 80) || current.name,
      blurb: String(fd.get("blurb") ?? "").trim().slice(0, 300),
      enabled: fd.get("enabled") === "on",
      maxHp: clampInt(fd, "maxHp", current.maxHp, 1, 100_000_000),
      rewardPool: clampInt(fd, "rewardPool", current.rewardPool, 0, 1_000_000_000),
      penalty: clampInt(fd, "penalty", current.penalty, 0, MAX_BOSS_PENALTY),
      params: params as Prisma.InputJsonValue,
    },
  });
  bustRosterCache();
  refresh();
  flash("ok", `${current.name.split(",")[0]} saved — it applies from its next raid.`);
}

/** Spawn a one-off boss now (or between explicit start/end times). */
export async function spawnBoss(fd: FormData): Promise<void> {
  await requireAdmin("spawnBoss", fd);

  const now = new Date();
  // A datetime-local field sends "YYYY-MM-DDTHH:MM" with no zone; the form
  // labels it Bahrain time, like every other time on the admin pages.
  const startRaw = String(fd.get("startsAt") ?? "").trim();
  const endRaw = String(fd.get("endsAt") ?? "").trim();

  const spawnsAt = startRaw ? challengeInstant(startRaw) : now;
  if (!spawnsAt) flash("err", "That start time isn't valid.");

  let expiresAt: Date;
  if (endRaw) {
    const end = challengeInstant(endRaw);
    if (!end) flash("err", "That end time isn't valid.");
    expiresAt = end;
  } else {
    const hours = Math.min(168, num(fd, "autoEndHours", 6, 0.05));
    expiresAt = new Date(spawnsAt.getTime() + hours * 3_600_000);
  }
  if (expiresAt <= spawnsAt) flash("err", "The raid has to end after it starts.");
  if (expiresAt <= now) flash("err", "That raid would already be over.");

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
      name: String(fd.get("name") ?? "").trim().slice(0, 80) || base.name,
      mechanic: base.mechanic,
      params: base.params as Prisma.InputJsonValue,
      image: base.image,
      blurb: base.blurb,
      maxHp: Math.max(1, overr("maxHp", base.maxHp)),
      rewardPool: overr("rewardPool", base.rewardPool),
      penalty: capPenalty(overr("penalty", base.penalty)),
      adminOnly: fd.get("adminOnly") === "on",
      paysOut: fd.get("paysOut") === "on",
      spawnsAt,
      expiresAt,
    },
  });
  refresh();
  flash(
    "ok",
    `${base.name.split(",")[0]} ${spawnsAt > now ? `starts ${formatAdminTime(spawnsAt)} and` : "is live and"} ends ${formatAdminTime(expiresAt)}.`,
  );
}

/** End (if needed) and settle a boss now. */
export async function resolveBossNow(fd: FormData): Promise<void> {
  await requireAdmin("resolveBossNow", fd);
  const id = String(fd.get("id") ?? "");
  await prisma.boss.updateMany({
    where: { id, resolved: false, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });
  await resolveBoss(id);
  refresh();
  flash("ok", "Raid ended and settled.");
}

/** Despawn a boss immediately — no resolution, no payout. A manual test boss is
 *  deleted; the weekly boss is force-resolved so it stops showing. */
export async function despawnBoss(fd: FormData): Promise<void> {
  await requireAdmin("despawnBoss", fd);
  const id = String(fd.get("id") ?? "");
  const removed = await despawnBossById(id);
  refresh();
  flash(removed ? "ok" : "err", removed ? "Raid removed — nothing was paid." : "That raid no longer exists.");
}
