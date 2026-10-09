/**
 * Offline check of the admin second-factor primitives against published
 * vectors, plus the properties the gate relies on.
 *
 *   node --experimental-strip-types --import ./scripts/ts-esm-hook.mjs scripts/verify-admin-crypto.mts
 */
import {
  base32Decode,
  base32Encode,
  hashPassword,
  newTotpSecret,
  otpauthUri,
  safeEqual,
  seal,
  totpCode,
  totpStep,
  unseal,
  verifyPassword,
  verifyTotp,
} from "../src/lib/admin-crypto";

let failed = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}

// RFC 4648 base32 vectors
check(base32Encode(Buffer.from("foobar")) === "MZXW6YTBOI", "base32 encodes the RFC 4648 vector");
check(base32Decode("MZXW6YTBOI").toString() === "foobar", "base32 decodes the RFC 4648 vector");
check(base32Decode("mzxw 6ytb oi").toString() === "foobar", "base32 decode ignores case and spaces");

// RFC 6238 appendix B (SHA-1, secret "12345678901234567890"), truncated to 6 digits
const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));
const vectors: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];
for (const [t, code] of vectors) {
  check(totpCode(rfcSecret, totpStep(t * 1000)) === code, `TOTP matches RFC 6238 at t=${t}`);
}

// verification window + replay protection
const secret = newTotpSecret();
const now = Date.UTC(2026, 9, 7, 12, 0, 10);
const step = totpStep(now);
check(secret.length === 32, "new secret is 160 bits (32 base32 chars)");
check(verifyTotp(secret, totpCode(secret, step), 0, now) === step, "current code is accepted");
check(verifyTotp(secret, totpCode(secret, step - 1), 0, now) === step - 1, "previous step accepted (clock drift)");
check(verifyTotp(secret, totpCode(secret, step + 1), 0, now) === step + 1, "next step accepted (clock drift)");
check(verifyTotp(secret, totpCode(secret, step - 2), 0, now) === null, "a code two steps old is refused");
check(verifyTotp(secret, totpCode(secret, step), step, now) === null, "a code already used is refused (replay)");
check(verifyTotp(secret, totpCode(secret, step - 1), step, now) === null, "an older code after a newer one is refused");
check(verifyTotp(secret, "12345", 0, now) === null, "a 5-digit code is refused");
check(verifyTotp(secret, "abcdef", 0, now) === null, "a non-numeric code is refused");
check(
  verifyTotp(secret, totpCode(secret, step).replace(/(\d{3})/, "$1 "), 0, now) === step,
  "a code typed with a space is accepted",
);
let guessHits = 0;
for (let i = 0; i < 2000; i++) {
  if (verifyTotp(secret, String(i * 499 + 7).padStart(6, "0").slice(0, 6), 0, now) !== null) guessHits++;
}
check(guessHits <= 1, `2000 guessed codes hit at most by chance (${guessHits})`);

// password
const hash = hashPassword("correct horse battery staple");
check(hash.startsWith("scrypt$"), "password hash is scrypt-tagged");
check(!hash.includes("correct horse"), "hash does not contain the password");
check(verifyPassword("correct horse battery staple", hash), "right password verifies");
check(!verifyPassword("correct horse battery stapl", hash), "wrong password is refused");
check(!verifyPassword("", hash), "empty password is refused");
check(hashPassword("same") !== hashPassword("same"), "same password hashes differently (salted)");
check(!verifyPassword("x", "not-a-hash"), "a malformed stored hash is refused, not thrown");

// sealing
const sealed = seal("JBSWY3DPEHPK3PXP", "master-secret", "admin-totp");
check(!sealed.includes("JBSWY3DP"), "sealed secret is not readable");
check(unseal(sealed, "master-secret", "admin-totp") === "JBSWY3DPEHPK3PXP", "unseals with the right key");
check(unseal(sealed, "other-secret", "admin-totp") === null, "wrong master secret cannot unseal");
check(unseal(sealed, "master-secret", "admin-enrol") === null, "a different purpose cannot unseal");
const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
check(unseal(tampered, "master-secret", "admin-totp") === null, "a tampered value is refused");
check(unseal("garbage", "master-secret", "admin-totp") === null, "garbage is refused, not thrown");

// misc
check(safeEqual("abc", "abc") && !safeEqual("abc", "abd") && !safeEqual("abc", "abcd"), "safeEqual compares correctly");
check(
  otpauthUri("ABC", "admin", "Daily Challenges").startsWith("otpauth://totp/Daily%20Challenges%3Aadmin?secret=ABC"),
  "otpauth URI is well-formed",
);

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
