import { memberRoles } from "@/lib/discord";

/**
 * Discord roles that mark a known alt account. Players were told in the
 * server not to bring alts to the site: one person on three accounts clears
 * every trial three times over. A member holding one of these is turned away
 * from the whole site (see src/proxy.ts).
 */
export const ALT_ROLE_IDS = ["1552340727625687130"];

/** Set by the proxy on its rewrite, so /caught knows it was sent there, not typed in. */
export const CAUGHT_HEADER = "x-alt-caught";

/** How long an answer is trusted before Discord is asked again. */
const TTL_MS = 5 * 60_000;
/** After Discord failed to answer: try again soon, and let them through meanwhile. */
const RETRY_MS = 30_000;

const cache = new Map<string, { alt: boolean; until: number }>();

/**
 * Whether this Discord user carries an alt role. Fails open: if Discord can't
 * be reached, a real player must not be locked out of the site.
 */
export async function isAltAccount(discordId: string): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(discordId);
  if (hit && hit.until > now) return hit.alt;

  const roles = await memberRoles(discordId);
  if (roles === undefined) {
    cache.set(discordId, { alt: hit?.alt ?? false, until: now + RETRY_MS });
    return hit?.alt ?? false;
  }
  const alt = roles.some((r) => ALT_ROLE_IDS.includes(r));
  if (cache.size > 5000) cache.clear();
  cache.set(discordId, { alt, until: now + TTL_MS });
  return alt;
}
