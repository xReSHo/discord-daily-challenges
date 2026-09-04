import { auth } from "@/auth";
import { startLitany } from "@/lib/litany/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/litany/start - issue today's glyph sequence + a signed start token. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("litany:start", RATE_RULES.start, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("litany");
  if (closed) return closed;

  return Response.json(await startLitany(discordId));
}
