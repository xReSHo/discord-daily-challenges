import { auth } from "@/auth";
import { spendInRaid } from "@/lib/boss/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** POST /api/boss/use — use one piece of gear from the pack in the live raid.
 *  body: { item } — a consumable's id, or "war-horn". */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("boss:use", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let item = "";
  try {
    const body = (await request.json()) as { item?: unknown };
    if (typeof body.item === "string") item = body.item;
  } catch {
    // fall through to the empty-id check
  }
  if (!item) return Response.json({ error: "Missing item" }, { status: 400 });

  const result = await spendInRaid(discordId, item);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
