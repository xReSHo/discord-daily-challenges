import { auth } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { buildChatSystemPrompt } from "@/lib/chat/prompt";
import { streamChat, type ChatMessage } from "@/lib/chat/gemini";
import { recordChatIncident } from "@/lib/chat/incident";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TURNS = 12;
const MAX_CONTENT = 1500;

type IncomingMessage = { role: unknown; content: unknown };

function cleanHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw as IncomingMessage[]) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    const content = typeof m?.content === "string" ? m.content.trim().slice(0, MAX_CONTENT) : "";
    if (role && content) out.push({ role, content });
  }
  const trimmed = out.slice(-MAX_TURNS);
  while (trimmed.length && trimmed[trimmed.length - 1].role !== "user") trimmed.pop();
  return trimmed;
}

const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

/** POST /api/chat  body: { messages: {role, content}[] } → text/event-stream of {delta}|{done}|{error} */
export async function POST(request: Request) {
  const session = await auth();
  const discordId = session?.user?.discordId;
  if (!discordId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limited = await rateLimit("chat", RATE_RULES.chat, discordId);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const history = cleanHistory((body as { messages?: unknown })?.messages);
  if (history.length === 0) {
    return Response.json({ error: "Say something first." }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: buildChatSystemPrompt() },
    ...history,
  ];

  const start = await streamChat(messages);

  if (!start.ok) {
    logger.error("chat.upstream_failed", { reason: start.reason, detail: start.detail });
    void recordChatIncident({ discordId, reason: start.reason, detail: start.detail });
    return Response.json({ error: "assistant_unavailable" }, { status: 502 });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let chars = 0;
      try {
        const reader = start.stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chars += value.length;
            controller.enqueue(sse({ delta: value }));
          }
        }
        if (chars === 0) {
          logger.error("chat.upstream_failed", { reason: "empty" });
          void recordChatIncident({ discordId, reason: "empty" });
          controller.enqueue(sse({ error: "assistant_unavailable" }));
        } else {
          controller.enqueue(sse({ done: true }));
        }
      } catch (err) {
        logger.error("chat.stream_broke", { detail: String(err).slice(0, 300) });
        void recordChatIncident({ discordId, reason: "error", detail: String(err).slice(0, 300) });
        controller.enqueue(sse({ error: "assistant_unavailable" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
