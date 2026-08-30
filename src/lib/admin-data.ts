/**
 * Read models for the /admin overview. All queries are capped and run
 * concurrently on the pool.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";

const RECENT_LIMIT = 60;

export type AdminFilters = {
  /** Matches a discordId substring, or a completion's user by name. */
  q?: string;
  /** Inclusive start of the createdAt range, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive end of the createdAt range, `YYYY-MM-DD`. */
  to?: string;
};

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

export type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>;

function dateRange(filters: AdminFilters): { gte?: Date; lte?: Date } | undefined {
  if (!filters.from && !filters.to) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (filters.from) range.gte = new Date(`${filters.from}T00:00:00.000Z`);
  if (filters.to) range.lte = new Date(`${filters.to}T23:59:59.999Z`);
  return range;
}

/** discordIds whose User.name matches the search text, so `q` can match either field. */
async function matchingNameIds(q: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { name: { contains: q, mode: "insensitive" }, discordId: { not: null } },
    select: { discordId: true },
  });
  return users.map((u) => u.discordId!).filter(Boolean);
}

export async function getAdminOverview(filters: AdminFilters = {}) {
  const today = getChallengeDate();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const createdAtRange = dateRange(filters);
  const q = filters.q?.trim() || "";
  const nameIds = q ? await matchingNameIds(q) : [];

  const userOr = q
    ? [{ discordId: { contains: q } }, ...(nameIds.length ? [{ discordId: { in: nameIds } }] : [])]
    : undefined;

  const [
    todayBySection,
    todayTotals,
    recentCompletionsRaw,
    recentBossHitsRaw,
    recentFlags,
    flags7d,
    unpaidCompletions,
    recentFeedback,
    feedbackUndelivered,
  ] = await Promise.all([
    prisma.completion.groupBy({
      by: ["section"],
      where: { date: today, rewarded: true },
      _count: { _all: true },
      _sum: { rewardAmount: true },
    }),
    prisma.completion.aggregate({
      where: { date: today, rewarded: true },
      _count: { _all: true },
      _sum: { rewardAmount: true },
    }),
    prisma.completion.findMany({
      where: {
        ...(createdAtRange ? { createdAt: createdAtRange } : {}),
        ...(userOr ? { OR: userOr } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
    }),
    prisma.bossHit.findMany({
      where: {
        settled: true,
        ...(userOr ? { OR: userOr } : {}),
        boss: createdAtRange ? { resolvedAt: createdAtRange } : undefined,
      },
      orderBy: { boss: { resolvedAt: "desc" } },
      take: RECENT_LIMIT,
      include: { boss: { select: { resolvedAt: true } } },
    }),
    prisma.suspiciousAttempt.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
    }),
    prisma.suspiciousAttempt.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.completion.count({ where: { rewarded: false } }),
    prisma.feedback.findMany({ orderBy: { createdAt: "desc" }, take: RECENT_LIMIT }),
    prisma.feedback.count({ where: { delivered: false } }),
  ]);

  const merged: CompletionLogEntry[] = [
    ...recentCompletionsRaw.map((c) => ({
      id: c.id,
      discordId: c.discordId,
      name: null,
      section: c.section,
      createdAt: c.createdAt,
      rewardAmount: c.rewardAmount,
      rewarded: c.rewarded,
    })),
    ...recentBossHitsRaw.map((h) => ({
      id: h.id,
      discordId: h.discordId,
      name: null,
      section: "boss",
      createdAt: h.boss.resolvedAt ?? h.lastHitAt,
      rewardAmount: h.payout,
      rewarded: h.settled,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, RECENT_LIMIT);

  const namedIds = [...new Set(merged.map((e) => e.discordId))];
  const names = namedIds.length
    ? await prisma.user.findMany({
        where: { discordId: { in: namedIds } },
        select: { discordId: true, name: true },
      })
    : [];
  const nameById = new Map(names.map((u) => [u.discordId, u.name]));
  const recentCompletions = merged.map((e) => ({
    ...e,
    name: nameById.get(e.discordId) ?? null,
  }));

  return {
    todayBySection: todayBySection.map((r) => ({
      section: r.section,
      count: r._count._all,
      paidOut: r._sum.rewardAmount ?? 0,
    })),
    todayTotals: {
      count: todayTotals._count._all,
      paidOut: todayTotals._sum.rewardAmount ?? 0,
    },
    recentCompletions,
    recentFlags,
    flags7d,
    unpaidCompletions,
    recentFeedback,
    feedbackUndelivered,
  };
}
