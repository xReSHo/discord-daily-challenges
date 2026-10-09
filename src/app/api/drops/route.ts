import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { getDropSettings } from "@/lib/site-settings";
import { gearLines } from "@/lib/equipment";
import { getGear } from "@/lib/equipment-effects";

/** GET /api/drops - the live equipment drop chances, and what the caller's own
 *  equipment adds, for the "Spoils" panel. */
export async function GET() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimit("drops:view", RATE_RULES.read, discordId);
  if (limited) return limited;

  const [drops, gear] = await Promise.all([getDropSettings(), getGear(discordId)]);
  return Response.json({ ...drops, gear: gearLines(gear), luck: gear.luck });
}
