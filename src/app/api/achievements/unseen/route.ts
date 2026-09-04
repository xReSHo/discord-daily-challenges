import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/** GET /api/achievements/unseen — achievement keys unlocked since the last
 *  time the popup showed them, oldest first. The client looks up name/icon/
 *  reward text for each key from the local catalog (src/lib/achievements/catalog.ts). */
export async function GET() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("achievements:unseen", RATE_RULES.read, discordId);
  if (limited) return limited;

  const rows = await prisma.achievement.findMany({
    where: { discordId, seenAt: null },
    orderBy: { unlockedAt: "asc" },
    take: 5,
    select: { key: true },
  });

  return Response.json({ keys: rows.map((r) => r.key) });
}
