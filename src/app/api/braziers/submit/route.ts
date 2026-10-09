import { auth } from "@/auth";
import { submitBraziers } from "@/lib/braziers/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/braziers/submit  body: { token, touches: number[] } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("braziers:submit", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("braziers");
  if (closed) return closed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const result = await submitBraziers(discordId, { token: b.token, touches: b.touches });

  return Response.json(result, { status: result.ok ? 200 : 422 });
}
