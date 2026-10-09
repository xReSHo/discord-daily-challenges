/**
 * Read models for the /admin ledger.
 *
 * The database is a long way from the server and each instance holds a single
 * connection, so every query is a full round trip and they run one after
 * another. The ledger therefore never queries on its own: it describes what it
 * needs as SQL fragments ({@link ledgerParts}) and the page sends them, with
 * the admin check, as one statement (`loadAdminPage`). Only the open tab's
 * lists are asked for.
 *
 *   ledgerParts(tab, filters)   the fragments: every number on the page, the
 *                               game states, and the open tab's lists.
 *   readCounts / readActivity / readEconomy / readIntegrity / readHealth
 *                               turn the rows that come back into typed data.
 *
 * Player names are joined in the same statement, never looked up separately.
 * Every value from the search form reaches the database as a bound parameter.
 */

import { Prisma } from "@prisma/client";
import { asDate, asDateOrNull, type JsonRow } from "@/lib/admin-auth";
import { challengeDayBoundary, getChallengeDate } from "@/lib/challenge-date";

const RECENT_LIMIT = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type AdminFilters = {
  /** Matches a discordId substring, or a player by name. */
  q?: string;
  /** Inclusive start of the createdAt range, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive end of the createdAt range, `YYYY-MM-DD`. */
  to?: string;
};

export const LEDGER_TABS = ["activity", "economy", "integrity", "health"] as const;
export type LedgerTab = (typeof LEDGER_TABS)[number];

/** A row in the unified "Recent completions" log — games and boss raids alike. */
export type CompletionLogEntry = {
  id: string;
  discordId: string;
  name: string | null;
  section: string;
  createdAt: Date;
  rewardAmount: number;
  rewarded: boolean;
};

// --- filters → SQL ----------------------------------------------------------

/** `AND <col> BETWEEN from AND to` for whichever ends of the range are set.
 *  Anything that isn't a plain YYYY-MM-DD is ignored. */
function rangeSql(col: Prisma.Sql, filters: AdminFilters): Prisma.Sql {
  const out: Prisma.Sql[] = [];
  // Days are Bahrain days, like every time shown on the page.
  const from = filters.from && DAY.test(filters.from) ? challengeDayBoundary(filters.from) : null;
  const to = filters.to && DAY.test(filters.to) ? challengeDayBoundary(filters.to, true) : null;
  if (from) out.push(Prisma.sql`AND ${col} >= ${from}`);
  if (to) out.push(Prisma.sql`AND ${col} <= ${to}`);
  return out.length ? Prisma.join(out, " ") : Prisma.empty;
}

/** `AND (id contains q OR name contains q)`. Expects the `User` table joined
 *  as `u`. The text is a bound parameter with LIKE wildcards escaped. */
function userSql(idCol: Prisma.Sql, filters: AdminFilters): Prisma.Sql {
  const text = filters.q?.trim().slice(0, 100);
  if (!text) return Prisma.empty;
  const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  return Prisma.sql`AND (${idCol} LIKE ${like} OR u.name ILIKE ${like})`;
}

const joinUser = (idCol: Prisma.Sql) =>
  Prisma.sql`LEFT JOIN "User" u ON u."discordId" = ${idCol}`;

// --- the fragments ----------------------------------------------------------

export function ledgerParts(tab: LedgerTab, filters: AdminFilters): Record<string, Prisma.Sql> {
  const today = getChallengeDate();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const parts: Record<string, Prisma.Sql> = {
    counts: Prisma.sql`
      SELECT
        (SELECT count(*) FROM "Completion" WHERE date = ${today}::date AND rewarded) AS "completionsToday",
        (SELECT coalesce(sum("rewardAmount"), 0) FROM "Completion" WHERE date = ${today}::date AND rewarded) AS "paidOutToday",
        (SELECT count(*) FROM "SuspiciousAttempt" WHERE "createdAt" >= ${weekAgo}) AS "flags7d",
        (SELECT count(*) FROM "DailyAttempt" WHERE failed AND date = ${today}::date) AS "failuresToday",
        (SELECT count(*) FROM "GeoRun" WHERE status = 'rejected' AND date = ${today}::date) AS "geoReviewCount",
        (SELECT count(*) FROM "Purchase" WHERE status IN ('charging', 'refunded')) AS "purchasesUnfulfilled",
        (SELECT count(*) FROM "Completion" WHERE NOT rewarded) AS "unpaidCompletions",
        (SELECT count(*) FROM "Feedback" WHERE NOT delivered) AS "feedbackUndelivered",
        (SELECT count(*) FROM "Duel" WHERE status = 'done' AND (NOT "paidC" OR NOT "paidO")) AS "duelsOwed",
        (SELECT count(*) FROM "EquipmentDrop" WHERE duplicate AND NOT "coinsPaid" AND coins > 0) AS "dropsOwed"`,
    statuses: Prisma.sql`SELECT section, disabled, hidden FROM "SectionStatus"`,
  };

  if (tab === "activity") {
    parts.completions = Prisma.sql`
      SELECT c.id, c."discordId", u.name, c.section, c."createdAt", c."rewardAmount", c.rewarded
      FROM "Completion" c ${joinUser(Prisma.sql`c."discordId"`)}
      WHERE true ${rangeSql(Prisma.sql`c."createdAt"`, filters)} ${userSql(Prisma.sql`c."discordId"`, filters)}
      ORDER BY c."createdAt" DESC LIMIT ${RECENT_LIMIT}`;
    parts.bossHits = Prisma.sql`
      SELECT h.id, h."discordId", u.name, coalesce(b."resolvedAt", h."lastHitAt") AS "createdAt",
        h.payout AS "rewardAmount"
      FROM "BossHit" h JOIN "Boss" b ON b.id = h."bossId" ${joinUser(Prisma.sql`h."discordId"`)}
      WHERE h.settled ${rangeSql(Prisma.sql`b."resolvedAt"`, filters)} ${userSql(Prisma.sql`h."discordId"`, filters)}
      ORDER BY b."resolvedAt" DESC LIMIT ${RECENT_LIMIT}`;
    parts.todayBySection = Prisma.sql`
      SELECT section, count(*)::int AS count, coalesce(sum("rewardAmount"), 0)::int AS "paidOut"
      FROM "Completion" WHERE date = ${today}::date AND rewarded GROUP BY section`;
  } else if (tab === "economy") {
    parts.purchases = Prisma.sql`
      SELECT p.id, p."discordId", u.name, p."itemName", p.price, p.status, p."createdAt"
      FROM "Purchase" p ${joinUser(Prisma.sql`p."discordId"`)}
      WHERE true ${userSql(Prisma.sql`p."discordId"`, filters)}
      ORDER BY p."createdAt" DESC LIMIT ${RECENT_LIMIT}`;
    parts.geoRuns = Prisma.sql`
      SELECT g.id, g."discordId", u.name, g.difficulty, g.stake, g.payout, g."distancePct",
        g.status, g.deaths, g."feesPaid", g."resolvedAt", g."createdAt"
      FROM "GeoRun" g ${joinUser(Prisma.sql`g."discordId"`)}
      WHERE g.status IN ('won', 'lost', 'rejected', 'refunded') ${userSql(Prisma.sql`g."discordId"`, filters)}
      ORDER BY g."resolvedAt" DESC LIMIT ${RECENT_LIMIT}`;
  } else if (tab === "integrity") {
    parts.flags = Prisma.sql`
      SELECT f.id, f."discordId", u.name, f.section, f.reason, f.detail, f."createdAt"
      FROM "SuspiciousAttempt" f ${joinUser(Prisma.sql`f."discordId"`)}
      ORDER BY f."createdAt" DESC LIMIT ${RECENT_LIMIT}`;
    parts.failures = Prisma.sql`
      SELECT a.id, a."discordId", u.name, a.section, a.fails, a."updatedAt"
      FROM "DailyAttempt" a ${joinUser(Prisma.sql`a."discordId"`)}
      WHERE a.failed ${userSql(Prisma.sql`a."discordId"`, filters)}
      ORDER BY a."updatedAt" DESC LIMIT ${RECENT_LIMIT}`;
  } else {
    parts.feedback = Prisma.sql`
      SELECT f.id, f."discordId", u.name, f.kind, f.message, f.path, f.delivered, f."createdAt"
      FROM "Feedback" f ${joinUser(Prisma.sql`f."discordId"`)}
      ORDER BY f."createdAt" DESC LIMIT ${RECENT_LIMIT}`;
  }
  return parts;
}

// --- rows → data ------------------------------------------------------------

type Rows = Record<string, JsonRow[] | undefined>;

const str = (v: unknown) => String(v ?? "");
const num = (v: unknown) => Number(v ?? 0) || 0;
const nameOf = (v: unknown) => (typeof v === "string" ? v : null);
const who = (r: JsonRow) => ({ id: str(r.id), discordId: str(r.discordId), name: nameOf(r.name) });

export type AdminCounts = {
  completionsToday: number;
  paidOutToday: number;
  flags7d: number;
  failuresToday: number;
  geoReviewCount: number;
  purchasesUnfulfilled: number;
  unpaidCompletions: number;
  feedbackUndelivered: number;
  /** Decided duels with a payment that has not gone through. */
  duelsOwed: number;
  /** Repeat equipment finds whose coins have not gone through. */
  dropsOwed: number;
};

export function readCounts(rows: Rows): AdminCounts {
  const r = rows.counts?.[0] ?? {};
  return {
    completionsToday: num(r.completionsToday),
    paidOutToday: num(r.paidOutToday),
    flags7d: num(r.flags7d),
    failuresToday: num(r.failuresToday),
    geoReviewCount: num(r.geoReviewCount),
    purchasesUnfulfilled: num(r.purchasesUnfulfilled),
    unpaidCompletions: num(r.unpaidCompletions),
    feedbackUndelivered: num(r.feedbackUndelivered),
    duelsOwed: num(r.duelsOwed),
    dropsOwed: num(r.dropsOwed),
  };
}

/** How many games are closed or hidden right now. */
export function readGamesOffline(rows: Rows): number {
  return (rows.statuses ?? []).filter((s) => s.disabled === true || s.hidden === true).length;
}

export function readActivity(rows: Rows) {
  const recentCompletions: CompletionLogEntry[] = [
    ...(rows.completions ?? []).map((c) => ({
      ...who(c),
      section: str(c.section),
      createdAt: asDate(c.createdAt),
      rewardAmount: num(c.rewardAmount),
      rewarded: c.rewarded === true,
    })),
    ...(rows.bossHits ?? []).map((h) => ({
      ...who(h),
      section: "boss",
      createdAt: asDate(h.createdAt),
      rewardAmount: num(h.rewardAmount),
      rewarded: true,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, RECENT_LIMIT);

  return {
    recentCompletions,
    todayBySection: (rows.todayBySection ?? []).map((r) => ({
      section: str(r.section),
      count: num(r.count),
      paidOut: num(r.paidOut),
    })),
  };
}

export function readEconomy(rows: Rows) {
  return {
    recentPurchases: (rows.purchases ?? []).map((p) => ({
      ...who(p),
      itemName: str(p.itemName),
      price: num(p.price),
      status: str(p.status),
      createdAt: asDate(p.createdAt),
    })),
    recentGeoRuns: (rows.geoRuns ?? []).map((g) => ({
      ...who(g),
      difficulty: str(g.difficulty),
      stake: num(g.stake),
      payout: num(g.payout),
      distancePct: num(g.distancePct),
      status: str(g.status),
      deaths: num(g.deaths),
      feesPaid: num(g.feesPaid),
      resolvedAt: asDateOrNull(g.resolvedAt),
      createdAt: asDate(g.createdAt),
    })),
  };
}

export function readIntegrity(rows: Rows) {
  return {
    recentFlags: (rows.flags ?? []).map((f) => ({
      ...who(f),
      section: str(f.section),
      reason: str(f.reason),
      detail: f.detail,
      createdAt: asDate(f.createdAt),
    })),
    recentFailures: (rows.failures ?? []).map((f) => ({
      ...who(f),
      section: str(f.section),
      fails: num(f.fails),
      updatedAt: asDate(f.updatedAt),
    })),
  };
}

export function readHealth(rows: Rows) {
  return {
    recentFeedback: (rows.feedback ?? []).map((f) => ({
      ...who(f),
      kind: str(f.kind),
      message: str(f.message),
      path: str(f.path),
      delivered: f.delivered === true,
      createdAt: asDate(f.createdAt),
    })),
  };
}
