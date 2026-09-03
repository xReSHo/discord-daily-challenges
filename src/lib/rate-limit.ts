/**
 * Per-route rate limiting.
 *
 * The store is a fixed-window counter in Postgres (see the `RateLimit` model),
 * so a limit is enforced consistently even when the app runs as many
 * short-lived serverless functions (Netlify / Vercel) with no shared memory.
 * One `upsert` per request is the whole cost.
 *
 * A process-local cache remembers keys already known to be over their limit
 * for the current window and short-circuits them without a DB round trip. It
 * only ever caches *denials*, so a stale entry can never wrongly allow a call.
 *
 * If the store itself errors, we fail OPEN — a limiter outage must not take
 * the entire API down.
 */

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isDevMode } from "@/lib/dev-mode";
import { logger } from "@/lib/logger";

export type RateRule = {
  limit: number;
  windowMs: number;
  /** Skip the Postgres counter — use a per-instance sliding window only.
   *  For very chatty endpoints where the DB write would itself be the load
   *  and a real abuse cap already lives elsewhere (e.g. the boss CPS clamp). */
  memoryOnly?: boolean;
};

const MINUTE = 60_000;

function ruleFromEnv(
  envName: string,
  fallbackLimit: number,
  extra: Partial<RateRule> = {},
): RateRule {
  const n = Number(process.env[envName]);
  return {
    limit: Number.isFinite(n) && n > 0 ? Math.floor(n) : fallbackLimit,
    windowMs: MINUTE,
    ...extra,
  };
}

/** Ceilings are per client per minute. Override any of them via env. */
export const RATE_RULES = {
  /** GET status/board polling. */
  read: ruleFromEnv("RATE_LIMIT_READ", 60),
  /** Guess / submit / claim / mark-complete — anything that can pay out. */
  mutate: ruleFromEnv("RATE_LIMIT_MUTATE", 20),
  /** Starting a fresh timed round. */
  start: ruleFromEnv("RATE_LIMIT_START", 12),
  /** Assistant chat turns — each one is a model call, so keep it modest. */
  chat: ruleFromEnv("RATE_LIMIT_CHAT", 15),
  /** The NextAuth endpoints (sign in / callback / session). */
  auth: ruleFromEnv("RATE_LIMIT_AUTH", 20),
  /** Boss arena — very chatty; the real abuse cap is the server CPS clamp,
   *  so this is an in-memory backstop only (no DB write per request). */
  boss: ruleFromEnv("RATE_LIMIT_BOSS", 90, { memoryOnly: true }),
} as const;

const denyUntil = new Map<string, number>();

// memoryOnly rules: a plain per-instance sliding window, no persistence.
const memHits = new Map<string, number[]>();
function consumeMemory(key: string, rule: RateRule): RateResult {
  const now = Date.now();
  const cutoff = now - rule.windowMs;
  const arr = (memHits.get(key) ?? []).filter((t) => t > cutoff);
  arr.push(now);
  memHits.set(key, arr);
  if (memHits.size > 5000) {
    for (const [k, v] of memHits) if (!v.length || v[v.length - 1] < cutoff) memHits.delete(k);
  }
  if (arr.length > rule.limit) {
    return { ok: false, retryAfterSec: Math.ceil((arr[0] + rule.windowMs - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-nf-client-connection-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

export type RateResult = { ok: boolean; retryAfterSec: number };

/** Increment the counter for `key` and report whether it is still within `rule`. */
export async function consume(key: string, rule: RateRule): Promise<RateResult> {
  if (rule.memoryOnly) return consumeMemory(key, rule);

  const now = Date.now();

  const blockedUntil = denyUntil.get(key);
  if (blockedUntil !== undefined) {
    if (blockedUntil > now) {
      return { ok: false, retryAfterSec: Math.ceil((blockedUntil - now) / 1000) };
    }
    denyUntil.delete(key);
  }

  const windowStartMs = Math.floor(now / rule.windowMs) * rule.windowMs;
  const resetMs = windowStartMs + rule.windowMs;
  const id = `${key}@${windowStartMs}`;

  let count: number;
  try {
    const row = await prisma.rateLimit.upsert({
      where: { id },
      create: { id, key, windowStart: new Date(windowStartMs), count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    count = row.count;
  } catch (err) {
    logger.error("rate_limit.store_error", { key, message: String(err) });
    return { ok: true, retryAfterSec: 0 }; // fail open
  }

  // ~2% of calls also sweep windows that closed a while ago.
  if (Math.random() < 0.02) {
    prisma.rateLimit
      .deleteMany({ where: { windowStart: { lt: new Date(now - rule.windowMs * 5) } } })
      .catch(() => {});
  }

  if (count > rule.limit) {
    denyUntil.set(key, resetMs);
    return { ok: false, retryAfterSec: Math.ceil((resetMs - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Check a limit for the current caller. Keyed by Discord id when available,
 * otherwise by client IP. Use this from Server Actions where you need the
 * raw result rather than an HTTP response.
 */
export async function checkLimit(
  scope: string,
  rule: RateRule,
  identifier?: string | null,
): Promise<RateResult> {
  // Admins with dev mode on aren't rate limited — rapid replay is the point.
  if (typeof identifier === "string" && (await isDevMode(identifier))) {
    return { ok: true, retryAfterSec: 0 };
  }
  const key = `${scope}:${identifier ?? (await clientIp())}`;
  const result = await consume(key, rule);
  if (!result.ok) logger.warn("rate_limit.blocked", { scope });
  return result;
}

/**
 * Enforce a limit at the top of a Route Handler. Returns a ready-to-return
 * `429` `Response` when the caller is over the limit, or `null` to continue.
 *
 *   const limited = await rateLimit("wordle:guess", RATE_RULES.mutate, discordId);
 *   if (limited) return limited;
 */
export async function rateLimit(
  scope: string,
  rule: RateRule,
  identifier?: string | null,
): Promise<Response | null> {
  const { ok, retryAfterSec } = await checkLimit(scope, rule, identifier);
  if (ok) return null;
  return Response.json(
    { error: "Too many requests — slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
