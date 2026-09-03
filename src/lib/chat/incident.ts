/**
 * Records assistant (Gemini) failures and alerts the owner over Discord DM.
 *
 * Every failure is stored (`ChatIncident`, visible on /admin). A DM is sent
 * only if none has gone out in the last CHAT_ALERT_THROTTLE_MIN minutes — an
 * outage should ping the owner once, not once per user message.
 *
 * The DM is sent from the site using the bot token it already holds (see
 * `dmUser` in src/lib/discord.ts), so it lands as a message from the bot even
 * when the bot process itself is down.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { dmUser } from "@/lib/discord";

const THROTTLE_MIN = Number(process.env.CHAT_ALERT_THROTTLE_MIN) || 10;

function alertUserId(): string | null {
  const explicit = process.env.CHAT_ALERT_DISCORD_ID?.trim();
  if (explicit) return explicit;
  const firstAdmin = (process.env.ADMIN_DISCORD_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return firstAdmin ?? null;
}

export async function recordChatIncident(input: {
  discordId: string;
  reason: string;
  detail?: string;
}): Promise<void> {
  let row;
  try {
    row = await prisma.chatIncident.create({
      data: {
        discordId: input.discordId,
        reason: input.reason,
        detail: input.detail?.slice(0, 1000) ?? null,
      },
    });
  } catch (err) {
    logger.error("chat.incident_store_failed", { message: String(err) });
    return;
  }

  const since = new Date(Date.now() - THROTTLE_MIN * 60_000);
  const recentlyNotified = await prisma.chatIncident
    .count({ where: { notified: true, createdAt: { gte: since } } })
    .catch(() => 1); // on error, assume we already alerted — don't risk a storm
  if (recentlyNotified > 0) return;

  const target = alertUserId();
  if (!target) {
    logger.warn("chat.incident_no_alert_target", { incidentId: row.id });
    return;
  }

  const res = await dmUser(target, {
    title: "⚠️ Daily Challenges — assistant is failing",
    description:
      `The website chatbot couldn't get a reply from the model.\n\n` +
      `**Reason:** \`${input.reason}\`\n` +
      (input.detail ? `**Detail:** ${input.detail.slice(0, 500)}\n` : "") +
      `**While chatting:** <@${input.discordId}>\n` +
      `**Incident:** \`${row.id}\`\n\n` +
      `Further failures in the next ${THROTTLE_MIN} min won't DM again. ` +
      `Check GEMINI_API_KEY / the Gemini free-tier quota.`,
  });

  if (res.ok) {
    await prisma.chatIncident
      .update({ where: { id: row.id }, data: { notified: true } })
      .catch(() => {});
  } else {
    logger.error("chat.incident_dm_failed", { incidentId: row.id, reason: res.reason });
  }
}
