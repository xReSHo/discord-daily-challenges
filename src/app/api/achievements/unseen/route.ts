import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { rewardLine, type AchievementToast } from "@/lib/achievements/catalog";
import { getAllAchievementDefs } from "@/lib/achievements/store";
import { catchUpAchievements } from "@/lib/achievements/engine";
import { isDevMode } from "@/lib/dev-mode";
import { unseenDrops } from "@/lib/equipment-drops";

/** GET /api/achievements/unseen — achievements unlocked since the last time
 *  the popup showed them, oldest first, with the name/icon/reward text the
 *  toast needs (the list is admin-editable, so the client can't look it up
 *  from a bundled catalog). Equipment found since then rides along as
 *  `drops`, so the popup costs one request, not two. The first call from a
 *  player also runs the catch-up check (see `catchUpAchievements`). */
export async function GET() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("achievements:unseen", RATE_RULES.read, discordId);
  if (limited) return limited;

  // The first page a player loads also settles anything they are owed: an
  // achievement they earned but never got, or a reward that failed to arrive.
  if (!(await isDevMode(discordId))) await catchUpAchievements(discordId);

  const [rows, drops] = await Promise.all([
    prisma.achievement.findMany({
      where: { discordId, seenAt: null },
      orderBy: { unlockedAt: "asc" },
      take: 5,
      select: { key: true },
    }),
    unseenDrops(discordId),
  ]);
  if (rows.length === 0) return Response.json({ unseen: [], drops });

  const defs = new Map((await getAllAchievementDefs()).map((d) => [d.key, d]));
  const unseen: AchievementToast[] = [];
  for (const { key } of rows) {
    const def = defs.get(key);
    if (def) {
      unseen.push({
        key,
        name: def.name,
        icon: def.icon,
        rewardText: rewardLine(def.reward),
      });
    }
  }

  return Response.json({ unseen, drops });
}
