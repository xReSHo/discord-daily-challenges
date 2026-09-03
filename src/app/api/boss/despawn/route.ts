import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { despawnBoss } from "@/lib/boss/game";

/** POST /api/boss/despawn — admin only. Removes the currently live boss (deletes
 *  a manual test boss, force-resolves the weekly one). For quick test cycles. */
export async function POST() {
  const session = await auth();
  if (!isAdmin(session?.user?.discordId)) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
  const done = await despawnBoss();
  return Response.json({ ok: done });
}
