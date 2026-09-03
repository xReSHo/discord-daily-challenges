/**
 * The streak leaderboard: every player who has cleared every trial on some day
 * in the last 90 days, ranked by current streak (consecutive days completing
 * every trial). Reads `Completion` only — no extra tables.
 *
 * The whole board is built once and cached in-process for 5 minutes (same idea
 * as the boss `SharedSnapshot` cache), so a page view is usually zero queries.
 */

import { prisma } from "@/lib/prisma";
import { getChallengeDateString } from "@/lib/challenge-date";
import { streaksFromDays, perfectDays } from "@/lib/streak";
import { SECTION_IDS } from "@/lib/sections";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;
const CACHE_MS = 5 * 60_000;
const MAX_ROWS = 100;

export type LeaderRow = {
  rank: number;
  discordId: string;
  name: string;
  image: string | null;
  current: number;
  longest: number;
  trials: number;
  you: boolean;
};

type BaseRow = Omit<LeaderRow, "rank" | "you">;

let cache: { at: number; rows: BaseRow[] } | null = null;

async function build(): Promise<BaseRow[]> {
  const since = new Date(
    Date.parse(`${getChallengeDateString()}T00:00:00.000Z`) - WINDOW_DAYS * DAY_MS,
  );

  const rows = await prisma.completion.findMany({
    where: {
      rewarded: true,
      section: { in: [...SECTION_IDS] },
      date: { gte: since },
    },
    select: { discordId: true, date: true, section: true },
  });

  const byUser = new Map<string, { date: Date; section: string }[]>();
  for (const r of rows) {
    const arr = byUser.get(r.discordId) ?? [];
    arr.push({ date: r.date, section: r.section });
    byUser.set(r.discordId, arr);
  }

  const ids = [...byUser.keys()];
  if (ids.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { discordId: { in: ids } },
    select: { discordId: true, name: true, image: true },
  });
  const byId = new Map(users.map((u) => [u.discordId!, u]));

  const out: BaseRow[] = [];
  for (const id of ids) {
    const completions = byUser.get(id)!;
    const { current, longest } = streaksFromDays(perfectDays(completions));
    if (longest === 0) continue; // never cleared a full day — not on the board
    const u = byId.get(id);
    out.push({
      discordId: id,
      name: u?.name?.trim() || "Nameless",
      image: u?.image ?? null,
      current,
      longest,
      trials: completions.length,
    });
  }

  out.sort(
    (a, b) =>
      b.current - a.current || b.longest - a.longest || b.trials - a.trials,
  );
  return out.slice(0, MAX_ROWS);
}

export async function getStreakLeaderboard(
  viewerDiscordId?: string | null,
): Promise<LeaderRow[]> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), rows: await build() };
  }
  return cache.rows.map((r, i) => ({
    ...r,
    rank: i + 1,
    you: !!viewerDiscordId && r.discordId === viewerDiscordId,
  }));
}
