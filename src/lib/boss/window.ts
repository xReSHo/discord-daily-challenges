/**
 * The recurring weekly spawn window, computed from the BossConfig schedule
 * (`spawnDow` / `spawnHour` / `despawnHour` / `despawnMin`) in CHALLENGE_TZ —
 * the same timezone the daily reset uses (see src/lib/challenge-date.ts).
 *
 * Pure time math, no DB. Pass the config in.
 */

import { getChallengeDateString } from "@/lib/challenge-date";
import type { BossConfig } from "./config";

const CHALLENGE_TZ = process.env.CHALLENGE_TZ || "Asia/Bahrain";

export type BossStatus = "upcoming" | "active" | "ended";

export type WeeklyWindow = {
  /** `YYYY-MM-DD` of the spawn day. */
  weekOf: string;
  spawnsAt: Date;
  expiresAt: Date;
  status: BossStatus;
  /** The next spawn instant, whatever the current status. */
  nextSpawnsAt: Date;
};

// --- tz helpers (format in tz, diff against UTC) ---

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
  const asUtc = Date.UTC(m.year, m.month - 1, m.day, m.hour % 24, m.minute, m.second);
  return asUtc - at.getTime();
}

/** The UTC instant for a wall-clock `YYYY-MM-DD` + h:m:s:ms in CHALLENGE_TZ. */
function zoned(dateStr: string, h: number, min = 0, s = 0, ms = 0): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, min, s, ms));
  return new Date(guess.getTime() - tzOffsetMs(guess, CHALLENGE_TZ));
}

function addDays(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

function dowOf(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function weeklyWindow(cfg: BossConfig, at: Date = new Date()): WeeklyWindow {
  const todayStr = getChallengeDateString(at);
  const dow = dowOf(todayStr);

  const spawnDayStr =
    dow === cfg.spawnDow
      ? todayStr
      : addDays(todayStr, -(((dow - cfg.spawnDow) + 7) % 7));

  const spawnsAt = zoned(spawnDayStr, cfg.spawnHour);
  const expiresAt = zoned(spawnDayStr, cfg.despawnHour, cfg.despawnMin, 59, 999);

  let status: BossStatus;
  if (at < spawnsAt) status = "upcoming";
  else if (at <= expiresAt) status = "active";
  else status = "ended";

  const nextSpawnsAt =
    status === "upcoming"
      ? spawnsAt
      : zoned(addDays(spawnDayStr, 7), cfg.spawnHour);

  return { weekOf: spawnDayStr, spawnsAt, expiresAt, status, nextSpawnsAt };
}
