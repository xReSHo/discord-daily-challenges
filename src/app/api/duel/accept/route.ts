import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { isDevMode } from "@/lib/dev-mode";
import { acceptDuel } from "@/lib/duel/game";
import { parseMoves } from "@/lib/duel/rules";

/** POST /api/duel/accept  body: { id, moves: "SGFSG" } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimit("duel:accept", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const moves = parseMoves(body.moves);
  if (!moves) return Response.json({ error: "Choose all five moves." }, { status: 400 });
  if (typeof body.id !== "string" || !body.id) {
    return Response.json({ error: "Missing challenge." }, { status: 400 });
  }

  const out = await acceptDuel(discordId, body.id, moves, { devMode: await isDevMode(discordId) });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.code });
  return Response.json(out);
}
