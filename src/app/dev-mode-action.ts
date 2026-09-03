"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { DEV_COOKIE, DEV_COOKIE_MAX_AGE } from "@/lib/dev-mode";

/** Turn the admin-only dev mode on or off for this browser. */
export async function setDevMode(on: boolean): Promise<void> {
  const session = await auth();
  if (!isAdmin(session?.user?.discordId)) return;

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
