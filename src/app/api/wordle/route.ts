import { auth } from "@/auth";
import { getGameView } from "@/lib/wordle/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** GET /api/wordle - the logged-in user's board state for today. */
export async function GET() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("wordle:view", RATE_RULES.read, discordId);
  if (limited) return limited;

  return Response.json({ view: await getGameView(discordId) });
}
