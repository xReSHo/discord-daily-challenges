import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { cancelDuel } from "@/lib/duel/game";

/** POST /api/duel/cancel  body: { id } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimit("duel:cancel", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) {
    return Response.json({ error: "Missing challenge." }, { status: 400 });
  }

  const out = await cancelDuel(discordId, body.id);
  if (!out.ok) return Response.json({ error: out.error }, { status: out.code });
  return Response.json(out);
}
