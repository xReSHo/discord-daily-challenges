/**
 * The "which day is it" logic for the daily challenge system.
 *
 * A challenge day rolls over at midnight in CHALLENGE_TZ (default Asia/Bahrain,
 * UTC+3). We never compare raw timestamps for the daily lock -- we reduce the
 * current time to a calendar date in that timezone, then store it as a
 * `@db.Date` column (midnight UTC). Two requests on the same wall-clock day in
 * that timezone always resolve to the exact same `Date` value.
 */

const CHALLENGE_TZ = process.env.CHALLENGE_TZ || "Asia/Bahrain";

/** `YYYY-MM-DD` for the given instant (default: now) in the challenge timezone. */
export function getChallengeDateString(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly what we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHALLENGE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * The current challenge day as a `Date` at 00:00:00.000 UTC, suitable for
 * writing to / querying a Prisma `@db.Date` column.
 */
export function getChallengeDate(at: Date = new Date()): Date {
  return new Date(`${getChallengeDateString(at)}T00:00:00.000Z`);
}

/**
 * Short admin-log timestamp in the challenge timezone (Bahrain), 12-hour clock:
 * `Sep 4, 2:06 PM`. Every timestamp on /admin uses this.
 */
export function formatAdminTime(d: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHALLENGE_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(d));
}

/** Full-precision version for a cell's `title=` tooltip: `2026-09-04 14:06:32 (Asia/Bahrain)`. */
export function formatAdminTimeFull(d: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHALLENGE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(d))
    .replace(",", "");
  return `${parts} (${CHALLENGE_TZ})`;
}
