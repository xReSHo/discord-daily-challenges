import { auth } from "@/auth";
import { startTest } from "@/lib/typing/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/typing/start - issue the daily paragraph + a signed start token. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("typing:start", RATE_RULES.start, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("typing");
  if (closed) return closed;

  return Response.json(await startTest(discordId));
}
