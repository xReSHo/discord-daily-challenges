/**
 * Thin wrapper around the UnbelievaBoat currency API.
 *
 * Docs: https://unbelievaboat.com/api/docs
 * The API token is a raw string (NOT `Bearer <token>`).
 */

const API_BASE = "https://unbelievaboat.com/api/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export type Balance = {
  rank: string | null;
  cash: number;
  bank: number;
  total: number;
  user_id: string;
};

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
      body: JSON.stringify({ [target]: amount, reason }),
      // Never cache a mutation.
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `UnbelievaBoat PATCH failed: ${res.status} ${res.statusText} ${body}`.trim(),
    );
  }

  return (await res.json()) as Balance;
}
