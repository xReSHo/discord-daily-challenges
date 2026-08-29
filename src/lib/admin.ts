/**
 * Who may see `/admin`. Set `ADMIN_DISCORD_IDS` to a comma-separated list of
 * Discord user ids (the same snowflakes the bot uses in `OWNER_IDS`).
 */

const ADMIN_IDS = new Set(
  (process.env.ADMIN_DISCORD_IDS ?? process.env.OWNER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function isAdmin(discordId: string | null | undefined): boolean {
  return typeof discordId === "string" && ADMIN_IDS.has(discordId);
}

export function adminCount(): number {
  return ADMIN_IDS.size;
}
