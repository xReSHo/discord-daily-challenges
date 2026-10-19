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

/**
 * How long an answer is trusted before Discord is asked again. A flagged
 * account is re-checked often, so taking the role away frees it within
 * seconds; everyone else is re-checked every two minutes.
 */
const ALT_TTL_MS = 15_000;
const CLEAN_TTL_MS = 2 * 60_000;
/** After Discord failed to answer: let them through, and ask again soon. */
const RETRY_MS = 10_000;

const cache = new Map<string, { alt: boolean; until: number }>();
/** One question to Discord per player at a time: a page load fires many requests at once. */
const pending = new Map<string, Promise<boolean>>();

/**
 * Whether this Discord user carries an alt role. Fails open: if Discord can't
 * be reached, nobody is locked out on an old answer.
 */
export async function isAltAccount(discordId: string): Promise<boolean> {
  const hit = cache.get(discordId);
  if (hit && hit.until > Date.now()) return hit.alt;

  let ask = pending.get(discordId);
  if (!ask) {
    ask = lookup(discordId).finally(() => pending.delete(discordId));
    pending.set(discordId, ask);
  }
  return ask;
}

async function lookup(discordId: string): Promise<boolean> {
  const roles = await memberRoles(discordId);
  if (cache.size > 5000) cache.clear();
  if (roles === undefined) {
    cache.set(discordId, { alt: false, until: Date.now() + RETRY_MS });
    return false;
  }
  const alt = roles.some((r) => ALT_ROLE_IDS.includes(r));
  cache.set(discordId, { alt, until: Date.now() + (alt ? ALT_TTL_MS : CLEAN_TTL_MS) });
  return alt;
}
