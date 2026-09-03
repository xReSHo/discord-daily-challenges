import { botAuthorized, normalizeKind, submitFeedback } from "@/lib/feedback";

/**
 * Bot-only. The Discord bot's `/report` command POSTs a bug/suggestion here.
 * Requires `Authorization: Bearer <FEEDBACK_SECRET>`.
 *
 * Body: { discordId, name?, kind: "bug" | "idea", message, deliveredByBot?: boolean }
 */
export async function POST(request: Request) {
  if (!botAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const discordId = typeof b.discordId === "string" ? b.discordId.trim() : "";
  if (!discordId) {
    return Response.json({ error: "discordId is required" }, { status: 400 });
  }

  const kind = normalizeKind(b.kind);
  if (!kind) {
    return Response.json({ error: "kind must be 'bug' or 'idea'" }, { status: 400 });
  }

  const result = await submitFeedback({
    discordId,
    name: typeof b.name === "string" ? b.name : null,
    kind,
    message: b.message,
    path: "discord",
    deliveredByBot: b.deliveredByBot === true,
  });

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, delivered: result.delivered });
}
