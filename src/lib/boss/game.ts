/**
 * Weekly boss — server-side fight logic.
 *
 *   - The `Boss` row is created lazily the first time someone loads the arena
 *     during an active window (P2002 race handled like src/lib/wordle/daily.ts).
 *   - Damage is denormalised onto `Boss.dealtDamage`, so "is it dead?" is one
 *     indexed read, not a SUM over every fighter.
 *   - Each fighter's `BossHit.damage` is the basis for splitting the bounty.
 *   - Click-rate is clamped server-side to `BOSS_MAX_CPS`; blatant excess is
 *     logged via the shared audit trail (src/lib/audit.ts).
 *   - Payout / penalty happens in `resolveBoss`, which is idempotent and
 *     retry-safe (per-fighter `settled` flag, same discipline as
 *     src/lib/completions.ts).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addCurrency } from "@/lib/unbelievaboat";
import { flagAttempt } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getBossWindow } from "./window";
import type { BossState } from "./types";
import {
  BOSS_DMG_PER_CLICK,
  BOSS_FAIL_PENALTY,
  BOSS_MAX_CPS,
  BOSS_MAX_HP,
  BOSS_NAME,
  BOSS_SLAY_REWARD,
} from "./config";

export type { BossState, BossLeader, HitResponse } from "./types";

const SECTION = "boss";
const TOP_N = 8;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// --- lazy row creation (active window only) -------------------------------

async function getOrCreateActiveBoss() {
  const win = getBossWindow();
  if (win.status !== "active") return null;

  const weekOf = new Date(`${win.weekOf}T00:00:00.000Z`);
  const existing = await prisma.boss.findUnique({ where: { weekOf } });
  if (existing) return existing;

  try {
    return await prisma.boss.create({
      data: {
        weekOf,
        maxHp: BOSS_MAX_HP,
        spawnsAt: win.spawnsAt,
        expiresAt: win.expiresAt,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return prisma.boss.findUniqueOrThrow({ where: { weekOf } });
    }
    throw err;
  }
}

/** The Boss row for the current or most-recent window, if one exists. */
async function getReferenceBoss() {
  const win = getBossWindow();
  if (win.status === "upcoming") return null;
  if (win.status === "active") return getOrCreateActiveBoss();
  const weekOf = new Date(`${win.weekOf}T00:00:00.000Z`);
  return prisma.boss.findUnique({ where: { weekOf } });
}

// --- shared snapshot (cached ~1s per instance) ----------------------------

type SharedSnapshot = {
  bossId: string | null;
  maxHp: number;
  dealt: number;
  slain: boolean;
  slainAt: string | null;
  resolved: boolean;
  participants: number;
  leaders: { discordId: string; name: string; image: string | null; damage: number }[];
};

let cache: { at: number; data: SharedSnapshot } | null = null;
const CACHE_MS = 1000;

async function sharedSnapshot(): Promise<SharedSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const boss = await getReferenceBoss();
  if (!boss) {
    const empty: SharedSnapshot = {
      bossId: null,
      maxHp: BOSS_MAX_HP,
      dealt: 0,
      slain: false,
      slainAt: null,
      resolved: false,
      participants: 0,
      leaders: [],
    };
    cache = { at: Date.now(), data: empty };
    return empty;
  }

  const [participants, hits] = await Promise.all([
    prisma.bossHit.count({ where: { bossId: boss.id } }),
    prisma.bossHit.findMany({
      where: { bossId: boss.id },
      orderBy: { damage: "desc" },
      take: TOP_N,
      select: { discordId: true, damage: true },
    }),
  ]);

  const users = hits.length
    ? await prisma.user.findMany({
        where: { discordId: { in: hits.map((h) => h.discordId) } },
        select: { discordId: true, name: true, image: true },
      })
    : [];
  const byId = new Map(users.map((u) => [u.discordId, u]));

  const data: SharedSnapshot = {
    bossId: boss.id,
    maxHp: boss.maxHp,
    dealt: boss.dealtDamage,
    slain: boss.slain,
    slainAt: boss.slainAt ? boss.slainAt.toISOString() : null,
    resolved: boss.resolved,
    participants,
    leaders: hits.map((h) => ({
      discordId: h.discordId,
      name: byId.get(h.discordId)?.name ?? "A challenger",
      image: byId.get(h.discordId)?.image ?? null,
      damage: h.damage,
    })),
  };
  cache = { at: Date.now(), data };
  return data;
}

export async function getBossState(discordId?: string | null): Promise<BossState> {
  const win = getBossWindow();
  const snap = await sharedSnapshot();

  let yourDamage = 0;
  let yourPayout: number | null = null;
  if (discordId && snap.bossId) {
    const mine = await prisma.bossHit.findUnique({
      where: { bossId_discordId: { bossId: snap.bossId, discordId } },
      select: { damage: true, settled: true, payout: true },
    });
    if (mine) {
      yourDamage = mine.damage;
      if (mine.settled) yourPayout = mine.payout;
    }
  }

  const hp = Math.max(0, snap.maxHp - snap.dealt);

  return {
    name: BOSS_NAME,
    status: win.status,
    maxHp: snap.maxHp,
    hp,
    dealt: Math.min(snap.dealt, snap.maxHp),
    slain: snap.slain,
    slainAt: snap.slainAt,
    resolved: snap.resolved,
    spawnsAt: win.spawnsAt.toISOString(),
    expiresAt: win.expiresAt.toISOString(),
    nextSpawnsAt: win.nextSpawnsAt.toISOString(),
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
    cpsCap: BOSS_MAX_CPS,
    dmgPerClick: BOSS_DMG_PER_CLICK,
    rewardPool: BOSS_SLAY_REWARD,
    penaltyEach: BOSS_FAIL_PENALTY,
  };
}

// --- landing hits --------------------------------------------------------

// Per-instance memory of each fighter's last hit time, to skip a DB read on
// warm repeat batches. Only affects how generous the CPS budget is; a cold
// instance is at worst lenient for one batch.
const lastHitMs = new Map<string, number>();

export type HitResult =
  | { ok: false; error: "no_active_boss" | "already_slain"; state: BossState }
  | {
      ok: true;
      hp: number;
      maxHp: number;
      dealt: number;
      slain: boolean;
      yourDamage: number;
      applied: number;
    };

export async function applyHit(
  discordId: string,
  rawClicks: unknown,
): Promise<HitResult> {
  const boss = await getOrCreateActiveBoss();
  if (!boss) return { ok: false, error: "no_active_boss", state: await getBossState(discordId) };
  if (boss.slain) return { ok: false, error: "already_slain", state: await getBossState(discordId) };

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
  const budget = Math.ceil(BOSS_MAX_CPS * elapsedSec) + BOSS_MAX_CPS;
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
    const dealt = Math.min(boss.dealtDamage, boss.maxHp);
    return {
      ok: true,
      hp: Math.max(0, boss.maxHp - dealt),
      maxHp: boss.maxHp,
      dealt,
      slain: boss.slain,
      yourDamage: 0,
      applied: 0,
    };
  }

  const dmg = applied * BOSS_DMG_PER_CLICK;

  const updated = await prisma.boss.update({
    where: { id: boss.id },
    data: { dealtDamage: { increment: dmg } },
    select: { dealtDamage: true, slain: true },
  });

  let slain = updated.slain;
  if (!slain && updated.dealtDamage >= boss.maxHp) {
    const res = await prisma.boss.updateMany({
      where: { id: boss.id, slain: false },
      data: { slain: true, slainAt: new Date() },
    });
    slain = res.count > 0 || updated.dealtDamage >= boss.maxHp;
  }

  const mine = await prisma.bossHit.upsert({
    where: { bossId_discordId: { bossId: boss.id, discordId } },
    create: {
      bossId: boss.id,
      discordId,
      damage: dmg,
      clicks: applied,
      lastHitAt: new Date(now),
    },
    update: {
      damage: { increment: dmg },
      clicks: { increment: applied },
      lastHitAt: new Date(now),
    },
    select: { damage: true },
  });

  // let the shared snapshot refresh on its own cadence
  cache = null;

  const dealtClamped = Math.min(updated.dealtDamage, boss.maxHp);
  return {
    ok: true,
    hp: Math.max(0, boss.maxHp - dealtClamped),
    maxHp: boss.maxHp,
    dealt: dealtClamped,
    slain,
    yourDamage: Math.round(mine.damage * 10) / 10,
    applied,
  };
}

// --- resolution (bot-triggered, idempotent) ------------------------------

export type ResolveResult = {
  outcome: "slain" | "escaped" | "none" | "pending";
  weekOf?: string;
  participants: number;
  totalPaid: number;
  penaltyEach: number;
  rewardPool: number;
  top: { name: string; damage: number; payout: number }[];
  unsettled: number;
};

export async function resolveBoss(): Promise<ResolveResult> {
  const now = new Date();
  const boss = await prisma.boss.findFirst({
    where: {
      resolved: false,
      OR: [{ slain: true }, { expiresAt: { lte: now } }],
    },
    orderBy: { spawnsAt: "desc" },
  });

  if (!boss) {
    return {
      outcome: "none",
      participants: 0,
      totalPaid: 0,
      penaltyEach: BOSS_FAIL_PENALTY,
      rewardPool: BOSS_SLAY_REWARD,
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
    // Bounty banks like the daily rewards; the penalty comes off spendable
    // cash so nobody is pushed into "bank debt".
    let target: "bank" | "cash" = "bank";
    if (boss.slain) {
      // proportional share; the remainder goes to the top damager
      const base = Math.floor((BOSS_SLAY_REWARD * h.damage) / totalDamage);
      const isTop = allHits[0]?.id === h.id;
      const remainder = isTop
        ? BOSS_SLAY_REWARD -
          allHits.reduce(
            (a, x) => a + Math.floor((BOSS_SLAY_REWARD * x.damage) / totalDamage),
            0,
          )
        : 0;
      amount = base + remainder;
      reason = `${BOSS_NAME} slain — raid bounty`;
    } else {
      amount = -BOSS_FAIL_PENALTY;
      reason = `${BOSS_NAME} escaped — raid penalty`;
      target = "cash";
    }

    try {
      if (amount !== 0) await addCurrency(h.discordId, amount, reason, target);
      await prisma.bossHit.update({
        where: { id: h.id },
        data: { settled: true, payout: amount },
      });
      totalPaid += Math.abs(amount);
    } catch (err) {
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
    participants: allHits.length,
    totalPaid,
    penaltyEach: BOSS_FAIL_PENALTY,
    rewardPool: BOSS_SLAY_REWARD,
    top: allHits.slice(0, TOP_N).map((h) => ({
      name: nameById.get(h.discordId) ?? "A challenger",
      damage: Math.round(h.damage * 10) / 10,
      payout: h.settled ? h.payout : 0,
    })),
    unsettled,
  };
}
