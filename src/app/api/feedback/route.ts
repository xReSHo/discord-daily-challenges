import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { normalizeKind, submitFeedback } from "@/lib/feedback";

/**
 * POST /api/feedback  body: { kind: "bug" | "idea", message: string, path?: string }
 *
 * The website-facing report path. It is surfaced only by the chat widget's
 * support fallback (shown when the assistant can't answer). Reports from the
 * Discord `/report` command come in via `/api/feedback/intake` instead.
 */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("feedback", RATE_RULES.mutate, discordId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const kind = normalizeKind(b.kind);
  if (!kind) {
    return Response.json({ error: "Pick a category." }, { status: 400 });
  }

  const path =
    typeof b.path === "string" && b.path.startsWith("/") ? b.path : "chat";

  const result = await submitFeedback({
    discordId,
    name: session?.user?.name,
    image: session?.user?.image,
    kind,
    message: b.message,
    path,
  });

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, delivered: result.delivered });
}
