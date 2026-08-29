import { timingSafeEqual } from "node:crypto";
import { resolveBoss } from "@/lib/boss/game";
import { BOSS_RESOLVE_SECRET } from "@/lib/boss/config";
import { logger } from "@/lib/logger";

/**
 * POST /api/boss/resolve - pay out the bounty (on a slay) or the penalty (on a
 * timeout). Called by the Discord bot with `Authorization: Bearer <secret>`.
 * Idempotent and retry-safe: a second call is a no-op once every fighter is
 * settled, and retries any fighter whose UnbelievaBoat call failed.
 */
function authorized(req: Request): boolean {
  if (!BOSS_RESOLVE_SECRET) return false;
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(provided);
  const b = Buffer.from(BOSS_RESOLVE_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await resolveBoss();
    logger.info("boss.resolve", {
      outcome: result.outcome,
      participants: result.participants,
      unsettled: result.unsettled,
    });
    return Response.json(result);
  } catch (err) {
    logger.error("boss.resolve_error", { message: String(err) });
    return Response.json({ error: "resolve failed" }, { status: 500 });
  }
}
