/**
 * When the weekly boss is around.
 *
 * Veyrath spawns every Saturday at 16:00 and despawns at 23:59:59 in
 * CHALLENGE_TZ (the same timezone the daily reset uses — see
 * `src/lib/challenge-date.ts`). All four boundary values are env-tunable.
 *
 * Pure time math, no DB.
 */

import { getChallengeDateString } from "@/lib/challenge-date";

const CHALLENGE_TZ = process.env.CHALLENGE_TZ || "Asia/Bahrain";

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** 0 = Sunday … 6 = Saturday (matches Date.getUTCDay). */
const SPAWN_DOW = intEnv("BOSS_SPAWN_DOW", 6, 0, 6);
const SPAWN_HOUR = intEnv("BOSS_SPAWN_HOUR", 16, 0, 23);
const DESPAWN_HOUR = intEnv("BOSS_DESPAWN_HOUR", 23, 0, 23);
const DESPAWN_MIN = intEnv("BOSS_DESPAWN_MIN", 59, 0, 59);

export type BossStatus = "upcoming" | "active" | "ended";

export type BossWindow = {
  /** `YYYY-MM-DD` of the spawn day — the unique key for the Boss row. */
  weekOf: string;
  spawnsAt: Date;
  expiresAt: Date;
  status: BossStatus;
  /** For countdown display — the next spawn instant, whatever the status. */
  nextSpawnsAt: Date;
};

// --- tz helpers (the standard "format in tz, diff against UTC" trick) ---

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
  const asUtc = Date.UTC(
    m.year,
    m.month - 1,
    m.day,
    m.hour % 24,
    m.minute,
    m.second,
  );
  return asUtc - at.getTime();
}

/** The UTC instant for a wall-clock `YYYY-MM-DD` + h:m:s:ms in CHALLENGE_TZ. */
function zoned(
  dateStr: string,
  h: number,
  min = 0,
  s = 0,
  ms = 0,
): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, min, s, ms));
  return new Date(guess.getTime() - tzOffsetMs(guess, CHALLENGE_TZ));
}

function addDays(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Day of week (0=Sun..6=Sat) for a `YYYY-MM-DD` string. */
function dowOf(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function getBossWindow(at: Date = new Date()): BossWindow {
  const todayStr = getChallengeDateString(at);
  const dow = dowOf(todayStr);

  const spawnDayStr =
    dow === SPAWN_DOW
      ? todayStr
      : addDays(todayStr, -(((dow - SPAWN_DOW) + 7) % 7));

  const spawnsAt = zoned(spawnDayStr, SPAWN_HOUR);
  const expiresAt = zoned(spawnDayStr, DESPAWN_HOUR, DESPAWN_MIN, 59, 999);

  let status: BossStatus;
  if (at < spawnsAt) status = "upcoming";
  else if (at <= expiresAt) status = "active";
  else status = "ended";

  const nextSpawnsAt =
    status === "upcoming" ? spawnsAt : zoned(addDays(spawnDayStr, 7), SPAWN_HOUR);

  return { weekOf: spawnDayStr, spawnsAt, expiresAt, status, nextSpawnsAt };
}
