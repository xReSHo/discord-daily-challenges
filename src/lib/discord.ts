/**
 * Minimal Discord REST calls the site makes directly — currently just adding /
 * removing a guild role (for shop purchases). Uses a bot token; the bot must be
 * in the guild with Manage Roles and a top role above anything it grants.
 */

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 6000;

function credentials(): { token: string; guildId: string } | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID || process.env.UNBELIEVABOAT_GUILD_ID;
  return token && guildId ? { token, guildId } : null;
}

export type RoleResult = { ok: true } | { ok: false; reason: string };

async function roleCall(
  method: "PUT" | "DELETE",
  userId: string,
  roleId: string,
  reason: string,
): Promise<RoleResult> {
  const c = credentials();
  if (!c) return { ok: false, reason: "Discord bot token is not configured" };

  let res: Response;
  try {
    res = await fetch(`${API}/guilds/${c.guildId}/members/${userId}/roles/${roleId}`, {
      method,
      headers: {
        Authorization: `Bot ${c.token}`,
        "X-Audit-Log-Reason": reason.slice(0, 400),
        "Content-Length": "0",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: `Discord request failed: ${String(err)}` };
  }

  // 204 No Content on success; PUT is idempotent (204 if the member already
  // had the role). 429 could be retried, but at shop volume it won't happen.
  if (res.status === 204 || res.status === 201) return { ok: true };

  let detail = "";
  try {
    detail = (await res.text()).slice(0, 160);
  } catch {
    /* ignore */
  }
  const hint =
    res.status === 404
      ? "the buyer isn't in the server (or the role was deleted)"
      : res.status === 403
        ? "the bot lacks Manage Roles or the role is above the bot"
        : detail || res.statusText;
  return { ok: false, reason: `Discord ${res.status}: ${hint}` };
}

export function grantRole(userId: string, roleId: string, reason: string): Promise<RoleResult> {
  return roleCall("PUT", userId, roleId, reason);
}

/**
 * DM a user as the bot — opens (or reuses) the 1:1 channel, then posts one
 * embed. Used to alert the owner when the site assistant's model call fails.
 * Only needs the bot token (not a guild), so it works even if `DISCORD_GUILD_ID`
 * is unset.
 */
export async function dmUser(
  userId: string,
  msg: { title: string; description: string },
): Promise<RoleResult> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, reason: "Discord bot token is not configured" };

  const headers = {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };

  try {
    const dm = await fetch(`${API}/users/@me/channels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ recipient_id: userId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!dm.ok) {
      return { ok: false, reason: `Discord ${dm.status}: could not open a DM channel` };
    }
    const channel = (await dm.json()) as { id?: string };
    if (!channel.id) return { ok: false, reason: "Discord: DM channel had no id" };

    const sent = await fetch(`${API}/channels/${channel.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        embeds: [
          {
            title: msg.title.slice(0, 250),
            description: msg.description.slice(0, 4000),
            color: 0xbd5a3c,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!sent.ok) {
      return { ok: false, reason: `Discord ${sent.status}: message not delivered` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `Discord request failed: ${String(err)}` };
  }
}

export function removeRole(userId: string, roleId: string, reason: string): Promise<RoleResult> {
  return roleCall("DELETE", userId, roleId, reason);
}

/** Whether the bot token + guild are configured (shop can grant on the site). */
export function discordConfigured(): boolean {
  return credentials() !== null;
}
