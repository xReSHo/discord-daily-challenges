import { timingSafeEqual } from "node:crypto";
import { BOSS_RESOLVE_SECRET } from "@/lib/boss/config";
import { getBotProfile } from "@/lib/bot-profile";
import { logger } from "@/lib/logger";

/**
 * GET /api/bot/profile?discordId=… — one player's record for the Discord bot's
 * /profile card (cogs/profile.py). Same bearer secret as /api/bot/daily.
 * Read-only: it never spends a Streak Ward (see src/lib/bot-profile.ts).
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
  const discordId = new URL(request.url).searchParams.get("discordId") ?? "";
  if (!/^\d{15,22}$/.test(discordId)) {
    return Response.json({ error: "discordId must be a Discord user id" }, { status: 400 });
  }
  try {
    return Response.json(await getBotProfile(discordId));
  } catch (err) {
    logger.error("bot.profile_failed", { discordId, message: String(err) });
    return Response.json({ error: "profile failed" }, { status: 500 });
  }
}
