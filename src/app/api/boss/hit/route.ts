import { auth } from "@/auth";
import { applyHit } from "@/lib/boss/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** POST /api/boss/hit  body: { clicks: number } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("boss:hit", RATE_RULES.boss, discordId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await applyHit(discordId, (body as { clicks?: unknown })?.clicks);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
