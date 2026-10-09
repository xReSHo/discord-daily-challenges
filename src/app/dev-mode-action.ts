"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminState, logAdmin } from "@/lib/admin-auth";
import { DEV_COOKIE, DEV_COOKIE_MAX_AGE } from "@/lib/dev-mode";

/** Turn the admin-only dev mode on or off for this browser. */
export async function setDevMode(on: boolean): Promise<void> {
  // Dev mode lifts the daily cooldown, so switching it needs the full admin
  // unlock, not just an allowlisted Discord login.
  const state = await getAdminState();
  if (state.kind === "none") return;
  if (state.kind === "unenrolled") redirect("/admin/setup");
  if (state.kind === "locked") redirect("/admin/unlock");
  await logAdmin(state.discordId, on ? "devmode.on" : "devmode.off");

  const store = await cookies();
  if (on) {
    store.set(DEV_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: DEV_COOKIE_MAX_AGE,
    });
  } else {
    store.delete(DEV_COOKIE);
  }

  // Re-run every server component so the completion gates re-evaluate.
  revalidatePath("/", "layout");
}
