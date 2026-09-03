/**
 * Temporary-pass expiry. The site grants shop roles synchronously; only the
 * *removal* of a timed role needs a scheduler, which is the Discord bot. It
 * polls `listExpiredRoles` (rarely — nothing's usually due), strips the role,
 * and calls `markRoleRemoved`.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const MAX_BATCH = 50;

export type ExpiredRole = { id: string; discordId: string; roleId: string };

export async function listExpiredRoles(): Promise<ExpiredRole[]> {
  const rows = await prisma.purchase.findMany({
    where: {
      status: "fulfilled",
      roleRemoved: false,
      roleExpiresAt: { not: null, lte: new Date() },
      roleId: { not: null },
    },
    orderBy: { roleExpiresAt: "asc" },
    take: MAX_BATCH,
    select: { id: true, discordId: true, roleId: true },
  });
  return rows.map((r) => ({ id: r.id, discordId: r.discordId, roleId: r.roleId ?? "" }));
}

export async function markRoleRemoved(id: string): Promise<boolean> {
  const { count } = await prisma.purchase.updateMany({
    where: { id, roleRemoved: false },
    data: { roleRemoved: true },
  });
  if (count) logger.info("shop.role_expired", { id });
  return count > 0;
}
