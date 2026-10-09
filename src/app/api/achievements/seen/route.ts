import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { markDropsSeen } from "@/lib/equipment-drops";

/** POST /api/achievements/seen  body: { keys?: string[], drops?: string[] }
 *  Marks achievements (by key) and equipment finds (by id) as having shown
 *  their popup, so a reload never re-shows them. */
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
  const rawDrops = (body as { drops?: unknown })?.drops;
  const drops = Array.isArray(rawDrops)
    ? rawDrops.filter((k): k is string => typeof k === "string")
    : [];
  await markDropsSeen(discordId, drops);
  if (keys.length === 0) {
    return Response.json({ ok: true });
  }

  await prisma.achievement.updateMany({
    where: { discordId, key: { in: keys }, seenAt: null },
    data: { seenAt: new Date() },
  });

  return Response.json({ ok: true });
}
