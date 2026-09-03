import { timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/logger";
import { listExpiredRoles, markRoleRemoved } from "@/lib/shop/expiry";

/**
 * Temporary-pass expiry channel for the Discord bot.
 *
 *   GET  → shop roles whose time is up and haven't been removed yet
 *   POST { id } → mark one removed (after the bot strips the role)
 *
 * Auth: `Authorization: Bearer <SHOP_FULFILL_SECRET>` (must match the bot).
 */
const SECRET = process.env.SHOP_FULFILL_SECRET || "";

function authorized(req: Request): boolean {
  if (!SECRET) return false;
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(provided);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ expired: await listExpiredRoles() });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let id = "";
  try {
    const body = (await request.json()) as { id?: unknown };
    if (typeof body.id === "string") id = body.id;
  } catch {
    /* validated below */
  }
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  try {
    return Response.json({ ok: true, changed: await markRoleRemoved(id) });
  } catch (err) {
    logger.error("shop.expiry_error", { id, message: String(err) });
    return Response.json({ error: "update failed" }, { status: 500 });
  }
}
