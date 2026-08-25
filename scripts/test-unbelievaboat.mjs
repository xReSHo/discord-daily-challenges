// Standalone sanity check for your UnbelievaBoat API credentials.
// Run with: node scripts/test-unbelievaboat.mjs
//
// This does NOT touch the website/DB at all -- it just confirms your
// API token, guild ID, and permissions are correct before any feature
// code depends on them.

import "dotenv/config";

const TOKEN = process.env.UNBELIEVABOAT_API_TOKEN;
const GUILD_ID = process.env.UNBELIEVABOAT_GUILD_ID;
const USER_ID = process.env.UNBELIEVABOAT_TEST_USER_ID;
const TEST_AMOUNT = 10; // small, safe test amount

if (!TOKEN || !GUILD_ID || !USER_ID) {
  console.error(
    "Missing UNBELIEVABOAT_API_TOKEN, UNBELIEVABOAT_GUILD_ID, or UNBELIEVABOAT_TEST_USER_ID in .env"
  );
  process.exit(1);
}

const url = `https://unbelievaboat.com/api/v1/guilds/${GUILD_ID}/users/${USER_ID}`;

try {
  // 1. Read current balance first
  const before = await fetch(url, {
    headers: { Authorization: TOKEN },
  });

  if (!before.ok) {
    console.error(
      `GET failed: ${before.status} ${before.statusText}`,
      await before.text()
    );
    process.exit(1);
  }

  const beforeData = await before.json();
  console.log("Current balance:", beforeData);

  // 2. Add TEST_AMOUNT to cash balance
  const patch = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cash: TEST_AMOUNT,
      reason: "Phase 0 integration test",
    }),
  });

  if (!patch.ok) {
    console.error(
      `PATCH failed: ${patch.status} ${patch.statusText}`,
      await patch.text()
    );
    process.exit(1);
  }

  const afterData = await patch.json();
  console.log(`Added ${TEST_AMOUNT} cash. New balance:`, afterData);
  console.log("\n✅ UnbelievaBoat integration works.");
} catch (err) {
  console.error("Request failed:", err);
  process.exit(1);
}
