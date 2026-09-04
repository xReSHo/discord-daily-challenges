import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { startMini, submitMini, type MiniGame } from "@/lib/boss/mini";

async function gate(): Promise<
  { ok: true; discordId: string } | { ok: false; res: Response }
> {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return { ok: false, res: Response.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const limited = await rateLimit("boss:mini", RATE_RULES.start, discordId);
  if (limited) return { ok: false, res: limited };
  return { ok: true, discordId };
}

export async function miniStart(game: MiniGame): Promise<Response> {
  const g = await gate();
  if (!g.ok) return g.res;
  const result = await startMini(g.discordId, game);
  return Response.json(result, { status: result.ok ? 200 : 429 });
}

export async function miniSubmit(game: MiniGame, request: Request): Promise<Response> {
  const g = await gate();
  if (!g.ok) return g.res;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = await submitMini(g.discordId, game, body);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
