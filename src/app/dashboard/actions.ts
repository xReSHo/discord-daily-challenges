"use server";

import { refresh } from "next/cache";
import { auth } from "@/auth";
import { completeSection, type CompleteResult } from "@/lib/completions";
import { isSectionId } from "@/lib/sections";
import { checkLimit, RATE_RULES } from "@/lib/rate-limit";

/**
 * Server Action behind the "Mark Complete" button. Reachable via direct POST,
 * so it re-checks auth and validates the section id itself -- render-time
 * gating is not a security boundary.
 */
export async function completeSectionAction(
  sectionId: string,
): Promise<CompleteResult> {
  const session = await auth();
  const discordId = session?.user?.discordId;

  if (!discordId) {
    return { status: "reward_failed", message: "You are not logged in." };
  }
  if (!isSectionId(sectionId)) {
    return { status: "reward_failed", message: "Unknown section." };
  }

  const { ok } = await checkLimit("action:complete", RATE_RULES.mutate, discordId);
  if (!ok) {
    return {
      status: "reward_failed",
      message: "Too many attempts — wait a moment and try again.",
    };
  }

  const result = await completeSection(discordId, sectionId);
  // Keep the server-rendered dashboard in sync with the new completion state.
  refresh();
  return result;
}
