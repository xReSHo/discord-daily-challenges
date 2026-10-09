/**
 * Admin access — three things must all hold before /admin does anything:
 *
 *   1. Signed in with Discord, and that Discord id is on ADMIN_DISCORD_IDS.
 *   2. This admin has enrolled a password + authenticator app (`AdminCredential`).
 *   3. This browser holds a fresh "unlock" cookie, issued only after the
 *      password AND a current 6-digit code were both entered correctly.
 *
 * So a stolen Discord session alone opens nothing. The unlock cookie is
 * httpOnly, SameSite=Strict, HMAC-signed and bound to the credential's
 * `sessionNonce` (rotate it to lock every open session at once).
 *
 * How long an unlock lasts is the admin's choice at the unlock screen:
 *
 *   - "Trust this browser" (the default): ADMIN_TRUST_DAYS, 30 unless set.
 *     Both factors are proved once on that browser and not asked for again
 *     until the trust runs out, the admin locks it, or every browser is locked.
 *     The cookie also carries a coarse fingerprint of the browser it was
 *     issued to, so a copy carried to a different kind of browser is refused.
 *   - Otherwise: ADMIN_SESSION_MINUTES, 60 unless set — for a machine that
 *     isn't the admin's own.
 *
 * Pages call {@link requireAdminPage}; server actions and route handlers call
 * {@link requireAdminAction}. Every state change is written to `AdminAudit`.
 */

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { clientIp, consume } from "@/lib/rate-limit";
import { signToken, verifyToken } from "@/lib/session-token";
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  newTotpSecret,
  safeEqual,
  seal,
  unseal,
  verifyPassword,
  verifyTotp,
} from "@/lib/admin-crypto";

const UNLOCK_COOKIE = "dc_admin";
const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60_000;
const ENROL_TICKET_MS = 15 * 60_000;
const ATTEMPT_RULE = { limit: 10, windowMs: 60_000 };

function sessionMs(): number {
  const n = Number(process.env.ADMIN_SESSION_MINUTES);
  return (Number.isFinite(n) && n >= 5 && n <= 720 ? n : 60) * 60_000;
}

function trustMs(): number {
  const n = Number(process.env.ADMIN_TRUST_DAYS);
  return (Number.isFinite(n) && n >= 1 && n <= 90 ? n : 30) * 86_400_000;
}

/** How many days "Trust this browser" lasts — for the unlock screen. */
export function trustDays(): number {
  return Math.round(trustMs() / 86_400_000);
}

/**
 * A coarse fingerprint of the calling browser: its user-agent with every
 * version number taken out, so it survives browser updates but not a move to
 * another browser or operating system. Not a secret and not proof of anything
 * on its own — only one more thing a lifted cookie has to match.
 */
async function browserMark(): Promise<string> {
  const ua = (await headers()).get("user-agent") ?? "";
  return createHash("sha256")
    .update(ua.replace(/[\d._]+/g, "").slice(0, 400))
    .digest("base64url")
    .slice(0, 16);
}

function masterSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

// --- audit ------------------------------------------------------------------

/** Append one row to the admin audit trail. Never throws. */
export async function logAdmin(
  discordId: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  logger.warn("admin.action", { discordId, action, ...detail });
  try {
    await prisma.adminAudit.create({
      data: {
        discordId,
        action,
        detail: detail as Prisma.InputJsonValue,
        ip: await clientIp().catch(() => null),
      },
    });
  } catch (err) {
    logger.error("admin.audit_write_failed", { action, message: String(err) });
  }
}

// --- state ------------------------------------------------------------------

export type AdminState =
  /** Not signed in, or not on the allowlist. */
  | { kind: "none"; discordId: string | null }
  /** Allowlisted, but no password/authenticator set up yet. */
  | { kind: "unenrolled"; discordId: string }
  /** Enrolled, but this browser has no valid unlock. */
  | { kind: "locked"; discordId: string }
  | { kind: "ok"; discordId: string; expiresAt: number; trusted: boolean };

type UnlockToken = {
  k: string;
  sub: string;
  n: string;
  exp: number;
  /** Set on a trusted-browser unlock: the browser it was issued to. */
  ua?: string;
};

/**
 * The credential's session nonce, remembered briefly per server instance so
 * moving between admin pages doesn't cost a database round trip each time.
 * Only page *views* may use it; every write re-reads the database (see
 * {@link requireAdminAction}). The worst case is that "Lock every browser"
 * takes up to NONCE_TTL_MS to reach a page view served by another instance —
 * and that browser still can't change anything.
 */
const NONCE_TTL_MS = 20_000;
const nonceCache = new Map<string, { at: number; nonce: string }>();

async function sessionNonce(discordId: string, fresh: boolean): Promise<string | null> {
  if (!fresh) {
    const hit = nonceCache.get(discordId);
    if (hit && Date.now() - hit.at < NONCE_TTL_MS) return hit.nonce;
  }
  const cred = await prisma.adminCredential.findUnique({
    where: { discordId },
    select: { sessionNonce: true },
  });
  if (!cred) {
    nonceCache.delete(discordId);
    return null;
  }
  nonceCache.set(discordId, { at: Date.now(), nonce: cred.sessionNonce });
  return cred.sessionNonce;
}

/**
 * Everything about the caller that can be checked without the database: who
 * they are on Discord, whether that id is allowlisted, and whether this browser
 * carries an unlock cookie that is correctly signed, theirs and unexpired.
 * It does NOT prove the unlock is still valid — only comparing the token's
 * nonce with the database does (see {@link nonceMatches}).
 */
const readCaller = cache(
  async (): Promise<{ discordId: string | null; allowed: boolean; token: UnlockToken | null }> => {
    const session = await auth();
    const discordId = session?.user?.discordId ?? null;
    if (!discordId || !isAdmin(discordId)) return { discordId, allowed: false, token: null };

    const raw = (await cookies()).get(UNLOCK_COOKIE)?.value;
    const token = raw ? verifyToken<UnlockToken>(raw) : null;
    const good =
      token &&
      token.k === "admin" &&
      token.sub === discordId &&
      typeof token.exp === "number" &&
      token.exp > Date.now() &&
      typeof token.n === "string" &&
      (token.ua === undefined || safeEqual(String(token.ua), await browserMark()));
    return { discordId, allowed: true, token: good ? token : null };
  },
);

function nonceMatches(token: UnlockToken, nonce: string): boolean {
  return safeEqual(token.n, nonce);
}

async function resolveAdminState(fresh: boolean): Promise<AdminState> {
  const { discordId, allowed, token } = await readCaller();
  if (!discordId || !allowed) return { kind: "none", discordId };

  const nonce = await sessionNonce(discordId, fresh);
  if (nonce == null) return { kind: "unenrolled", discordId };

  if (token && nonceMatches(token, nonce)) {
    return { kind: "ok", discordId, expiresAt: token.exp, trusted: token.ua !== undefined };
  }
  return { kind: "locked", discordId };
}

/** Admin state read straight from the database. Used by everything that
 *  writes, and by the unlock / setup flow. Deduped within one request. */
export const getAdminState = cache((): Promise<AdminState> => resolveAdminState(true));

/** Admin state for rendering a page — may reuse the briefly cached nonce.
 *  Deduped within one request, so a layout and its page share one check. */
const getAdminStateForView = cache((): Promise<AdminState> => resolveAdminState(false));

/** Gate for an admin *page*. 404 for outsiders (no hint the page exists);
 *  admins who still owe a step are sent to it. */
export async function requireAdminPage(): Promise<{
  discordId: string;
  expiresAt: number;
  trusted: boolean;
}> {
  const state = await getAdminStateForView();
  if (state.kind === "none") {
    logger.warn("admin.access_denied", { discordId: state.discordId });
    notFound();
  }
  if (state.kind === "unenrolled") redirect("/admin/setup");
  if (state.kind === "locked") redirect("/admin/unlock");
  return { discordId: state.discordId, expiresAt: state.expiresAt, trusted: state.trusted };
}

/**
 * What the panel layout needs to draw the frame (tabs + session countdown).
 * No database: outsiders get a 404, and a browser without a well-formed unlock
 * is sent on by the full gate. The frame holds nothing but tab names, and it is
 * never the security gate — every page under it runs {@link loadAdminPage} or
 * {@link requireAdminPage}, and every write runs {@link requireAdminAction}.
 */
export async function requireAdminFrame(): Promise<{ expiresAt: number; trusted: boolean }> {
  const { discordId, allowed, token } = await readCaller();
  if (!discordId || !allowed) {
    logger.warn("admin.access_denied", { discordId });
    notFound();
  }
  if (!token) return requireAdminPage();
  return { expiresAt: token.exp, trusted: token.ua !== undefined };
}

/** Rows of one part of an admin page query, as plain JSON (dates are ISO
 *  strings — see {@link asDate}). */
export type JsonRow = Record<string, unknown>;

/**
 * Gate for an admin page **and** its data, in a single database round trip.
 *
 * The database is far from the server and each instance holds one connection,
 * so every query costs a full round trip and they queue behind each other. A
 * page therefore hands all its reads here as named SQL fragments; they are sent
 * as one statement together with the lookup of this admin's session nonce.
 *
 * Nothing is returned unless the gate passes: the nonce comes back in the same
 * row and is compared before the data leaves this function. Unlike
 * {@link requireAdminPage} this never uses the cached nonce, so "Lock every
 * browser" reaches these pages at once.
 */
export async function loadAdminPage<T extends Record<string, Prisma.Sql>>(
  parts: T,
): Promise<{
  discordId: string;
  expiresAt: number;
  trusted: boolean;
  data: { [K in keyof T]: JsonRow[] };
}> {
  const { discordId, allowed, token } = await readCaller();
  if (!discordId || !allowed) {
    logger.warn("admin.access_denied", { discordId });
    notFound();
  }
  // No usable unlock cookie: the full gate works out where to send them.
  if (!token) {
    await requireAdminPage();
    redirect("/admin/unlock");
  }

  const keys = Object.keys(parts) as (keyof T & string)[];
  // Column aliases are positional (p0, p1, …) — never built from a key.
  const cols = keys.map(
    (k, i) =>
      Prisma.sql`(SELECT coalesce(json_agg(t), '[]'::json) FROM (${parts[k]}) t) AS ${Prisma.raw(`"p${i}"`)}`,
  );
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT
      (SELECT "sessionNonce" FROM "AdminCredential" WHERE "discordId" = ${discordId}) AS "nonce"
      ${cols.length ? Prisma.sql`, ${Prisma.join(cols)}` : Prisma.empty}
  `;
  const row = rows[0] ?? {};

  const nonce = typeof row.nonce === "string" ? row.nonce : null;
  if (nonce == null) {
    nonceCache.delete(discordId);
    redirect("/admin/setup");
  }
  nonceCache.set(discordId, { at: Date.now(), nonce });
  if (!nonceMatches(token, nonce)) redirect("/admin/unlock");

  const data = {} as { [K in keyof T]: JsonRow[] };
  keys.forEach((k, i) => {
    const v = row[`p${i}`];
    data[k] = Array.isArray(v) ? (v as JsonRow[]) : [];
  });
  return { discordId, expiresAt: token.exp, trusted: token.ua !== undefined, data };
}

/** A timestamp from a {@link loadAdminPage} row. Postgres prints `timestamp`
 *  columns without a zone; they are stored in UTC. */
export function asDate(v: unknown): Date {
  if (v instanceof Date) return v;
  const s = String(v);
  if (s.length === 10) return new Date(s); // a `date` column: YYYY-MM-DD
  return new Date(/[zZ]|[+-]\d\d(:?\d\d)?$/.test(s) ? s : `${s}Z`);
}

/** Like {@link asDate}, for nullable columns. */
export function asDateOrNull(v: unknown): Date | null {
  return v == null ? null : asDate(v);
}

/** Gate for an admin *server action / route handler*. Throws unless unlocked. */
export async function requireAdminAction(): Promise<string> {
  const state = await getAdminState();
  if (state.kind !== "ok") throw new Error("Not authorized");
  return state.discordId;
}

/** True when the caller is a fully unlocked admin. For route handlers that
 *  want to answer with their own 403. */
export async function isUnlockedAdmin(): Promise<boolean> {
  return (await getAdminState()).kind === "ok";
}

// --- unlock cookie ----------------------------------------------------------

async function issueUnlock(discordId: string, nonce: string, trust: boolean): Promise<void> {
  const exp = Date.now() + (trust ? trustMs() : sessionMs());
  const token = signToken({
    k: "admin",
    sub: discordId,
    n: nonce,
    exp,
    ...(trust ? { ua: await browserMark() } : {}),
  });
  (await cookies()).set(UNLOCK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(exp),
  });
}

/** Lock this browser. */
export async function lockAdmin(): Promise<void> {
  (await cookies()).delete(UNLOCK_COOKIE);
}

/** Lock every browser this admin has unlocked (rotates the nonce). */
export async function lockAllAdminSessions(discordId: string): Promise<void> {
  await prisma.adminCredential.update({
    where: { discordId },
    data: { sessionNonce: randomBytes(18).toString("base64url") },
  });
  nonceCache.delete(discordId);
  await lockAdmin();
}

// --- unlock -----------------------------------------------------------------

export type StepResult = { ok: true } | { ok: false; error: string };

const BAD_LOGIN = "Incorrect password or code.";

export async function unlockAdmin(
  password: string,
  code: string,
  trust = false,
): Promise<StepResult> {
  const state = await getAdminState();
  if (state.kind === "none") return { ok: false, error: BAD_LOGIN };
  if (state.kind === "unenrolled") return { ok: false, error: "Set up admin access first." };
  const { discordId } = state;

  const limit = await consume(`admin:unlock:${discordId}`, ATTEMPT_RULE);
  if (!limit.ok) {
    return { ok: false, error: `Too many attempts. Wait ${limit.retryAfterSec}s.` };
  }

  const cred = await prisma.adminCredential.findUnique({ where: { discordId } });
  if (!cred) return { ok: false, error: BAD_LOGIN };

  if (cred.lockedUntil && cred.lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((cred.lockedUntil.getTime() - Date.now()) / 60_000);
    return {
      ok: false,
      error: `Locked after too many wrong attempts. Try again in ${mins} min.`,
    };
  }

  // Check both factors every time — never reveal which one was wrong.
  const passwordOk = verifyPassword(password, cred.passwordHash);
  const secret = unseal(cred.totpSecretEnc, masterSecret(), "admin-totp");
  const step = secret ? verifyTotp(secret, code, Number(cred.lastTotpStep)) : null;

  if (!passwordOk || step == null) {
    const fails = cred.failedCount + 1;
    const lock = fails >= MAX_FAILS;
    await prisma.adminCredential.update({
      where: { discordId },
      data: {
        failedCount: lock ? 0 : fails,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MS) : cred.lockedUntil,
      },
    });
    await logAdmin(discordId, "unlock.failed", { fails, locked: lock });
    return {
      ok: false,
      error: lock
        ? "Too many wrong attempts — admin access is locked for 15 minutes."
        : BAD_LOGIN,
    };
  }

  // Burn the time-step atomically: a concurrent request with the same code loses.
  const burned = await prisma.adminCredential.updateMany({
    where: { discordId, lastTotpStep: { lt: BigInt(step) } },
    data: { lastTotpStep: BigInt(step), failedCount: 0, lockedUntil: null },
  });
  if (burned.count !== 1) {
    return { ok: false, error: "That code was already used. Wait for the next one." };
  }

  await issueUnlock(discordId, cred.sessionNonce, trust);
  await logAdmin(discordId, "unlock.ok", trust ? { trusted: true, days: trustDays() } : {});
  return { ok: true };
}

// --- enrolment --------------------------------------------------------------

/** Whether the server has the one-time setup key configured. */
export function setupKeyConfigured(): boolean {
  return (process.env.ADMIN_SETUP_KEY ?? "").trim().length >= 16;
}

/**
 * A fresh authenticator secret for the setup page, plus a sealed "ticket"
 * carrying it back to the server in the form. Nothing is stored until the
 * whole form (setup key + password + a working code) checks out.
 */
export function newEnrolTicket(discordId: string): { secret: string; ticket: string } {
  const secret = newTotpSecret();
  const ticket = seal(
    JSON.stringify({ sub: discordId, secret, at: Date.now() }),
    masterSecret(),
    "admin-enrol",
  );
  return { secret, ticket };
}

/** The secret inside an enrolment ticket, if it is still valid for this admin. */
export function readEnrolTicket(ticket: string, discordId: string): string | null {
  let parsed: { sub?: string; secret?: string; at?: number } | null = null;
  try {
    const raw = unseal(ticket, masterSecret(), "admin-enrol");
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (
    !parsed ||
    parsed.sub !== discordId ||
    typeof parsed.secret !== "string" ||
    typeof parsed.at !== "number" ||
    Date.now() - parsed.at > ENROL_TICKET_MS
  ) {
    return null;
  }
  return parsed.secret;
}

export async function enrolAdmin(input: {
  setupKey: string;
  password: string;
  confirm: string;
  ticket: string;
  code: string;
}): Promise<StepResult> {
  const state = await getAdminState();
  if (state.kind === "none") return { ok: false, error: "Not authorized." };
  if (state.kind !== "unenrolled") {
    return { ok: false, error: "Admin access is already set up for this account." };
  }
  const { discordId } = state;

  const limit = await consume(`admin:enrol:${discordId}`, ATTEMPT_RULE);
  if (!limit.ok) {
    return { ok: false, error: `Too many attempts. Wait ${limit.retryAfterSec}s.` };
  }

  if (!setupKeyConfigured()) {
    return { ok: false, error: "ADMIN_SETUP_KEY is not set on the server." };
  }
  if (!safeEqual(input.setupKey.trim(), (process.env.ADMIN_SETUP_KEY ?? "").trim())) {
    await logAdmin(discordId, "enrol.bad_setup_key");
    return { ok: false, error: "That setup key is not correct." };
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (input.password !== input.confirm) {
    return { ok: false, error: "The two passwords don't match." };
  }

  const secret = readEnrolTicket(input.ticket, discordId);
  if (!secret) {
    return {
      ok: false,
      error: "This setup page expired. Reload it and scan the new QR code.",
    };
  }

  const step = verifyTotp(secret, input.code, 0);
  if (step == null) {
    return {
      ok: false,
      error: "That 6-digit code didn't match. Check the app and try again.",
    };
  }

  const nonce = randomBytes(18).toString("base64url");
  try {
    await prisma.adminCredential.create({
      data: {
        discordId,
        passwordHash: hashPassword(input.password),
        totpSecretEnc: seal(secret, masterSecret(), "admin-totp"),
        lastTotpStep: BigInt(step),
        sessionNonce: nonce,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "Admin access is already set up for this account." };
    }
    throw err;
  }

  await issueUnlock(discordId, nonce, false);
  await logAdmin(discordId, "enrol.ok");
  return { ok: true };
}
