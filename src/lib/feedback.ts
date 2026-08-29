/**
 * Support widget backend.
 *
 * A submission is always stored (`Feedback` row, visible on /admin). Delivery
 * to the owner is then attempted two ways:
 *
 *   1. Discord webhook (`FEEDBACK_WEBHOOK_URL`) — posted with the reporter's
 *      name + avatar as the webhook identity, so in the owner's channel it
 *      reads as a message from that user. Marks the row delivered.
 *   2. Bot DM fallback — if no webhook is set (or it failed), the row stays
 *      `delivered = false`; `cogs/feedback.py` polls `/api/feedback/pending`
 *      and DMs the owner `<@discordId>` + the report, then calls
 *      `/api/feedback/delivered`.
 */

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type FeedbackKind = "bug" | "idea";

const WEBHOOK_URL = process.env.FEEDBACK_WEBHOOK_URL || "";
const SECRET = process.env.FEEDBACK_SECRET || "";
const MAX_LEN = 2000;
const MIN_LEN = 3;

export function botAuthorized(req: Request): boolean {
  if (!SECRET) return false;
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(provided);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeKind(v: unknown): FeedbackKind | null {
  return v === "bug" || v === "idea" ? v : null;
}

export type SubmitResult =
  | { ok: true; delivered: boolean }
  | { ok: false; error: string };

export async function submitFeedback(input: {
  discordId: string;
  name?: string | null;
  image?: string | null;
  kind: FeedbackKind;
  message: unknown;
  path: unknown;
}): Promise<SubmitResult> {
  const message = String(input.message ?? "").trim();
  if (message.length < MIN_LEN) {
    return { ok: false, error: "Add a little more detail." };
  }
  if (message.length > MAX_LEN) {
    return { ok: false, error: `Keep it under ${MAX_LEN} characters.` };
  }
  const path =
    typeof input.path === "string" && input.path.startsWith("/")
      ? input.path.slice(0, 200)
      : "/";

  const row = await prisma.feedback.create({
    data: { discordId: input.discordId, kind: input.kind, message, path },
  });

  const delivered = await deliverViaWebhook({
    id: row.id,
    discordId: input.discordId,
    name: input.name ?? "A challenger",
    image: input.image ?? null,
    kind: input.kind,
    message,
    path,
  });

  if (delivered) {
    await prisma.feedback
      .update({ where: { id: row.id }, data: { delivered: true } })
      .catch(() => {});
  }

  logger.info("feedback.submitted", {
    kind: input.kind,
    path,
    delivered,
    discordId: input.discordId,
  });
  return { ok: true, delivered };
}

async function deliverViaWebhook(f: {
  id: string;
  discordId: string;
  name: string;
  image: string | null;
  kind: FeedbackKind;
  message: string;
  path: string;
}): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        username: `${f.name} · ${f.kind === "bug" ? "bug report" : "suggestion"}`,
        avatar_url: f.image || undefined,
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: f.kind === "bug" ? "🐛 Bug report" : "💡 Suggestion",
            description: f.message,
            color: f.kind === "bug" ? 0xbd5a3c : 0xc8a24c,
            fields: [
              { name: "From", value: `<@${f.discordId}>`, inline: true },
              { name: "Page", value: `\`${f.path}\``, inline: true },
            ],
            footer: { text: `feedback ${f.id}` },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    if (!res.ok) {
      logger.warn("feedback.webhook_failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.error("feedback.webhook_error", { message: String(err) });
    return false;
  }
}

/** Undelivered rows for the bot DM fallback. */
export async function pendingFeedback(limit = 20) {
  return prisma.feedback.findMany({
    where: { delivered: false },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function markDelivered(ids: string[]): Promise<number> {
  const clean = ids.filter((s) => typeof s === "string").slice(0, 100);
  if (clean.length === 0) return 0;
  const res = await prisma.feedback.updateMany({
    where: { id: { in: clean } },
    data: { delivered: true },
  });
  return res.count;
}
