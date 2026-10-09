/**
 * Reset an admin's second factor (lost phone / forgotten password).
 *
 *   node scripts/admin-reset.mjs                 # lists who is set up
 *   node scripts/admin-reset.mjs <discordId>     # removes that admin's password + authenticator
 *
 * After a reset that admin signs in with Discord and goes through /admin/setup
 * again (which needs ADMIN_SETUP_KEY). This is deliberately a script, not a
 * website button: resetting needs database access, which only the owner has.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const target = process.argv[2];

try {
  if (!target) {
    const rows = await prisma.adminCredential.findMany({
      select: { discordId: true, createdAt: true, lockedUntil: true },
    });
    if (rows.length === 0) console.log("No admin has set up access yet.");
    for (const r of rows) {
      console.log(
        `${r.discordId}  set up ${r.createdAt.toISOString()}` +
          (r.lockedUntil && r.lockedUntil > new Date() ? "  (locked out)" : ""),
      );
    }
    console.log("\nTo reset one:  node scripts/admin-reset.mjs <discordId>");
  } else if (!/^\d{15,22}$/.test(target)) {
    console.error("That is not a Discord ID.");
    process.exitCode = 1;
  } else {
    const removed = await prisma.adminCredential.deleteMany({ where: { discordId: target } });
    if (removed.count === 0) {
      console.log("Nothing to reset — that admin has not set up access.");
    } else {
      await prisma.adminAudit.create({
        data: { discordId: target, action: "reset.by_script", detail: {} },
      });
      console.log("Reset. That admin must set up again at /admin/setup.");
    }
  }
} finally {
  await prisma.$disconnect();
}
