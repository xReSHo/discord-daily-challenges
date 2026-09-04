import { auth } from "@/auth";
import { submitLitany } from "@/lib/litany/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/litany/submit  body: { token, taps: number[], tapTimes: number[] } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("litany:submit", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("litany");
  if (closed) return closed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const result = await submitLitany(discordId, {
    token: b.token,
    taps: b.taps,
    tapTimes: b.tapTimes,
  });

  return Response.json(result, { status: result.ok ? 200 : 422 });
}
