import { auth } from "@/auth";
import { startBraziers } from "@/lib/braziers/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/braziers/start - begin a run: the player's board + a signed start token. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("braziers:start", RATE_RULES.start, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("braziers");
  if (closed) return closed;

  return Response.json(await startBraziers(discordId));
}
