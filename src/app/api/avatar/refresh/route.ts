import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { currentAvatar } from "@/lib/discord";

/** Players already looked up recently, so one stale face costs one Discord call. */
const checked = new Map<string, number>();
const AGAIN_MS = 60 * 60 * 1000;

/**
 * POST /api/avatar/refresh  body: { image }
 *
 * A browser found that a player's picture no longer loads (they changed their
 * avatar, so the stored address is dead). Ask Discord for the current one,
 * store it, and hand it back. `image` must be the exact address on record, so
 * this can only ever repair a picture the site itself is showing.
 */
export async function POST(request: Request) {
  const session = await auth();
  const viewer = session?.user?.discordId;
  if (!viewer) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimit("avatar:refresh", RATE_RULES.mutate, viewer);
  if (limited) return limited;

  let image = "";
  try {
    const body = (await request.json()) as { image?: unknown };
    if (typeof body.image === "string") image = body.image;
  } catch {
    /* falls through to the check below */
  }
  const id = /^https:\/\/cdn\.discordapp\.com\/avatars\/(\d{5,25})\//.exec(image)?.[1];
  if (!id) return Response.json({ image: null });

  const user = await prisma.user.findFirst({
    where: { discordId: id },
    select: { id: true, image: true },
  });
  if (!user) return Response.json({ image: null });
  // someone else's browser already repaired it: just hand over the new one
  if (user.image !== image) return Response.json({ image: user.image });

  const last = checked.get(id) ?? 0;
  if (Date.now() - last < AGAIN_MS) return Response.json({ image: null });
  checked.set(id, Date.now());

  const fresh = await currentAvatar(id);
  if (fresh === undefined) return Response.json({ image: null });
  if (fresh !== user.image) {
    await prisma.user.update({ where: { id: user.id }, data: { image: fresh } });
  }
  return Response.json({ image: fresh === image ? null : fresh });
}
