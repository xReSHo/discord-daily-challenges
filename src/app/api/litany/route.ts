import { auth } from "@/auth";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** GET /api/litany - whether the user has finished today's rite. */
export async function GET() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("litany:view", RATE_RULES.read, discordId);
  if (limited) return limited;

  const completed = await getCompletedSectionsToday(discordId);
  return Response.json({
    date: getChallengeDateString(),
    completed: completed.has("litany"),
  });
}
