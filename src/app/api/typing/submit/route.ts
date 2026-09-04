import { auth } from "@/auth";
import { submitTest } from "@/lib/typing/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/typing/submit  body: { token, typed, durationMs, keystrokes } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("typing:submit", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("typing");
  if (closed) return closed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const result = await submitTest(discordId, {
    token: b.token,
    typed: b.typed,
    durationMs: b.durationMs,
    keystrokes: b.keystrokes,
    strikes: b.strikes,
  });

  return Response.json(result, { status: result.ok ? 200 : 422 });
}
