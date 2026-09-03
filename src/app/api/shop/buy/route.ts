import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { isDevMode } from "@/lib/dev-mode";
import { buyWebsiteItem } from "@/lib/shop/purchase";

/** POST /api/shop/buy — buy one website shop item. Body: { itemId }. */
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

  const result = await buyWebsiteItem(discordId, itemId, {
    devMode: await isDevMode(discordId),
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.code });
  }
  return Response.json({ ok: true, newBalance: result.newBalance });
}
