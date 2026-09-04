import { auth } from "@/auth";
import { submitRound } from "@/lib/aim/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/aim/submit  body: { token, hits: [{ i, x, y, t }] } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("aim:submit", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("aim");
  if (closed) return closed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const result = await submitRound(discordId, { token: b.token, hits: b.hits });

  return Response.json(result, { status: result.ok ? 200 : 422 });
}
