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

export function removeRole(userId: string, roleId: string, reason: string): Promise<RoleResult> {
  return roleCall("DELETE", userId, roleId, reason);
}

/** Whether the bot token + guild are configured (shop can grant on the site). */
export function discordConfigured(): boolean {
  return credentials() !== null;
}

/**
 * Where a Discord avatar lives. Asking for `.png` gives a still picture even
 * when the avatar is animated (a Nitro GIF), which is what the site shows:
 * small, and nothing moving in a list of faces.
 */
export function avatarUrl(userId: string, hash: string): string {
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=128`;
}

/**
 * A user's avatar as it is right now: its address, null if they have none,
 * or undefined if Discord couldn't be asked. Needs only the bot token.
 */
export async function currentAvatar(userId: string): Promise<string | null | undefined> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !/^\d{5,25}$/.test(userId)) return undefined;
  try {
    const res = await fetch(`${API}/users/${userId}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const user = (await res.json()) as { avatar?: string | null };
    return user.avatar ? avatarUrl(userId, user.avatar) : null;
  } catch {
    return undefined;
  }
}
