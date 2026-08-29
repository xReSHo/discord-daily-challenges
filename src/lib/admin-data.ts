/**
 * Read models for the /admin overview. All queries are capped and run
 * concurrently on the pool.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDate } from "@/lib/challenge-date";

const RECENT_LIMIT = 60;

export type AdminOverview = Awaited<ReturnType<typeof getAdminOverview>>;

export async function getAdminOverview() {
  const today = getChallengeDate();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    todayBySection,
    todayTotals,
    recentCompletions,
    recentFlags,
    flags7d,
    unpaidCompletions,
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
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
    }),
    prisma.suspiciousAttempt.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
    }),
    prisma.suspiciousAttempt.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.completion.count({ where: { rewarded: false } }),
  ]);

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
  };
}
