import { auth } from "@/auth";
import { startTest } from "@/lib/typing/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** POST /api/typing/start - issue the daily paragraph + a signed start token. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("typing:start", RATE_RULES.start, discordId);
  if (limited) return limited;

  return Response.json(await startTest(discordId));
}
