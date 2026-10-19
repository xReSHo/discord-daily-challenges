import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { CAUGHT_HEADER, isAltAccount } from "@/lib/alt-guard";

const CAUGHT_MESSAGE =
  "This account wears the mark of an alt. You were warned. I see you as well.";

/**
 * Turns known alt accounts away from the whole site: pages show /caught, and
 * every reply that could earn, spend or record anything is refused. Anyone
 * signed out, and every other player, passes straight through.
 */
export default auth(async (req) => {
  const discordId = req.auth?.user?.discordId;
  if (!discordId || !(await isAltAccount(discordId))) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const isPage = (req.method === "GET" || req.method === "HEAD") && !req.headers.has("next-action");
  if (pathname.startsWith("/api") || !isPage) {
    return NextResponse.json({ error: CAUGHT_MESSAGE }, { status: 403 });
  }

  const headers = new Headers(req.headers);
  headers.set(CAUGHT_HEADER, "1");
  return NextResponse.rewrite(new URL("/caught", req.url), { request: { headers } });
});

export const config = {
  matcher: [
    // Everything but the sign-in routes (so an alt can still sign out), the
    // bot's own endpoints, build output and the artwork.
    "/((?!api/auth|api/bot|_next/static|_next/image|grace/|art/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp3|mp4|webm|ogg|wav|woff2?|txt|xml)$).*)",
  ],
};
