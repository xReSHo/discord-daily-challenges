import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { isDevMode } from "@/lib/dev-mode";
import { openCrate } from "@/lib/crate-open";

/** POST /api/crate/open - buy and open one crate. */
export async function POST() {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const limited = await rateLimit("crate:open", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  const out = await openCrate(discordId, { devMode: await isDevMode(discordId) });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.code });
  return Response.json(out);
}
