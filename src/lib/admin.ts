/**
 * Who may see `/admin`.
 *
 * Set `ADMIN_DISCORD_IDS` to a comma-separated list of Discord user ids (the
 * same snowflakes the bot uses in `OWNER_IDS`). Read at call time, not module
 * load, so it can't be captured before the env is ready.
 */

function adminIds(): Set<string> {
  const raw = process.env.ADMIN_DISCORD_IDS ?? process.env.OWNER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      // tolerate quotes and a trailing "# comment" on the value
      .map((s) => (s.trim().replace(/^["']/, "").match(/\d{5,}/) ?? [""])[0])
      .filter(Boolean),
  );
}

export function isAdmin(discordId: string | null | undefined): boolean {
  if (typeof discordId !== "string") return false;
  return adminIds().has(discordId.trim());
}

export function adminCount(): number {
  return adminIds().size;
}
