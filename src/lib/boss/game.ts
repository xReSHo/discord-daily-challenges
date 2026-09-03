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
import { isAdmin } from "@/lib/admin";
import { flagAttempt } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getBossConfig, type BossConfig } from "./config";
import { weeklyWindow } from "./window";
import type { BossState } from "./types";

export type { BossState, BossLeader, HitResponse } from "./types";

const SECTION = "boss";
const TOP_N = 8;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

type BossRow = Prisma.BossGetPayload<object>;

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

  try {
    return await prisma.boss.create({
      data: {
        dedupeKey,
        source: "weekly",
        weekOf: new Date(`${win.weekOf}T00:00:00.000Z`),
        name: cfg.name,
        maxHp: cfg.maxHp,
        rewardPool: cfg.rewardPool,
        penalty: cfg.penalty,
        spawnsAt: win.spawnsAt,
        expiresAt: win.expiresAt,
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
  if (!fresh && discordId && boss) {
    const mine = await prisma.bossHit.findUnique({
      where: { bossId_discordId: { bossId: boss.id, discordId } },
      select: { damage: true, settled: true, payout: true },
    });
    if (mine) {
      yourDamage = mine.damage;
      if (mine.settled) yourPayout = mine.payout;
    }
  }

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
    cpsCap: cfg.maxCps,
    dmgPerClick: cfg.dmgPerClick,
    rewardPool: boss?.rewardPool ?? cfg.rewardPool,
    penaltyEach: boss?.penalty ?? cfg.penalty,
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

export async function applyHit(discordId: string, rawClicks: unknown): Promise<HitResult> {
  const viewerIsAdmin = isAdmin(discordId);
  const boss = await cachedLiveBoss(viewerIsAdmin);

  if (!boss) {
    return { ok: false, error: "no_active_boss", state: await getBossState(discordId) };
  }

  const cfg = await getBossConfig();
  const key = `${boss.id}:${discordId}`;
  const now = Date.now();

  let lastMs = lastHitMs.get(key);
  if (lastMs === undefined) {
    const row = await prisma.bossHit.findUnique({
      where: { bossId_discordId: { bossId: boss.id, discordId } },
      select: { lastHitAt: true },
    });
    lastMs = row ? row.lastHitAt.getTime() : now - 1000;
  }

  const elapsedSec = clamp((now - lastMs) / 1000, 0.05, 5);
  const budget = Math.ceil(cfg.maxCps * elapsedSec) + cfg.maxCps;
  const requested = Math.max(0, Math.floor(Number(rawClicks) || 0));
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

  const dmg = applied * cfg.dmgPerClick;

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
    create: { bossId: boss.id, discordId, damage: dmg, clicks: applied, lastHitAt: new Date(now) },
    update: {
      damage: { increment: dmg },
      clicks: { increment: applied },
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
  return { ok: true, state, applied };
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
      paid: true,
      participants: 0,
      totalPaid: 0,
      penaltyEach: boss?.penalty ?? cfg.penalty,
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
      amount = -boss.penalty;
      reason = `${boss.name} escaped — raid penalty`;
      target = "cash";
    }

    const claim = await prisma.bossHit.updateMany({
      where: { id: h.id, settled: false },
      data: { settled: true, payout: amount },
    });
    if (claim.count === 0) continue;

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
    paid: boss.paysOut,
    participants: allHits.length,
    totalPaid,
    penaltyEach: boss.penalty,
    rewardPool: boss.rewardPool,
    top: allHits.slice(0, TOP_N).map((h) => ({
      name: nameById.get(h.discordId) ?? "A challenger",
      damage: Math.round(h.damage * 10) / 10,
      payout: h.settled ? h.payout : 0,
    })),
    unsettled,
  };
}
