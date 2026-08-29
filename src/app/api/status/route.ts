import { auth } from "@/auth";
import { getChallengeDateString } from "@/lib/challenge-date";
import { getCompletedSectionsToday } from "@/lib/completions";
import { SECTIONS, SECTION_IDS } from "@/lib/sections";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/**
 * GET /api/status
 * Returns which sections the logged-in user has completed today, plus the
 * reward for each. 401 if not logged in.
 */
export async function GET() {
  const session = await auth();
  const discordId = session?.user?.discordId;

  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("status", RATE_RULES.read, discordId);
  if (limited) return limited;

  const completed = await getCompletedSectionsToday(discordId);

  return Response.json({
    date: getChallengeDateString(),
    sections: SECTION_IDS.map((id) => ({
      id,
      label: SECTIONS[id].label,
      reward: SECTIONS[id].reward,
      completed: completed.has(id),
    })),
  });
}
