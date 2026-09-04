import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** POST /api/achievements/seen  body: { keys: string[] }
 *  Marks achievements as having shown their unlock popup, so a reload never
 *  re-shows them. */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("achievements:seen", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { keys?: unknown })?.keys;
  const keys = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
  if (keys.length === 0) {
    return Response.json({ ok: true });
  }

  await prisma.achievement.updateMany({
    where: { discordId, key: { in: keys }, seenAt: null },
    data: { seenAt: new Date() },
  });

  return Response.json({ ok: true });
}
