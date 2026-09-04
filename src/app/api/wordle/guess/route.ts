import { auth } from "@/auth";
import { submitGuess } from "@/lib/wordle/game";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { sectionGuard } from "@/lib/section-status";

/** POST /api/wordle/guess  body: { guess: string } */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("wordle:guess", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const closed = await sectionGuard("wordle");
  if (closed) return closed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const guess = (body as { guess?: unknown })?.guess;
  const outcome = await submitGuess(discordId, guess);

  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 400 });
  }
  return Response.json({ view: outcome.view, reward: outcome.reward });
}
