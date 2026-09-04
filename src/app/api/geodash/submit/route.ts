import { auth } from "@/auth";
import { submitCourse } from "@/lib/geodash/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/geodash/submit  body: { token, jumpTimes: number[], totalMs } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("geodash:submit", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("geodash");
  if (closed) return closed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const result = await submitCourse(discordId, {
    token: b.token,
    jumpTimes: b.jumpTimes,
    totalMs: b.totalMs,
  });

  // won / down / spent / rejected are all valid game outcomes (client reads the
  // JSON); only a malformed request is a 4xx-worthy error.
  const status = result.ok || result.outcome !== "error" ? 200 : 400;
  return Response.json(result, { status });
}
