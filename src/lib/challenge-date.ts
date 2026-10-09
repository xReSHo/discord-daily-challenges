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

/** Just the time of day in the challenge timezone, 12-hour clock: `2:06 PM`. */
export function formatChallengeClock(d: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHALLENGE_TZ,
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

/** How far the challenge timezone is ahead of UTC at `at`, in ms. */
function tzOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHALLENGE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant a `YYYY-MM-DD` challenge day begins (`end: false`) or ends
 * (`end: true`, its last millisecond). Returns null for anything that isn't a
 * real calendar date. Used for admin-entered "available from / until" days.
 */
export function challengeDayBoundary(day: string, end = false): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const guess = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(guess.getTime()) || guess.toISOString().slice(0, 10) !== day) return null;
  const start = guess.getTime() - tzOffsetMs(guess);
  return new Date(end ? start + 86_400_000 - 1 : start);
}

/**
 * The instant of a wall-clock `YYYY-MM-DDTHH:MM` in the challenge timezone —
 * what a `datetime-local` field sends. Null if it isn't a real date and time.
 */
export function challengeInstant(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const guess = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z`);
  if (Number.isNaN(guess.getTime())) return null;
  return new Date(guess.getTime() - tzOffsetMs(guess));
}
