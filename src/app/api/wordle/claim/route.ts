import { auth } from "@/auth";
import { claimReward } from "@/lib/wordle/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/wordle/claim - retry the payout for a won-but-unrewarded game. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("wordle:claim", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("wordle");
  if (closed) return closed;

  const outcome = await claimReward(discordId);
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 400 });
  }
  return Response.json({ view: outcome.view, reward: outcome.reward });
}
