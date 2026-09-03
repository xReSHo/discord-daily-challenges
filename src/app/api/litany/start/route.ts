import { auth } from "@/auth";
import { startLitany } from "@/lib/litany/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** POST /api/litany/start - issue today's glyph sequence + a signed start token. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("litany:start", RATE_RULES.start, discordId);
  if (limited) return limited;

  return Response.json(await startLitany(discordId));
}
