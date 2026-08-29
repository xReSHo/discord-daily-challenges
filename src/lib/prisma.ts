import { PrismaClient } from "@prisma/client";

// One client per process, reused across hot-reloads (dev) and warm serverless
// invocations. With the transaction pooler + connection_limit=1 in
// DATABASE_URL, each function instance holds a single pooled connection.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
