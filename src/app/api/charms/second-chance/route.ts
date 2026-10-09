import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { spendSecondChance } from "@/lib/shop/charms";

/** POST /api/charms/second-chance — spend a Second Chance to reopen a trial
 *  lost today. Body: { section }. */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("charm:use", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let section = "";
  try {
    const body = (await request.json()) as { section?: unknown };
    if (typeof body.section === "string") section = body.section;
  } catch {
    // fall through to the empty check
  }
  if (!section) return Response.json({ error: "Missing section" }, { status: 400 });

  const result = await spendSecondChance(discordId, section);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.code });
  return Response.json({ ok: true, message: result.message });
}
