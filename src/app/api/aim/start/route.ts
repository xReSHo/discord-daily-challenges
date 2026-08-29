import { auth } from "@/auth";
import { startRound } from "@/lib/aim/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** POST /api/aim/start - issue the daily target layout + a signed start token. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("aim:start", RATE_RULES.start, discordId);
  if (limited) return limited;

  return Response.json(await startRound(discordId));
}
