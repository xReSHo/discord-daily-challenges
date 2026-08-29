import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { rateLimit, RATE_RULES } from "@/lib/rate-limit";

/**
 * The NextAuth endpoints, wrapped with an IP-keyed rate limit. Sign-in,
 * OAuth callback and session polling all pass through here.
 */
async function guard(): Promise<Response | null> {
  return rateLimit("auth", RATE_RULES.auth);
}

export async function GET(request: NextRequest) {
  return (await guard()) ?? handlers.GET(request);
}

export async function POST(request: NextRequest) {
  return (await guard()) ?? handlers.POST(request);
}
