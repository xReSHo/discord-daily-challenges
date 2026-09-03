/**
 * Thin wrapper around the UnbelievaBoat currency API.
 *
 * Docs: https://unbelievaboat.com/api/docs
 * The API token is a raw string (NOT `Bearer <token>`).
 */

const API_BASE = "https://unbelievaboat.com/api/v1";
/** GET calls are read-only — a slow store shouldn't stall a page render. */
const READ_TIMEOUT_MS = 4500;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** Token + guild, or `null` when the integration isn't configured (local dev). */
function credentials(): { token: string; guildId: string } | null {
  const token = process.env.UNBELIEVABOAT_API_TOKEN;
  const guildId = process.env.UNBELIEVABOAT_GUILD_ID;
  return token && guildId ? { token, guildId } : null;
}

export type Balance = {
  rank: string | null;
  cash: number;
  bank: number;
  total: number;
  user_id: string;
};

/** PATCH a user's balance with a raw body (`{cash?, bank?, reason?}`). Throws on
 *  any non-2xx so a resolved promise means "the change definitely landed". */
async function patchBalance(
  discordUserId: string,
  body: Record<string, unknown>,
): Promise<Balance> {
  const token = requireEnv("UNBELIEVABOAT_API_TOKEN");
  const guildId = requireEnv("UNBELIEVABOAT_GUILD_ID");

  const res = await fetch(
    `${API_BASE}/guilds/${guildId}/users/${discordUserId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      // Never cache a mutation.
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `UnbelievaBoat PATCH failed: ${res.status} ${res.statusText} ${text}`.trim(),
    );
  }

  return (await res.json()) as Balance;
}

/**
 * Add (or, with a negative amount, remove) currency from a user's balance.
 * Rewards land in the **bank** by default (safe from robberies / gambling
 * losses); pass `target: "cash"` to touch the spendable balance instead.
 * Throws on any non-2xx response so callers can treat a resolved promise
 * as "the payout definitely landed".
 */
export async function addCurrency(
  discordUserId: string,
  amount: number,
  reason: string,
  target: "bank" | "cash" = "bank",
): Promise<Balance> {
  return patchBalance(discordUserId, { [target]: amount, reason });
}

export type SpendResult =
  | { ok: true; paidCash: number; paidBank: number; balance: Balance }
  | { ok: false; reason: "insufficient" | "unavailable" | "error"; message?: string };

/**
 * Charge a user `amount`, taking it from **cash first, then bank** (matching
 * UnbelievaBoat's own `/buy`). Returns how much came from each pocket so a
 * later {@link refund} can put it back exactly. Never throws.
 */
export async function spend(
  discordUserId: string,
  amount: number,
  reason: string,
): Promise<SpendResult> {
  if (!credentials()) return { ok: false, reason: "unavailable" };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "error", message: "bad amount" };
  }

  let current: Balance;
  try {
    current = await readBalance(discordUserId);
  } catch (err) {
    return { ok: false, reason: "error", message: String(err) };
  }

  if (current.total < amount) return { ok: false, reason: "insufficient" };

  const paidCash = Math.min(Math.max(current.cash, 0), amount);
  const paidBank = amount - paidCash;

  try {
    let balance = current;
    if (paidCash > 0) {
      balance = await patchBalance(discordUserId, { cash: -paidCash, reason });
    }
    if (paidBank > 0) {
      balance = await patchBalance(discordUserId, { bank: -paidBank, reason });
    }
    return { ok: true, paidCash, paidBank, balance };
  } catch (err) {
    // Best-effort unwind of whatever already came out.
    await refund(discordUserId, paidCash, paidBank, `${reason} (charge failed)`).catch(
      () => {},
    );
    return { ok: false, reason: "error", message: String(err) };
  }
}

/** Put `paidCash` / `paidBank` back where {@link spend} took them from. Throws
 *  on failure so the caller can retry / alert. */
export async function refund(
  discordUserId: string,
  paidCash: number,
  paidBank: number,
  reason: string,
): Promise<void> {
  if (paidCash > 0) await patchBalance(discordUserId, { cash: paidCash, reason });
  if (paidBank > 0) await patchBalance(discordUserId, { bank: paidBank, reason });
}

/** GET a user's balance. Throws when unconfigured or the API errors. Never
 *  cached — a stale balance right after a purchase would be misleading. */
async function readBalance(discordUserId: string): Promise<Balance> {
  const creds = credentials();
  if (!creds) throw new Error("UnbelievaBoat is not configured");

  const res = await fetch(
    `${API_BASE}/guilds/${creds.guildId}/users/${discordUserId}`,
    {
      headers: { Authorization: creds.token, Accept: "application/json" },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`UnbelievaBoat GET failed: ${res.status}`);
  return (await res.json()) as Balance;
}

/**
 * Read a user's current balance. Returns `null` (never throws) when the
 * integration isn't configured or the API is unreachable — callers just hide
 * the figure rather than blowing up the page.
 */
export async function getBalance(discordUserId: string): Promise<Balance | null> {
  try {
    return await readBalance(discordUserId);
  } catch {
    return null;
  }
}
