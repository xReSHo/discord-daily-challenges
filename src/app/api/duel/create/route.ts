import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { isDevMode } from "@/lib/dev-mode";
import { createDuel } from "@/lib/duel/game";
import { parseMoves } from "@/lib/duel/rules";

/** POST /api/duel/create  body: { stake, moves: "SGFSG", vs: "cpu" | "open" } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimit("duel:create", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const moves = parseMoves(body.moves);
  if (!moves) return Response.json({ error: "Choose all five moves." }, { status: 400 });
  const vs = body.vs === "cpu" ? "cpu" : body.vs === "open" ? "open" : null;
  if (!vs) return Response.json({ error: "Choose an opponent." }, { status: 400 });

  const out = await createDuel(discordId, { stake: body.stake, moves, vs }, { devMode: await isDevMode(discordId) });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.code });
  return Response.json(out);
}
