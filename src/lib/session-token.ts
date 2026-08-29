/**
 * Stateless HMAC-signed tokens for the skill games (typing, aim).
 *
 * A game hands the client a token when a round starts; the client returns it on
 * submit. The server trusts `iat` (issued-at, ms) as the authoritative "round
 * started" timestamp - the client cannot forge it without the secret - which is
 * what makes server-side speed / plausibility checks meaningful.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET =
  process.env.SESSION_TOKEN_SECRET || process.env.AUTH_SECRET || "";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signToken(payload: Record<string, unknown>): string {
  if (!SECRET) throw new Error("SESSION_TOKEN_SECRET / AUTH_SECRET is not set");
  // `iat` defaults to now; callers may pass their own (used by tests).
  const body = b64url(JSON.stringify({ iat: Date.now(), ...payload }));
  const sig = b64url(createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken<T = Record<string, unknown>>(
  token: string,
): (T & { iat: number }) | null {
  if (!SECRET) throw new Error("SESSION_TOKEN_SECRET / AUTH_SECRET is not set");

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = createHmac("sha256", SECRET).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString());
    if (parsed && typeof parsed.iat === "number") return parsed as T & { iat: number };
    return null;
  } catch {
    return null;
  }
}
