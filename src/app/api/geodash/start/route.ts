import { auth } from "@/auth";
import { startCourse } from "@/lib/geodash/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** POST /api/geodash/start  body: { difficulty, stake? } — charges the entry
 *  and issues today's course + a signed run token. */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // `mutate`, not `start`: free restarts are legitimate rapid retries, and the
  // coin fee itself is the real limiter on fresh entries / re-pays.
  const limited = await rateLimit("geodash:start", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const result = await startCourse(discordId, { difficulty: b.difficulty, stake: b.stake });

  if (result.ok) return Response.json(result);

  const status =
    result.error === "insufficient"
      ? 402
      : result.error === "already_played"
        ? 409
        : result.error === "unavailable"
          ? 502
          : 400;
  return Response.json(result, { status });
}
