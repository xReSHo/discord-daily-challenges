import { auth } from "@/auth";
import { getBossState } from "@/lib/boss/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/**
 * GET /api/boss - current boss state. Works logged out (shared fields only);
 * `yourDamage` / `yourPayout` are filled in when authenticated. The Discord
 * bot polls this too.
 */
export async function GET() {
  const limited = await rateLimit("boss:view", RATE_RULES.boss);
  if (limited) return limited;

  const session = await auth();
  return Response.json(await getBossState(session?.user?.discordId));
}
