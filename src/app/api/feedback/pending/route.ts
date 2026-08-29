import { botAuthorized, pendingFeedback, markDelivered } from "@/lib/feedback";

/**
 * Bot-only. `GET` lists undelivered feedback; `POST { ids: [...] }` marks
 * them delivered. Both require `Authorization: Bearer <FEEDBACK_SECRET>`.
 */
export async function GET(request: Request) {
  if (!botAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await pendingFeedback();
  return Response.json({
    items: rows.map((r) => ({
      id: r.id,
      discordId: r.discordId,
      kind: r.kind,
      message: r.message,
      path: r.path,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

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
  const ids = (body as { ids?: unknown })?.ids;
  const count = await markDelivered(Array.isArray(ids) ? (ids as string[]) : []);
  return Response.json({ ok: true, marked: count });
}
