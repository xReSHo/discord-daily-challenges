import { getAdminState, logAdmin } from "@/lib/admin-auth";
import { despawnBoss } from "@/lib/boss/game";

/** POST /api/boss/despawn — admin only. Removes the currently live boss (deletes
 *  a manual test boss, force-resolves the weekly one). For quick test cycles. */
export async function POST() {
  const state = await getAdminState();
  if (state.kind !== "ok") {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
  await logAdmin(state.discordId, "boss.despawn_live");
  const done = await despawnBoss();
  return Response.json({ ok: done });
}
