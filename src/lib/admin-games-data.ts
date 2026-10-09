/**
 * What the Pit and Equipment tabs of /admin read, as named SQL fragments for
 * `loadAdminPage` (one round trip, together with the gate), and the functions
 * that turn the rows that come back into typed values.
 *
 * The numbers here are coins, so they are always read fresh — never cached.
 */

import { Prisma } from "@prisma/client";
import type { JsonRow } from "@/lib/admin-auth";
import {
  parseCrateSettings,
  parseDropSettings,
  parsePitSettings,
  type CrateSettings,
  type DropSettings,
  type PitSettings,
} from "@/lib/site-settings";

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const s = (v: unknown): string => (v == null ? "" : String(v));
const sOrNull = (v: unknown): string | null => (v == null ? null : String(v));

const nameOf = (idCol: Prisma.Sql) =>
  Prisma.sql`(SELECT u.name FROM "User" u WHERE u."discordId" = ${idCol} LIMIT 1)`;

// --- the pit ----------------------------------------------------------------

export function pitParts() {
  return {
    settings: Prisma.sql`SELECT value FROM "SiteSetting" WHERE key = 'pit'`,
    // The last 7 days. `house` is what the champion (the CPU) won or lost:
    // a lost duel keeps the stake, a won one pays the stake less the cut.
    week: Prisma.sql`
      SELECT
        count(*)::int AS duels,
        (count(*) FILTER (WHERE "opponentId" = 'cpu'))::int AS "cpuDuels",
        coalesce(sum(stake), 0)::float8 AS staked,
        coalesce(sum(rake) FILTER (WHERE "opponentId" <> 'cpu'), 0)::float8 AS rake,
        coalesce(sum(CASE
          WHEN "opponentId" = 'cpu' AND winner = 'opponent' THEN stake
          WHEN "opponentId" = 'cpu' AND winner = 'challenger' THEN stake - payout
          ELSE 0 END), 0)::float8 AS house,
        coalesce(max(stake), 0)::float8 AS biggest
      FROM "Duel"
      WHERE status = 'done' AND "resolvedAt" >= now() - interval '7 days'`,
    owed: Prisma.sql`
      SELECT count(*)::int AS n FROM "Duel"
      WHERE status = 'done' AND (NOT "paidC" OR NOT "paidO")`,
    waiting: Prisma.sql`
      SELECT d.id, d.status, d."challengerId", d.stake::float8 AS stake, d."createdAt",
        ${nameOf(Prisma.sql`d."challengerId"`)} AS name
      FROM "Duel" d
      WHERE d.status IN ('open', 'locked')
      ORDER BY d."createdAt" ASC
      LIMIT 50`,
    recent: Prisma.sql`
      SELECT d.id, d."challengerId", d."opponentId", d.stake::float8 AS stake, d.winner,
        d."scoreC", d."scoreO", d.payout::float8 AS payout, d.rake::float8 AS rake,
        d."paidC", d."paidO", d."resolvedAt",
        ${nameOf(Prisma.sql`d."challengerId"`)} AS "nameC",
        ${nameOf(Prisma.sql`d."opponentId"`)} AS "nameO"
      FROM "Duel" d
      WHERE d.status = 'done'
      ORDER BY d."resolvedAt" DESC NULLS LAST
      LIMIT 25`,
    top: Prisma.sql`
      SELECT r."discordId", r.mmr, r.peak, r.wins, r.losses, r.draws, r."cpuWins", r."cpuLosses",
        ${nameOf(Prisma.sql`r."discordId"`)} AS name
      FROM "DuelRating" r
      ORDER BY r.mmr DESC, r.wins DESC
      LIMIT 10`,
  };
}

export type PitAdminData = {
  settings: PitSettings;
  week: { duels: number; cpuDuels: number; staked: number; rake: number; house: number; biggest: number };
  owed: number;
  waiting: { id: string; status: string; challengerId: string; name: string | null; stake: number; createdAt: string }[];
  recent: {
    id: string;
    challengerId: string;
    opponentId: string | null;
    nameC: string | null;
    nameO: string | null;
    stake: number;
    winner: string | null;
    scoreC: number;
    scoreO: number;
    payout: number;
    rake: number;
    paid: boolean;
    resolvedAt: string;
  }[];
  top: {
    discordId: string;
    name: string | null;
    mmr: number;
    peak: number;
    wins: number;
    losses: number;
    draws: number;
    cpuWins: number;
    cpuLosses: number;
  }[];
};

export function readPitAdmin(data: Record<string, JsonRow[]>): PitAdminData {
  const w = data.week[0] ?? {};
  return {
    settings: parsePitSettings(data.settings[0]?.value ?? null),
    week: {
      duels: n(w.duels),
      cpuDuels: n(w.cpuDuels),
      staked: n(w.staked),
      rake: n(w.rake),
      house: n(w.house),
      biggest: n(w.biggest),
    },
    owed: n(data.owed[0]?.n),
    waiting: data.waiting.map((r) => ({
      id: s(r.id),
      status: s(r.status),
      challengerId: s(r.challengerId),
      name: sOrNull(r.name),
      stake: n(r.stake),
      createdAt: s(r.createdAt),
    })),
    recent: data.recent.map((r) => ({
      id: s(r.id),
      challengerId: s(r.challengerId),
      opponentId: sOrNull(r.opponentId),
      nameC: sOrNull(r.nameC),
      nameO: sOrNull(r.nameO),
      stake: n(r.stake),
      winner: sOrNull(r.winner),
      scoreC: n(r.scoreC),
      scoreO: n(r.scoreO),
      payout: n(r.payout),
      rake: n(r.rake),
      paid: r.paidC === true && r.paidO === true,
      resolvedAt: s(r.resolvedAt),
    })),
    top: data.top.map((r) => ({
      discordId: s(r.discordId),
      name: sOrNull(r.name),
      mmr: n(r.mmr),
      peak: n(r.peak),
      wins: n(r.wins),
      losses: n(r.losses),
      draws: n(r.draws),
      cpuWins: n(r.cpuWins),
      cpuLosses: n(r.cpuLosses),
    })),
  };
}

// --- equipment --------------------------------------------------------------

export function equipmentParts() {
  return {
    settings: Prisma.sql`SELECT value FROM "SiteSetting" WHERE key = 'drops'`,
    crate: Prisma.sql`SELECT value FROM "SiteSetting" WHERE key = 'crate'`,
    // Crates opened in the last 7 days: what was spent on them, and what came out.
    crateWeek: Prisma.sql`
      SELECT
        (SELECT count(*) FROM "Purchase"
          WHERE "itemId" = 'crate' AND status = 'fulfilled' AND "createdAt" >= now() - interval '7 days')::int AS opened,
        (SELECT coalesce(sum(price), 0) FROM "Purchase"
          WHERE "itemId" = 'crate' AND status = 'fulfilled' AND "createdAt" >= now() - interval '7 days')::float8 AS spent,
        (SELECT count(*) FROM "EquipmentDrop"
          WHERE source LIKE 'crate:%' AND NOT duplicate AND "createdAt" >= now() - interval '7 days')::int AS pieces,
        (SELECT coalesce(sum(coins), 0) FROM "EquipmentDrop"
          WHERE source LIKE 'crate:%' AND duplicate AND "createdAt" >= now() - interval '7 days')::float8 AS "paidBack"`,
    // The last 7 days of finds, split by where they came from.
    week: Prisma.sql`
      SELECT
        (count(*) FILTER (WHERE source LIKE 'trial:%'))::int AS trial,
        (count(*) FILTER (WHERE source LIKE 'boss:%'))::int AS boss,
        (count(*) FILTER (WHERE duplicate AND source NOT LIKE 'crate:%'))::int AS repeats,
        coalesce(sum(coins) FILTER (WHERE duplicate AND "coinsPaid" AND source NOT LIKE 'crate:%'), 0)::float8 AS "coinsPaid"
      FROM "EquipmentDrop"
      WHERE "createdAt" >= now() - interval '7 days'`,
    // Trials finished in the same 7 days: what the finds are a share of.
    trials: Prisma.sql`
      SELECT count(*)::int AS n FROM "Completion"
      WHERE rewarded AND "createdAt" >= now() - interval '7 days'`,
    owed: Prisma.sql`
      SELECT count(*)::int AS n, coalesce(sum(coins), 0)::float8 AS coins
      FROM "EquipmentDrop" WHERE duplicate AND NOT "coinsPaid" AND coins > 0`,
    owners: Prisma.sql`
      SELECT count(DISTINCT "discordId")::int AS players, count(*)::int AS pieces FROM "PlayerEquipment"`,
    recent: Prisma.sql`
      SELECT d.id, d."discordId", d.source, d."pieceId", d.duplicate, d.coins, d."coinsPaid", d."createdAt",
        ${nameOf(Prisma.sql`d."discordId"`)} AS name
      FROM "EquipmentDrop" d
      ORDER BY d."createdAt" DESC
      LIMIT 30`,
  };
}

export type EquipmentAdminData = {
  settings: DropSettings;
  crate: CrateSettings;
  crateWeek: { opened: number; spent: number; pieces: number; paidBack: number };
  week: { trial: number; boss: number; repeats: number; coinsPaid: number; trialsDone: number };
  owed: { n: number; coins: number };
  owners: { players: number; pieces: number };
  recent: {
    id: string;
    discordId: string;
    name: string | null;
    source: string;
    pieceId: string;
    duplicate: boolean;
    coins: number;
    coinsPaid: boolean;
    createdAt: string;
  }[];
};

export function readEquipmentAdmin(data: Record<string, JsonRow[]>): EquipmentAdminData {
  const w = data.week[0] ?? {};
  return {
    settings: parseDropSettings(data.settings[0]?.value ?? null),
    crate: parseCrateSettings(data.crate[0]?.value ?? null),
    crateWeek: {
      opened: n(data.crateWeek[0]?.opened),
      spent: n(data.crateWeek[0]?.spent),
      pieces: n(data.crateWeek[0]?.pieces),
      paidBack: n(data.crateWeek[0]?.paidBack),
    },
    week: {
      trial: n(w.trial),
      boss: n(w.boss),
      repeats: n(w.repeats),
      coinsPaid: n(w.coinsPaid),
      trialsDone: n(data.trials[0]?.n),
    },
    owed: { n: n(data.owed[0]?.n), coins: n(data.owed[0]?.coins) },
    owners: { players: n(data.owners[0]?.players), pieces: n(data.owners[0]?.pieces) },
    recent: data.recent.map((r) => ({
      id: s(r.id),
      discordId: s(r.discordId),
      name: sOrNull(r.name),
      source: s(r.source),
      pieceId: s(r.pieceId),
      duplicate: r.duplicate === true,
      coins: n(r.coins),
      coinsPaid: r.coinsPaid === true,
      createdAt: s(r.createdAt),
    })),
  };
}
