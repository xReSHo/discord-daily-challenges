/**
 * Dev mode — an admin-only, per-browser switch that removes the once-a-day
 * cooldown so a new feature can be exercised on the same account repeatedly.
 *
 * State lives in an httpOnly cookie (`dc_dev_mode`). It is only ever honoured
 * for an admin (`isAdmin`), so a forged cookie on a normal account does
 * nothing. While it is on:
 *   - `getCompletedSectionsToday` reports nothing completed
 *   - `completeSection` is a no-op that neither records nor pays out
 *   - the per-route rate limiter is skipped for that admin
 *   - a finished Wordle board is cleared on the next page load
 *
 * Toggle it from the "Dev" button in the header (see DevModeToggle).
 */

import { cookies } from "next/headers";
import { isAdmin } from "@/lib/admin";

export const DEV_COOKIE = "dc_dev_mode";
/** Cookie lifetime — long enough to survive a testing session, not forever. */
export const DEV_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** True only for an admin who has switched dev mode on in this browser. */
export async function isDevMode(
  discordId: string | null | undefined,
): Promise<boolean> {
  if (!isAdmin(discordId)) return false;
  const store = await cookies();
  return store.get(DEV_COOKIE)?.value === "1";
}
