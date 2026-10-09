/**
 * Crypto primitives for the admin second factor — password hashing, TOTP
 * (RFC 6238) and at-rest encryption of the TOTP secret. Pure functions over
 * `node:crypto`, no I/O, so they are easy to test in isolation.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

// --- constant-time string compare -------------------------------------------

/** Compare two secrets without leaking where they differ (or their length). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// --- password ---------------------------------------------------------------

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEYLEN = 64;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  let actual: Buffer;
  try {
    actual = scryptSync(
      password.normalize("NFKC"),
      Buffer.from(saltB64, "base64"),
      expected.length,
      { ...SCRYPT, N: Number(n) },
    );
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- base32 (RFC 4648, no padding) — the format authenticator apps expect ----

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// --- TOTP (SHA-1, 6 digits, 30s — what every authenticator app defaults to) --

export const TOTP_STEP_SEC = 30;
const TOTP_DIGITS = 6;

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SEC);
}

export function totpCode(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/**
 * Check a code against the current step ±1 (clock drift). Returns the matched
 * step, or null. Steps at or below `lastUsedStep` are refused, so a code that
 * was already accepted (or shoulder-surfed) can never be used again.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  lastUsedStep: number,
  nowMs: number = Date.now(),
): number | null {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const now = totpStep(nowMs);
  let matched: number | null = null;
  // Always evaluate all three candidates — no early exit on a match.
  for (const step of [now - 1, now, now + 1]) {
    if (safeEqual(totpCode(secretB32, step), clean) && step > lastUsedStep) {
      matched = matched ?? step;
    }
  }
  return matched;
}

export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params}`;
}

// --- sealing (AES-256-GCM) ---------------------------------------------------

function sealKey(masterSecret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterSecret, "daily-challenges", purpose, 32));
}

/** Encrypt + authenticate `plain` under a key derived for `purpose`. */
export function seal(plain: string, masterSecret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealKey(masterSecret, purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

/** Reverse of {@link seal}. Returns null on any tampering or a wrong key. */
export function unseal(sealed: string, masterSecret: string, purpose: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", sealKey(masterSecret, purpose), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
