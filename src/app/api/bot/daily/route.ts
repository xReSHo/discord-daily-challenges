import { timingSafeEqual } from "node:crypto";
import { BOSS_RESOLVE_SECRET } from "@/lib/boss/config";
import { getBotDigest } from "@/lib/bot-digest";
import { logger } from "@/lib/logger";

/**
 * GET /api/bot/daily — today's trials, yesterday's recap and the streaks that
 * end at midnight, for the Discord bot's daily posts (cogs/daily_nudges.py).
 * The bot calls it twice a day with `Authorization: Bearer <secret>`, the same
 * secret it uses to settle raids.
 */
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
    return Response.json(await getBotDigest());
  } catch (err) {
    logger.error("bot.daily_failed", { message: String(err) });
    return Response.json({ error: "digest failed" }, { status: 500 });
  }
}
