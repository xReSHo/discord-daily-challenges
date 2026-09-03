/**
 * Minimal Gemini call — the site talks to Google's OpenAI-compatible endpoint
 * directly with `fetch` (same endpoint the Discord bot uses), so there is no
 * npm dependency to add. Mirrors the "minimal REST" style of `src/lib/discord.ts`.
 *
 * The assistant streams: `streamChat` returns a text stream so the UI can show
 * the answer as it is generated instead of waiting for the whole thing.
 *
 * Env (shared names with the bot's .env):
 *   GEMINI_API_KEY    required — no key, no assistant
 *   GEMINI_MODEL      default "gemini-flash-lite-latest" — the low-latency model,
 *                     a good fit for scoped Q&A grounded in a doc. Set it to
 *                     "gemini-flash-latest" for a stronger (slower) model.
 *   GEMINI_BASE_URL   default Google's v1beta OpenAI-compatible base
 */

const BASE_URL =
  process.env.GEMINI_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta/openai/";
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const CONNECT_TIMEOUT_MS = 12_000;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type FailReason = "unconfigured" | "timeout" | "upstream" | "empty" | "error";

export type StreamStart =
  | { ok: true; stream: ReadableStream<string> }
  | { ok: false; reason: FailReason; detail?: string };

/**
 * Opens a streaming completion. The returned promise settles as soon as the
 * upstream *responds* (fast — a few hundred ms), not when generation finishes,
 * so the caller can start piping tokens immediately. A retry only happens
 * before any bytes are streamed.
 */
export async function streamChat(messages: ChatMessage[]): Promise<StreamStart> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "unconfigured" };

  const url = `${BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const payload = JSON.stringify({
    model: MODEL,
    messages,
    temperature: 0.3,
    stream: true,
  });

  let lastErr: { reason: FailReason; detail: string } = {
    reason: "error",
    detail: "no response",
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500));

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: payload,
        // only guards the initial connect; the stream itself can run longer
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "TimeoutError";
      lastErr = { reason: isAbort ? "timeout" : "error", detail: String(err).slice(0, 300) };
      if (isAbort) break;
      continue;
    }

    if (res.ok && res.body) {
      return { ok: true, stream: parseSSE(res.body) };
    }

    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    lastErr = { reason: "upstream", detail: `HTTP ${res.status} ${detail}` };
    if (res.status !== 429 && res.status !== 503 && res.status < 500) break;
  }

  return { ok: false, ...lastErr };
}

/** Turn Gemini's `text/event-stream` body into a stream of content deltas. */
function parseSSE(body: ReadableStream<Uint8Array>): ReadableStream<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<string>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          const line = evt
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            controller.close();
            return;
          }
          try {
            const json = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
            };
            const piece = json.choices?.[0]?.delta?.content;
            if (piece) controller.enqueue(piece);
          } catch {
            /* skip keep-alives / partial frames */
          }
        }
      }
    },
    cancel() {
      void reader.cancel();
    },
  });
}
