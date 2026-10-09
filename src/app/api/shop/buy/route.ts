import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { isDevMode } from "@/lib/dev-mode";
import { buyWebsiteItem } from "@/lib/shop/purchase";
import { buyGear } from "@/lib/shop/inventory";
import { getGear } from "@/lib/shop/gear";
import { isAdmin } from "@/lib/admin";

/** POST /api/shop/buy — buy one shop item: a role, or a piece of gear for the
 *  pack. Body: { itemId }. */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("shop:buy", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let itemId = "";
  try {
    const body = (await request.json()) as { itemId?: unknown };
    if (typeof body.itemId === "string") itemId = body.itemId;
  } catch {
    // fall through to the empty-id check
  }
  if (!itemId) {
    return Response.json({ error: "Missing itemId" }, { status: 400 });
  }

  const devMode = await isDevMode(discordId);
  const gear = getGear(itemId);
  if (gear) {
    const bought = await buyGear(discordId, gear, { devMode, viewerIsAdmin: isAdmin(discordId) });
    if (!bought.ok) {
      return Response.json({ error: bought.error }, { status: bought.code });
    }
    return Response.json({ ok: true, newBalance: bought.newBalance, added: bought.added });
  }

  const result = await buyWebsiteItem(discordId, itemId, { devMode });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.code });
  }
  return Response.json({ ok: true, newBalance: result.newBalance });
}
