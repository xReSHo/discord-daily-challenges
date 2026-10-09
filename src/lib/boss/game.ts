/**
 * Weekly boss — server-side fight logic.
 *
 *   - The live boss is whichever `Boss` row is currently inside its
 *     [spawnsAt, expiresAt] window and not yet resolved. The recurring weekly
 *     raid is created lazily from `BossConfig` the first time someone loads the
 *     arena during its window (P2002 race handled on `dedupeKey`). Admins can
 *     also spawn one-off bosses from /admin/boss.
 *   - `adminOnly` bosses are invisible to (and un-hittable by) non-admins.
 *   - Damage is denormalised onto `Boss.dealtDamage`.
 *   - Payout / penalty happens in `resolveBoss` (idempotent, per-fighter
 *     `settled` flag). A boss with `paysOut = false` settles the tallies but
 *     never touches UnbelievaBoat.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addCurrency } from "@/lib/unbelievaboat";
import { rollBossDrop } from "@/lib/equipment-drops";
import {
  BOSS_DROP_MIN_SHARE,
  comboGrace,
  skipsFirstStall,
  withFocus,
  withHaste,
  withPower,
  withWard,
} from "@/lib/equipment";
import { getGear } from "@/lib/equipment-effects";
import { isAdmin } from "@/lib/admin";
import { flagAttempt } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { evaluateAchievements } from "@/lib/achievements/engine";
import { later } from "@/lib/background";
import { capPenalty, getBossConfig, type BossConfig } from "./config";
import { pickWeeklyTemplate } from "./roster";
import { eclipseConfig, eclipsePhaseAt } from "./mechanics/eclipse";
import {
  BREATH,
  CORONA,
  THREADS,
  betterBreath,
  breathFrom,
  comboKindFor,
  coronaMult,
  keepsThread,
  momentumMult,
  momentumStep,
  threadsMult,
  type ComboState,
} from "./mechanics/combo";
import {
  SAC_KINDS,
  cleanSeq,
  comboMult,
  offeredByKind,
  weakpointConfig,
} from "./mechanics/weakpoint";
import { weeklyWindow } from "./window";
import type { BossState } from "./types";

export type { BossState, BossLeader, HitResponse } from "./types";

const SECTION = "boss";
const TOP_N = 8;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

type BossRow = Prisma.BossGetPayload<object>;

/** What a fighter's row remembers between batches, per mechanic. */
type HitMeta = {
  // weak-point
  missStreak?: number;
  stallUntil?: number;
  combo?: number;
  /** the legendary gauntlets have already spared this fighter one stall */
  spared?: boolean;
  // mini-arena
  miniCdUntil?: number;
  th?: { chain: number; recent: string[] };
  // click race: momentum, breath, corona
  mo?: number;
  br?: { bank: number; blows: number; mult: number };
  co?: { stacks: number; phase: number; strikes: number; done: boolean };
};

/** A fighter's standing in this boss's combo, from their row. */
function comboFromMeta(boss: BossRow, raw: unknown): ComboState {
  const m = (raw ?? {}) as HitMeta;
  switch (comboKindFor(boss.mechanic, boss.templateKey, boss.params)) {
    case "momentum":
      return { kind: "momentum", value: m.mo ?? 0 };
    case "breath":
      return { kind: "breath", blows: m.br?.blows ?? 0, mult: m.br?.mult ?? 1 };
    case "corona":
      return {
        kind: "corona",
        stacks: m.co?.stacks ?? 0,
        phase: m.co?.phase ?? -1,
        strikes: m.co?.strikes ?? 0,
      };
    case "threads":
      return { kind: "threads", chain: m.th?.chain ?? 0, recent: m.th?.recent ?? [] };
    default:
      return { kind: "streak" };
  }
}

/** The click-damage knobs for a boss — snapshotted onto `params` at spawn,
 *  with the legacy BossConfig values as the fallback for pre-roster rows. */
function clickerParams(
  boss: BossRow,
  cfg: BossConfig,
): { dmgPerClick: number; maxCps: number } {
  const p = (boss.params ?? {}) as Record<string, unknown>;
  return {
    dmgPerClick:
      typeof p.dmgPerClick === "number" && p.dmgPerClick > 0
        ? p.dmgPerClick
        : cfg.dmgPerClick,
    maxCps:
      typeof p.maxCps === "number" && p.maxCps >= 1
        ? Math.floor(p.maxCps)
        : cfg.maxCps,
  };
}

// --- which boss is live -------------------------------------------------

// Short-TTL cache of the live boss row so the hit path (called every few
// seconds per fighter) isn't a query each time. Only a non-null row is cached;
// its immutable fields (id, maxHp, rewardPool…) are what callers rely on, and
// dealtDamage/slain are always re-read from the write that follows.
let liveCache: { at: number; admin: boolean; row: BossRow } | null = null;
const LIVE_TTL_MS = 10_000;

async function cachedLiveBoss(admin: boolean): Promise<BossRow | null> {
  if (liveCache && liveCache.admin === admin && Date.now() - liveCache.at < LIVE_TTL_MS) {
    return liveCache.row;
  }
  const row = await liveBoss(admin);
  if (row) liveCache = { at: Date.now(), admin, row };
  return row;
}

async function lazyCreateWeekly(cfg: BossConfig): Promise<BossRow | null> {
  const win = weeklyWindow(cfg);
  if (win.status !== "active") return null;

  const dedupeKey = `weekly:${win.weekOf}`;
  const existing = await prisma.boss.findUnique({ where: { dedupeKey } });
  if (existing) return existing;

  const tpl = await pickWeeklyTemplate(win.weekOf);
  const snapshot = tpl
    ? {
        templateKey: tpl.key,
        name: tpl.name,
        mechanic: tpl.mechanic,
        params: tpl.params as Prisma.InputJsonValue,
        image: tpl.image,
        blurb: tpl.blurb,
        maxHp: tpl.maxHp,
        rewardPool: tpl.rewardPool,
        penalty: capPenalty(tpl.penalty),
      }
    : {
        name: cfg.name,
        mechanic: "clicker",
        params: {
          dmgPerClick: cfg.dmgPerClick,
          maxCps: cfg.maxCps,
        } as Prisma.InputJsonValue,
        image: "/boss/veyrath-idle",
        blurb: "",
        maxHp: cfg.maxHp,
        rewardPool: cfg.rewardPool,
        penalty: capPenalty(cfg.penalty),
      };

  try {
    return await prisma.boss.create({
      data: {
        dedupeKey,
        source: "weekly",
        weekOf: new Date(`${win.weekOf}T00:00:00.000Z`),
        spawnsAt: win.spawnsAt,
        expiresAt: win.expiresAt,
        ...snapshot,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.boss.findUniqueOrThrow({ where: { dedupeKey } });
    }
    throw err;
  }
}

/** The boss to fight right now for this viewer, or null. */
async function liveBoss(viewerIsAdmin: boolean): Promise<BossRow | null> {
  const now = new Date();
  const vis = viewerIsAdmin ? {} : { adminOnly: false };

  const row = await prisma.boss.findFirst({
    where: { resolved: false, spawnsAt: { lte: now }, expiresAt: { gte: now }, ...vis },
    orderBy: { spawnsAt: "desc" },
  });
  if (row) return row;

  const cfg = await getBossConfig();
  return cfg.weeklyEnabled ? lazyCreateWeekly(cfg) : null;
}

/** Live boss if there is one, else the most recent past boss visible to the
 *  viewer (for the "ended" recap). */
async function referenceBoss(
  viewerIsAdmin: boolean,
): Promise<{ row: BossRow | null; live: boolean }> {
  const live = await liveBoss(viewerIsAdmin);
  if (live) return { row: live, live: true };

  const vis = viewerIsAdmin ? {} : { adminOnly: false };
  const past = await prisma.boss.findFirst({
    where: { spawnsAt: { lte: new Date() }, ...vis },
    orderBy: { spawnsAt: "desc" },
  });
  return { row: past, live: false };
}

// --- shared snapshot --------------------------------------------------

type SharedSnapshot = {
  boss: BossRow | null;
  live: boolean;
  participants: number;
  leaders: { discordId: string; name: string; image: string | null; damage: number }[];
};

// The public snapshot (non-admin view) is cached hard — during a raid the hit
// response IS the poll, so a few seconds of staleness on other people's
// numbers is invisible. Admins get an uncached read (low traffic, and fresh
// data is what you want while testing).
let cache: { at: number; data: SharedSnapshot } | null = null;
const CACHE_MS = 5000;
let refreshing: Promise<SharedSnapshot> | null = null;

let nameCache: { at: number; byId: Map<string, { name: string | null; image: string | null }> } | null = null;
const NAME_CACHE_MS = 120_000;

async function computeSnapshot(viewerIsAdmin: boolean): Promise<SharedSnapshot> {
  const { row, live } = await referenceBoss(viewerIsAdmin);
  if (!row) {
    return { boss: null, live: false, participants: 0, leaders: [] };
  }

  const [participants, hits] = await Promise.all([
    prisma.bossHit.count({ where: { bossId: row.id } }),
    prisma.bossHit.findMany({
      where: { bossId: row.id },
      orderBy: { damage: "desc" },
      take: TOP_N,
      select: { discordId: true, damage: true },
    }),
  ]);

  const missing =
    !nameCache || Date.now() - nameCache.at > NAME_CACHE_MS
      ? hits.map((h) => h.discordId)
      : hits.map((h) => h.discordId).filter((id) => !nameCache!.byId.has(id));
  if (missing.length) {
    const users = await prisma.user.findMany({
      where: { discordId: { in: missing } },
      select: { discordId: true, name: true, image: true },
    });
    const byId =
      nameCache && Date.now() - nameCache.at <= NAME_CACHE_MS ? nameCache.byId : new Map();
    for (const u of users) byId.set(u.discordId, { name: u.name, image: u.image });
    nameCache = { at: Date.now(), byId };
  }
  const byId = nameCache?.byId ?? new Map();

  return {
    boss: row,
    live,
    participants,
    leaders: hits.map((h) => ({
      discordId: h.discordId,
      name: byId.get(h.discordId)?.name ?? "A challenger",
      image: byId.get(h.discordId)?.image ?? null,
      damage: h.damage,
    })),
  };
}

async function sharedSnapshot(staleOk: boolean, viewerIsAdmin: boolean): Promise<SharedSnapshot> {
  if (viewerIsAdmin) return computeSnapshot(true);

  const fresh = cache && Date.now() - cache.at < CACHE_MS;
  if (fresh) return cache!.data;
  if (staleOk && cache) {
    if (!refreshing) {
      refreshing = computeSnapshot(false)
        .then((d) => {
          cache = { at: Date.now(), data: d };
          return d;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return cache.data;
  }
  if (refreshing) return refreshing;
  refreshing = computeSnapshot(false)
    .then((d) => {
      cache = { at: Date.now(), data: d };
      return d;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// Self-heal: after a boss's window closes, the first read triggers a settle in
// the background so payouts don't depend on the bot. Throttled per instance.
let lastLazyResolve = 0;
function maybeLazyResolve() {
  const now = Date.now();
  if (now - lastLazyResolve < 30_000) return;
  lastLazyResolve = now;
  resolveBoss().catch((e) => logger.error("boss.lazy_resolve_failed", { message: String(e) }));
}

/**
 * `fresh` lets `applyHit` skip the per-user query and the snapshot refresh: it
 * already knows the caller's up-to-the-millisecond hp/damage from its own writes.
 */
export async function getBossState(
  discordId?: string | null,
  fresh?: { hp: number; dealt: number; slain: boolean; yourDamage: number; boss: BossRow },
): Promise<BossState> {
  const viewerIsAdmin = isAdmin(discordId);
  const cfg = await getBossConfig();
  const win = weeklyWindow(cfg);

  const snap = fresh
    ? { boss: fresh.boss, live: true, participants: 0, leaders: [] as SharedSnapshot["leaders"] }
    : await sharedSnapshot(false, viewerIsAdmin);

  const boss = snap.boss;
  const live = fresh ? true : snap.live;

  if (!fresh && boss && !live && !boss.resolved) maybeLazyResolve();

  // status
  let status: BossState["status"];
  if (live) status = "active";
  else if (cfg.weeklyEnabled) status = win.status === "active" ? "ended" : win.status;
  else status = boss ? "ended" : "upcoming";

  // next spawn: soonest of the weekly window and any future manual boss
  let nextSpawnsAt = win.nextSpawnsAt;
  const futureManual = await prisma.boss.findFirst({
    where: {
      spawnsAt: { gt: new Date() },
      resolved: false,
      ...(viewerIsAdmin ? {} : { adminOnly: false }),
    },
    orderBy: { spawnsAt: "asc" },
    select: { spawnsAt: true },
  });
  if (futureManual && futureManual.spawnsAt < nextSpawnsAt) nextSpawnsAt = futureManual.spawnsAt;

  // per-fighter numbers
  let yourDamage = fresh?.yourDamage ?? 0;
  let yourPayout: number | null = null;
  let yourCooldownUntil: number | null = null;
  let myMeta: unknown = null;
  if (!fresh && discordId && boss) {
    const mine = await prisma.bossHit.findUnique({
      where: { bossId_discordId: { bossId: boss.id, discordId } },
      select: { damage: true, settled: true, payout: true, meta: true },
    });
    if (mine) {
      myMeta = mine.meta;
      yourDamage = mine.damage;
      if (mine.settled) yourPayout = mine.payout;
      const m = mine.meta as { stallUntil?: number; miniCdUntil?: number } | null;
      const cd =
        boss.mechanic === "weakpoint"
          ? m?.stallUntil
          : boss.mechanic === "miniarena"
            ? m?.miniCdUntil
            : undefined;
      if ((cd ?? 0) > Date.now()) yourCooldownUntil = cd ?? null;
    }
  }

  const clk = boss
    ? clickerParams(boss, cfg)
    : { dmgPerClick: cfg.dmgPerClick, maxCps: cfg.maxCps };

  const maxHp = boss?.maxHp ?? cfg.maxHp;
  const dealt = fresh?.dealt ?? Math.min(boss?.dealtDamage ?? 0, maxHp);
  const slain = fresh?.slain ?? boss?.slain ?? false;
  const hp = fresh?.hp ?? Math.max(0, maxHp - dealt);
  const spawnsAt = boss?.spawnsAt ?? win.spawnsAt;
  const expiresAt = boss?.expiresAt ?? win.expiresAt;

  return {
    name: boss?.name ?? cfg.name,
    status,
    maxHp,
    hp,
    dealt: Math.min(dealt, maxHp),
    slain,
    slainAt: boss?.slainAt ? boss.slainAt.toISOString() : null,
    resolved: boss?.resolved ?? false,
    spawnsAt: spawnsAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nextSpawnsAt: nextSpawnsAt.toISOString(),
    participants: snap.participants,
    top: snap.leaders.map((l, i) => ({
      rank: i + 1,
      name: l.name,
      image: l.image,
      damage: Math.round(l.damage * 10) / 10,
      you: !!discordId && l.discordId === discordId,
    })),
    yourDamage: Math.round(yourDamage * 10) / 10,
    yourPayout,
    cpsCap: clk.maxCps,
    dmgPerClick: clk.dmgPerClick,
    rewardPool: boss?.rewardPool ?? cfg.rewardPool,
    penaltyEach: capPenalty(boss?.penalty ?? cfg.penalty),
    mechanic: (boss?.mechanic as BossState["mechanic"]) ?? "clicker",
    phase:
      boss?.mechanic === "eclipse" ? eclipseConfig(boss.params) : undefined,
    weakpoint:
      boss?.mechanic === "weakpoint"
        ? (() => {
            const w = weakpointConfig(boss.params);
            return {
              slots: w.slots,
              sacIntervalMs: w.sacIntervalMs,
              sacTtlMs: w.sacTtlMs,
              dmgPerSac: w.dmgPerSac,
              missDmg: w.missDmg,
              comboStep: w.comboStep,
              comboBonus: w.comboBonus,
              comboMax: w.comboMax,
              stallMs: w.stallMs,
            };
          })()
        : undefined,
    mini:
      boss?.mechanic === "miniarena"
        ? { games: ["typing", "aim", "litany"] }
        : undefined,
    yourCooldownUntil,
    combo: boss ? comboFromMeta(boss, myMeta) : undefined,
    blurb: boss?.blurb ?? "",
    image: boss?.image ?? "/boss/veyrath-idle",
    adminOnly: boss?.adminOnly ?? false,
    paysOut: boss?.paysOut ?? true,
    source: (boss?.source as BossState["source"]) ?? "weekly",
    viewerIsAdmin,
    bossKey: (boss?.spawnsAt ?? win.spawnsAt).toISOString(),
  };
}

// --- landing hits ------------------------------------------------------

const lastHitMs = new Map<string, number>();

export type HitResult =
  | { ok: false; error: "no_active_boss"; state: BossState }
  | { ok: true; state: BossState; applied: number };

/**
 * Land a batch of actions on the live boss. `body` is the raw request body —
 * `{ clicks }` for the clicker / eclipse, `{ seq }` for the weak-point.
 * Dispatches on the boss's mechanic.
 */
export async function applyHit(discordId: string, body: unknown): Promise<HitResult> {
  const viewerIsAdmin = isAdmin(discordId);
  const boss = await cachedLiveBoss(viewerIsAdmin);

  if (!boss) {
    return { ok: false, error: "no_active_boss", state: await getBossState(discordId) };
  }

  return boss.mechanic === "weakpoint"
    ? strikeWeakpoint(discordId, boss, body)
    : clickBoss(discordId, boss, body);
}

/** When each fighter first struck each boss — what the legendary sword's
 *  opening seconds are counted from. Read once per instance, then remembered. */
const firstStrike = new Map<string, number>();

async function firstStrikeMs(bossId: string, discordId: string, now: number): Promise<number> {
  const key = `${bossId}:${discordId}`;
  const known = firstStrike.get(key);
  if (known !== undefined) return known;
  const row = await prisma.bossHit.findUnique({
    where: { bossId_discordId: { bossId, discordId } },
    select: { createdAt: true },
  });
  const at = row ? row.createdAt.getTime() : now;
  firstStrike.set(key, at);
  if (firstStrike.size > 5000) firstStrike.clear();
  return at;
}

/** Each click-race fighter's combo, kept beside `lastHitMs` so a batch
 *  doesn't cost a read. A cold instance falls back to the row. */
const clickMeta = new Map<string, HitMeta>();

/** How much wall time a fighter can have banked toward rests (breath): one
 *  full breath, one batch, and a slow request. */
const REST_BANK_MS = BREATH.fullMs + 2500 + 1500;

/**
 * Apply `dmg` from `actions` landed actions: bump the boss, run the slay check,
 * upsert this fighter's BossHit row, and build fresh state. Shared by every
 * mechanic. `clicks` is the running "actions landed" tally that keeps a fighter
 * eligible for the payout split.
 */
async function commitDamage(
  boss: BossRow,
  discordId: string,
  dmg: number,
  actions: number,
  now: number,
  meta?: Prisma.InputJsonValue,
): Promise<{ state: BossState; applied: number }> {
  // the sword: more damage, whatever the boss and however it is fought
  if (dmg > 0) {
    const gear = await getGear(discordId);
    if (gear.power > 0 || gear.perks.includes("sword")) {
      dmg = withPower(dmg, gear, now - (await firstStrikeMs(boss.id, discordId, now)));
    }
  }
  if (dmg <= 0 && actions <= 0) {
    if (meta !== undefined) {
      await prisma.bossHit.upsert({
        where: { bossId_discordId: { bossId: boss.id, discordId } },
        create: { bossId: boss.id, discordId, meta, lastHitAt: new Date(now) },
        update: { meta, lastHitAt: new Date(now) },
      });
    }
    return { state: await getBossState(discordId), applied: 0 };
  }

  const updated = await prisma.boss.update({
    where: { id: boss.id },
    data: { dealtDamage: { increment: dmg } },
    select: { dealtDamage: true, slain: true },
  });

  let slain = updated.slain;
  if (!slain && updated.dealtDamage >= boss.maxHp) {
    await prisma.boss.updateMany({
      where: { id: boss.id, slain: false },
      data: { slain: true, slainAt: new Date() },
    });
    slain = true;
  }

  const mine = await prisma.bossHit.upsert({
    where: { bossId_discordId: { bossId: boss.id, discordId } },
    create: {
      bossId: boss.id,
      discordId,
      damage: dmg,
      clicks: actions,
      ...(meta !== undefined ? { meta } : {}),
      lastHitAt: new Date(now),
    },
    update: {
      damage: { increment: dmg },
      clicks: { increment: actions },
      ...(meta !== undefined ? { meta } : {}),
      lastHitAt: new Date(now),
    },
    select: { damage: true },
  });

  const dealt = Math.min(updated.dealtDamage, boss.maxHp);
  const state = await getBossState(discordId, {
    hp: Math.max(0, boss.maxHp - dealt),
    dealt,
    slain,
    yourDamage: mine.damage,
    boss: { ...boss, dealtDamage: updated.dealtDamage, slain },
  });
  return { state, applied: actions };
}

/**
 * Clicker + eclipse — body `{ clicks }`, plus `{ rest }` for a boss whose
 * combo is `breath`: the longest pause (ms) the fighter took before striking.
 */
async function clickBoss(
  discordId: string,
  boss: BossRow,
  body: unknown,
): Promise<HitResult> {
  const cfg = await getBossConfig();
  const { dmgPerClick, maxCps } = clickerParams(boss, cfg);
  const key = `${boss.id}:${discordId}`;
  const now = Date.now();

  let lastMs = lastHitMs.get(key);
  let meta = clickMeta.get(key);
  if (lastMs === undefined || meta === undefined) {
    const row = await prisma.bossHit.findUnique({
      where: { bossId_discordId: { bossId: boss.id, discordId } },
      select: { lastHitAt: true, meta: true },
    });
    lastMs ??= row ? row.lastHitAt.getTime() : now - 1000;
    meta ??= (row?.meta ?? {}) as HitMeta;
  }

  const gapMs = Math.max(0, now - lastMs);
  const elapsedSec = clamp(gapMs / 1000, 0.05, 5);
  // what the cap allows for the time since the last batch, plus two seconds'
  // worth: batches from a slow connection arrive late and bunched together
  const budget = Math.ceil(maxCps * elapsedSec) + maxCps * 2;
  const b = (body ?? {}) as { clicks?: unknown; rest?: unknown };
  const requested = Math.max(0, Math.floor(Number(b.clicks) || 0));
  const applied = Math.min(requested, budget);

  if (requested >= 30 && requested > budget * 5) {
    flagAttempt(discordId, SECTION, "autoclicker suspected", {
      requested,
      budget,
      elapsedSec: Number(elapsedSec.toFixed(2)),
    });
  }

  lastHitMs.set(key, now);

  if (applied <= 0) {
    return { ok: true, state: await getBossState(discordId), applied: 0 };
  }

  // --- the combo: what this boss rewards, worked out from the batch alone ---
  const next: HitMeta = { ...meta };
  /** the batch in plain clicks' worth, after heavy blows */
  let worth = applied;
  let comboMult = 1;
  let phaseMult = 1;

  const gear = await getGear(discordId);
  const kind = comboKindFor(boss.mechanic, boss.templateKey, boss.params);
  if (kind === "momentum") {
    // pace over the whole gap, so a pause shows up as a slow batch
    const rate = applied / clamp(gapMs / 1000, 0.5, 120);
    next.mo = momentumStep(meta.mo ?? 0, rate, maxCps, clamp(gapMs / 1000, 0.05, 120));
    comboMult = withFocus(momentumMult(next.mo), gear);
  } else if (kind === "breath") {
    // a fighter's first batch has no history to measure a rest against, so
    // it starts with room for one
    const br = meta.br ?? { bank: REST_BANK_MS, blows: 0, mult: 1 };
    // a rest has to fit in the time that really passed, less the least time
    // these clicks could have taken — nobody rests and strikes at once
    const need = (applied / maxCps) * 1000;
    const bank = Math.min(REST_BANK_MS, br.bank + gapMs);
    const claimed = clamp(Number(b.rest) || 0, 0, 60_000);
    const rest = Math.min(claimed, Math.max(0, bank - need + 300)); // + a little jitter
    const held = betterBreath({ blows: br.blows, mult: br.mult }, breathFrom(rest));
    const heavy = Math.min(applied, held.blows);
    worth = heavy * withFocus(held.mult, gear) + (applied - heavy);
    next.br = {
      bank: Math.max(0, bank - need - rest),
      blows: held.blows - heavy,
      mult: held.blows - heavy > 0 ? held.mult : 1,
    };
  }

  if (boss.mechanic === "eclipse") {
    const ph = eclipsePhaseAt(
      eclipseConfig(boss.params),
      boss.spawnsAt.toISOString(),
      boss.spawnsAt.getTime(),
      now,
    );
    phaseMult = ph.mult;

    const co = meta.co ?? { stacks: 0, phase: -1, strikes: 0, done: false };
    comboMult = withFocus(coronaMult(co.stacks), gear); // what they held coming into this batch
    let { stacks, phase, strikes, done } = co;
    if (ph.kind === "light" && ph.sinceMs > CORONA.lightGraceMs + comboGrace(gear)) {
      stacks = 0; // struck in the light: every corona burns away
    } else if (ph.kind === "dark") {
      if (phase !== ph.index) {
        phase = ph.index;
        strikes = 0;
        done = false;
      }
      strikes += applied;
      if (!done && strikes >= CORONA.strikes) {
        done = true;
        stacks = Math.min(CORONA.max, stacks + 1);
      }
    }
    next.co = { stacks, phase, strikes, done };
  }

  clickMeta.set(key, next);
  if (clickMeta.size > 5000) clickMeta.clear();

  const dmg = worth * dmgPerClick * phaseMult * comboMult;
  const { state, applied: a } = await commitDamage(
    boss,
    discordId,
    dmg,
    applied,
    now,
    next as Prisma.InputJsonValue,
  );
  return { ok: true, state: { ...state, combo: comboFromMeta(boss, next) }, applied: a };
}

/** A fighter who sends nothing for this long has dropped the combo. Looser
 *  than the client's own clock (COMBO_IDLE_MS) by a flush and a slow request. */
const COMBO_IDLE_SERVER_MS = 6500;

/**
 * Weak-point (Silt Cardinal) — body `{ seq }`: what the fighter did since the
 * last flush, in order (see `cleanSeq`). The older `{ sacHits, misses }` body,
 * from a page loaded before this shipped, is read as plain sacs then misses.
 */
async function strikeWeakpoint(
  discordId: string,
  boss: BossRow,
  body: unknown,
): Promise<HitResult> {
  const p = weakpointConfig(boss.params);
  const key = `${boss.id}:${discordId}`;
  const now = Date.now();
  const spawnMs = boss.spawnsAt.getTime();

  const b = (body ?? {}) as { seq?: unknown; sacHits?: unknown; misses?: unknown };
  const seq =
    typeof b.seq === "string"
      ? cleanSeq(b.seq)
      : cleanSeq(
          "0".repeat(Math.min(32, Math.max(0, Math.floor(Number(b.sacHits) || 0)))) +
            "m".repeat(Math.min(32, Math.max(0, Math.floor(Number(b.misses) || 0)))),
        );

  const existing = await prisma.bossHit.findUnique({
    where: { bossId_discordId: { bossId: boss.id, discordId } },
    select: { lastHitAt: true, meta: true },
  });
  const lastMs =
    lastHitMs.get(key) ??
    (existing ? existing.lastHitAt.getTime() : now - 1000);
  lastHitMs.set(key, now);

  const meta = (existing?.meta ?? {}) as HitMeta;
  const gear = await getGear(discordId);
  let missStreak = meta.missStreak ?? 0;
  let stallUntil = meta.stallUntil ?? 0;
  let spared = meta.spared ?? false;
  let combo =
    now - lastMs > COMBO_IDLE_SERVER_MS + comboGrace(gear) ? 0 : Math.max(0, meta.combo ?? 0);

  const elapsedSec = clamp((now - lastMs) / 1000, 0.05, 5);
  let credited = 0;
  let dmg = 0;

  if (stallUntil > now) {
    combo = 0; // the rot has their arm; nothing lands
  } else {
    const offered = offeredByKind(
      p,
      boss.spawnsAt.toISOString(),
      lastMs - spawnMs,
      now - spawnMs,
    );
    const budget = Math.ceil(p.maxSacsPerSec * elapsedSec) + p.maxSacsPerSec;
    // a grazing swing pays a little, but only a couple a second: flailing at
    // the air must never rival actually lancing something
    const grazeBudget = Math.ceil(2 * elapsedSec) + 2;
    const used = SAC_KINDS.map(() => 0);
    let claimed = 0;
    let misses = 0;

    for (const ch of seq) {
      if (ch === "m") {
        if (misses < grazeBudget) dmg += p.missDmg;
        misses += 1;
        combo = 0;
        continue;
      }
      claimed += 1;
      const k = Number(ch);
      // not on offer in this window, or past the pace cap: it never happened
      if (used[k] >= offered[k] || credited >= budget) continue;
      used[k] += 1;
      credited += 1;
      dmg += p.dmgPerSac * SAC_KINDS[k].mult * withFocus(comboMult(p, combo), gear);
      combo += 1;
    }

    const onOffer = offered.reduce((n, x) => n + x, 0);
    if (claimed >= 15 && claimed > onOffer * 4) {
      flagAttempt(discordId, SECTION, "weakpoint impossible claims", {
        claimed,
        offered: onOffer,
        elapsedSec: Number(elapsedSec.toFixed(2)),
      });
    }

    // only sloppy flushes (more misses than landed sacs) build toward a stall;
    // any net-positive flush wipes it clean
    const net = misses - credited;
    missStreak = net > 0 ? missStreak + net : 0;
    if (missStreak >= p.stallAt) {
      missStreak = 0;
      if (skipsFirstStall(gear) && !spared) {
        spared = true; // the legendary gauntlets shrug off the first one
      } else {
        stallUntil = now + withHaste(p.stallMs, gear);
        credited = 0; // the rot bites this flush
        dmg = 0;
        combo = 0;
      }
    }
  }

  const { state, applied } = await commitDamage(
    boss,
    discordId,
    dmg,
    credited,
    now,
    { missStreak, stallUntil, combo, ...(spared ? { spared } : {}) } as Prisma.InputJsonValue,
  );
  return {
    ok: true,
    state: { ...state, yourCooldownUntil: stallUntil > now ? stallUntil : null },
    applied,
  };
}

// --- mini-arena (Unraveled Saint) -----------------------------------

/** The live boss iff it's a mini-arena boss visible to this fighter. */
export async function liveMiniBoss(discordId: string): Promise<BossRow | null> {
  const boss = await cachedLiveBoss(isAdmin(discordId));
  return boss && boss.mechanic === "miniarena" ? boss : null;
}

/**
 * Land a scored mini-run's damage (0 for a rejected run) and stamp this
 * fighter's inter-run cooldown. Called only from src/lib/boss/mini.
 */
export async function applyMiniDamage(
  discordId: string,
  bossId: string,
  dmg: number,
  cooldownUntil: number,
  /** The trial just played, and whether it was passed. */
  run: { game: string; ok: boolean },
): Promise<{ state: BossState; dmg: number; mult: number }> {
  const boss = await cachedLiveBoss(isAdmin(discordId));
  if (!boss || boss.id !== bossId) {
    return { state: await getBossState(discordId), dmg: 0, mult: 1 };
  }

  // the thread: each trial passed that is neither of the last two played
  // adds to it; a repeat or a failure cuts it
  const row = await prisma.bossHit.findUnique({
    where: { bossId_discordId: { bossId: boss.id, discordId } },
    select: { meta: true },
  });
  const th = ((row?.meta ?? {}) as HitMeta).th ?? { chain: 0, recent: [] };
  const kept = run.ok && keepsThread(th.recent, run.game);
  const mult = kept ? withFocus(threadsMult(th.chain), await getGear(discordId)) : 1;
  const next = {
    chain: !run.ok ? 0 : kept ? Math.min(THREADS.max, th.chain + 1) : 1,
    recent: [...th.recent, run.game].slice(-2),
  };

  const clean = Math.max(0, Number.isFinite(dmg) ? dmg : 0) * mult;
  const meta: HitMeta = { miniCdUntil: cooldownUntil, th: next };
  const { state } = await commitDamage(
    boss,
    discordId,
    clean,
    clean > 0 ? 1 : 0,
    Date.now(),
    meta as Prisma.InputJsonValue,
  );
  return {
    state: {
      ...state,
      yourCooldownUntil: cooldownUntil > Date.now() ? cooldownUntil : null,
      combo: comboFromMeta(boss, meta),
    },
    dmg: clean,
    mult,
  };
}

/**
 * Make a boss go away immediately — no resolution, no payout. Manual (test)
 * bosses are deleted outright (their hits cascade); the weekly boss is
 * force-resolved so it stops showing (it will lazily re-spawn if still inside
 * its window). With no `bossId`, acts on whatever boss is live right now.
 */
export async function despawnBoss(bossId?: string): Promise<boolean> {
  const now = new Date();
  const target = bossId
    ? await prisma.boss.findUnique({ where: { id: bossId } })
    : await prisma.boss.findFirst({
        where: { resolved: false, spawnsAt: { lte: now }, expiresAt: { gte: now } },
        orderBy: { spawnsAt: "desc" },
      });
  if (!target) return false;

  if (target.source === "manual") {
    await prisma.boss.delete({ where: { id: target.id } });
  } else {
    await prisma.boss.update({
      where: { id: target.id },
      data: { resolved: true, resolvedAt: now, expiresAt: now },
    });
  }
  cache = null;
  liveCache = null;
  return true;
}

// --- resolution (idempotent) -----------------------------------------

export type ResolveResult = {
  outcome: "slain" | "escaped" | "none" | "pending";
  weekOf?: string;
  bossName: string;
  paid: boolean;
  participants: number;
  totalPaid: number;
  penaltyEach: number;
  rewardPool: number;
  top: { name: string; damage: number; payout: number }[];
  unsettled: number;
};

export async function resolveBoss(bossId?: string): Promise<ResolveResult> {
  const now = new Date();
  const boss = bossId
    ? await prisma.boss.findUnique({ where: { id: bossId } })
    : await prisma.boss.findFirst({
        where: { resolved: false, OR: [{ slain: true }, { expiresAt: { lte: now } }] },
        orderBy: { spawnsAt: "desc" },
      });

  if (!boss || boss.resolved) {
    const cfg = await getBossConfig();
    return {
      outcome: "none",
      bossName: boss?.name ?? cfg.name,
      paid: true,
      participants: 0,
      totalPaid: 0,
      penaltyEach: capPenalty(boss?.penalty ?? cfg.penalty),
      rewardPool: boss?.rewardPool ?? cfg.rewardPool,
      top: [],
      unsettled: 0,
    };
  }

  const allHits = await prisma.bossHit.findMany({
    where: { bossId: boss.id, clicks: { gt: 0 } },
    orderBy: { damage: "desc" },
  });
  const totalDamage = allHits.reduce((a, h) => a + h.damage, 0) || 1;
  const pending = allHits.filter((h) => !h.settled);

  let totalPaid = 0;
  let unsettled = 0;

  for (let i = 0; i < pending.length; i++) {
    const h = pending[i];
    let amount: number;
    let reason: string;
    let target: "bank" | "cash" = "bank";
    if (boss.slain) {
      const base = Math.floor((boss.rewardPool * h.damage) / totalDamage);
      const isTop = allHits[0]?.id === h.id;
      const remainder = isTop
        ? boss.rewardPool -
          allHits.reduce((a, x) => a + Math.floor((boss.rewardPool * x.damage) / totalDamage), 0)
        : 0;
      amount = base + remainder;
      reason = `${boss.name} slain — raid bounty`;
    } else {
      // the chestplate: a smaller penalty, or none at all for the legendary
      // one when the boss was nearly down
      const hpLeft = Math.max(0, boss.maxHp - boss.dealtDamage) / Math.max(1, boss.maxHp);
      amount = -withWard(capPenalty(boss.penalty), await getGear(h.discordId), hpLeft);
      reason = `${boss.name} escaped — raid penalty`;
      target = "cash";
    }

    const claim = await prisma.bossHit.updateMany({
      where: { id: h.id, settled: false },
      data: { settled: true, payout: amount },
    });
    if (claim.count === 0) continue;

    if (boss.slain) {
      later(() => evaluateAchievements(h.discordId));
    }

    // a slain boss may leave equipment for each fighter who truly took part.
    // Claimed above, so it rolls once; a test raid that pays nothing drops nothing.
    if (boss.slain && boss.paysOut && h.damage >= boss.maxHp * BOSS_DROP_MIN_SHARE) {
      const top = allHits.slice(0, 3).some((x) => x.id === h.id);
      await rollBossDrop(h.discordId, boss, top);
    }

    try {
      if (boss.paysOut && amount !== 0) await addCurrency(h.discordId, amount, reason, target);
      totalPaid += Math.abs(amount);
    } catch (err) {
      await prisma.bossHit
        .updateMany({ where: { id: h.id }, data: { settled: false, payout: 0 } })
        .catch(() => {});
      unsettled++;
      logger.error("boss.settle_failed", {
        bossId: boss.id,
        discordId: h.discordId,
        message: String(err),
      });
    }
  }

  if (unsettled === 0) {
    await prisma.boss.update({
      where: { id: boss.id },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }
  cache = null;
  liveCache = null;

  const names = allHits.length
    ? await prisma.user.findMany({
        where: { discordId: { in: allHits.slice(0, TOP_N).map((h) => h.discordId) } },
        select: { discordId: true, name: true },
      })
    : [];
  const nameById = new Map(names.map((u) => [u.discordId, u.name ?? "A challenger"]));

  return {
    outcome: unsettled > 0 ? "pending" : boss.slain ? "slain" : "escaped",
    weekOf: boss.weekOf.toISOString().slice(0, 10),
    bossName: boss.name,
    paid: boss.paysOut,
    participants: allHits.length,
    totalPaid,
    penaltyEach: capPenalty(boss.penalty),
    rewardPool: boss.rewardPool,
    top: allHits.slice(0, TOP_N).map((h) => ({
      name: nameById.get(h.discordId) ?? "A challenger",
      damage: Math.round(h.damage * 10) / 10,
      payout: h.settled ? h.payout : 0,
    })),
    unsettled,
  };
}

/** What the strip under the site header says while a raid is on, or null when
 *  none is. Read from the shared snapshot, so for players it costs nothing
 *  beyond what the raid already keeps warm. */
export type RaidBrief = {
  name: string;
  expiresAt: string;
  /** health left, 0..1 */
  hpLeft: number;
  penaltyEach: number;
  adminOnly: boolean;
};

export async function getRaidBrief(discordId?: string | null): Promise<RaidBrief | null> {
  try {
    const snap = await sharedSnapshot(true, isAdmin(discordId));
    const boss = snap.boss;
    if (!boss || !snap.live || boss.slain) return null;
    return {
      name: boss.name,
      expiresAt: boss.expiresAt.toISOString(),
      hpLeft: Math.max(0, Math.min(1, (boss.maxHp - boss.dealtDamage) / boss.maxHp)),
      penaltyEach: capPenalty(boss.penalty),
      adminOnly: boss.adminOnly,
    };
  } catch {
    return null;
  }
}
