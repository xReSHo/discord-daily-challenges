import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { spendWordleInsight } from "@/lib/shop/charms";

/** POST /api/wordle/insight — spend a Wordle Insight: one letter of today's
 *  word, in its place. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("charm:use", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const result = await spendWordleInsight(discordId);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.code });
  return Response.json({ ok: true, hint: result.hint, left: result.left });
}
