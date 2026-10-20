import { timingSafeEqual } from "node:crypto";
import { BOSS_RESOLVE_SECRET } from "@/lib/boss/config";
import { getStreakLeaderboard } from "@/lib/leaderboard";
import { logger } from "@/lib/logger";

/**
 * GET /api/bot/leaderboard — the top of the streak board for the Discord bot's
 * /leaderboard (cogs/leaderboard.py). Same bearer secret as /api/bot/daily.
 * Read-only, and served from the leaderboard's own cache.
 */
const TOP = 10;

function authorized(req: Request): boolean {
  if (!BOSS_RESOLVE_SECRET) return false;
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(provided);
  const b = Buffer.from(BOSS_RESOLVE_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await getStreakLeaderboard();
    return Response.json({
      rows: rows.slice(0, TOP).map((r) => ({
        discordId: r.discordId,
        name: r.name,
        current: r.current,
        longest: r.longest,
        trials: r.trials,
      })),
    });
  } catch (err) {
    logger.error("bot.leaderboard_failed", { message: String(err) });
    return Response.json({ error: "leaderboard failed" }, { status: 500 });
  }
}
